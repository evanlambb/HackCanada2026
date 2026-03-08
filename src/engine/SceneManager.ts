import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { createGeometry } from './MeshOperations';
import { AnimationManager } from './AnimationManager';
import type { Viewport } from './Viewport';
import type { SceneObject } from '../store/types';
import type { AnimationData } from '../store/types';

export class SceneManager {
  viewport: Viewport;
  meshMap = new Map<string, THREE.Object3D>();
  animationManager = new AnimationManager();

  private geometryCache = new Map<string, THREE.BufferGeometry>();
  private sceneCache = new Map<string, THREE.Object3D>();
  private clipsCache = new Map<string, THREE.AnimationClip[]>();
  private unsub: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.unsub = useEditorStore.subscribe((state, prev) => {
      this.syncObjects(state.objects, prev.objects);
    });
    const s = useEditorStore.getState();
    this.syncObjects(s.objects, {});

    viewport.onRender(() => {
      this.animationManager.update(viewport.getDelta());
    });
  }

  private syncObjects(
    objects: Record<string, SceneObject>,
    prev: Record<string, SceneObject> | undefined,
  ) {
    const cur = new Set(Object.keys(objects));
    const old = new Set(Object.keys(prev ?? {}));
    for (const id of cur) {
      if (!old.has(id)) this.addMesh(objects[id]);
    }
    for (const id of old) {
      if (!cur.has(id)) this.removeMesh(id);
    }
    for (const id of cur) {
      if (old.has(id) && objects[id] !== prev[id]) this.updateMesh(objects[id]);
    }
  }

  /**
   * Preload asset data into caches before objects are added to the store.
   * Used when restoring a project: call this for each loaded asset, then restoreState.
   */
  preloadAsset(
    id: string,
    scene: THREE.Object3D | null,
    geometry: THREE.BufferGeometry,
    clips: THREE.AnimationClip[],
  ): void {
    if (scene) {
      this.sceneCache.set(id, scene);
      if (clips.length > 0) this.clipsCache.set(id, clips);
    } else {
      this.geometryCache.set(id, geometry);
    }
  }

  /**
   * Returns all scene objects (id -> Object3D) for GLB export.
   * Export all objects so edited primitives and imported meshes are persisted.
   */
  getExportableObjects(): Map<string, THREE.Object3D> {
    return new Map(this.meshMap);
  }

  /** Import a non-animated mesh (geometry only). */
  importMesh(name: string, geometry: THREE.BufferGeometry): string {
    const store = useEditorStore.getState();
    const id = store.peekNextId();
    this.geometryCache.set(id, geometry);
    store.addImportedObject(name);
    return id;
  }

  /** Import a model that may have animations. */
  importModel(
    name: string,
    geometry: THREE.BufferGeometry,
    scene: THREE.Object3D | null,
    clips: THREE.AnimationClip[],
  ): string {
    const store = useEditorStore.getState();
    const id = store.peekNextId();

    if (scene) {
      this.sceneCache.set(id, scene);
      if (clips.length > 0) this.clipsCache.set(id, clips);
    } else {
      this.geometryCache.set(id, geometry);
    }

    const animData: AnimationData[] = clips.map((c) => ({
      name: c.name,
      duration: parseFloat(c.duration.toFixed(2)),
    }));
    store.addImportedObject(name, animData);
    return id;
  }

  playAnimation(objectId: string, animationName: string) {
    this.animationManager.play(objectId, animationName);
    useEditorStore.getState().setActiveAnimation(objectId, animationName);
  }

  stopAnimation(objectId: string) {
    this.animationManager.stop(objectId);
    useEditorStore.getState().setActiveAnimation(objectId, null);
  }

  private addMesh(obj: SceneObject) {
    const cachedScene = this.sceneCache.get(obj.id);

    if (cachedScene) {
      this.sceneCache.delete(obj.id);
      // Tag every child mesh with the object id for raycasting
      cachedScene.traverse((child) => {
        child.userData.id = obj.id;
      });
      cachedScene.userData.id = obj.id;
      cachedScene.position.set(...obj.position);
      cachedScene.rotation.set(...obj.rotation);
      cachedScene.scale.set(...obj.scale);
      cachedScene.visible = obj.visible;
      this.viewport.scene.add(cachedScene);
      this.meshMap.set(obj.id, cachedScene);

      const clips = this.clipsCache.get(obj.id);
      if (clips) {
        this.animationManager.register(obj.id, cachedScene, clips);
        this.clipsCache.delete(obj.id);
      }
      return;
    }

    const cached = this.geometryCache.get(obj.id);
    const geo = cached ?? createGeometry(obj.geometryType);
    if (cached) this.geometryCache.delete(obj.id);
    const mat = new THREE.MeshStandardMaterial({
      color: obj.color,
      roughness: 0.7,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.id = obj.id;
    mesh.position.set(...obj.position);
    mesh.rotation.set(...obj.rotation);
    mesh.scale.set(...obj.scale);
    mesh.visible = obj.visible;
    this.viewport.scene.add(mesh);
    this.meshMap.set(obj.id, mesh);
  }

  private removeMesh(id: string) {
    this.animationManager.remove(id);
    const obj = this.meshMap.get(id);
    if (obj) {
      this.viewport.scene.remove(obj);
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            (m.material as THREE.Material).dispose();
          }
        }
      });
      this.meshMap.delete(id);
    }
  }

  private updateMesh(obj: SceneObject) {
    const o = this.meshMap.get(obj.id);
    if (!o) return;
    o.position.set(...obj.position);
    o.rotation.set(...obj.rotation);
    o.scale.set(...obj.scale);
    o.visible = obj.visible;
    // Only update color on simple meshes (not animated groups)
    if ((o as THREE.Mesh).isMesh) {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if ('#' + m.color.getHexString() !== obj.color) m.color.set(obj.color);
    }
  }

  getMeshById(id: string) {
    return this.meshMap.get(id) ?? null;
  }

  /** Returns all renderable mesh objects (flattened from groups) for raycasting. */
  getMeshes(): THREE.Object3D[] {
    const result: THREE.Object3D[] = [];
    for (const obj of this.meshMap.values()) {
      if ((obj as THREE.Mesh).isMesh) {
        result.push(obj);
      } else {
        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            result.push(child);
          }
        });
      }
    }
    return result;
  }

  replaceGeometry(id: string, geo: THREE.BufferGeometry) {
    const obj = this.meshMap.get(id);
    if (!obj || !(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }

  dispose() {
    this.unsub();
    this.animationManager.dispose();
    for (const [id] of this.meshMap) this.removeMesh(id);
  }
}

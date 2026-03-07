import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { createGeometry } from './MeshOperations';
import type { Viewport } from './Viewport';
import type { SceneObject } from '../store/types';

export class SceneManager {
  viewport: Viewport;
  meshMap = new Map<string, THREE.Mesh>();
  private unsub: () => void;

  constructor(viewport: Viewport) {
    this.viewport = viewport;
    this.unsub = useEditorStore.subscribe((state, prev) => {
      this.syncObjects(state.objects, prev.objects);
    });
    const s = useEditorStore.getState();
    this.syncObjects(s.objects, {});
  }

  private syncObjects(
    objects: Record<string, SceneObject>,
    prev: Record<string, SceneObject>,
  ) {
    const cur = new Set(Object.keys(objects));
    const old = new Set(Object.keys(prev));
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

  private addMesh(obj: SceneObject) {
    const geo = createGeometry(obj.geometryType);
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
    const mesh = this.meshMap.get(id);
    if (mesh) {
      this.viewport.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.meshMap.delete(id);
    }
  }

  private updateMesh(obj: SceneObject) {
    const mesh = this.meshMap.get(obj.id);
    if (!mesh) return;
    mesh.position.set(...obj.position);
    mesh.rotation.set(...obj.rotation);
    mesh.scale.set(...obj.scale);
    mesh.visible = obj.visible;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if ('#' + m.color.getHexString() !== obj.color) m.color.set(obj.color);
  }

  getMeshById(id: string) {
    return this.meshMap.get(id);
  }

  getMeshes(): THREE.Mesh[] {
    return Array.from(this.meshMap.values());
  }

  replaceGeometry(id: string, geo: THREE.BufferGeometry) {
    const mesh = this.meshMap.get(id);
    if (!mesh) return;
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }

  dispose() {
    this.unsub();
    for (const [id] of this.meshMap) this.removeMesh(id);
  }
}

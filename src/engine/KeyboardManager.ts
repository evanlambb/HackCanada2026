import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import type { TransformEngine } from './TransformEngine';
import type { EditModeEngine } from './EditModeEngine';
import type { SceneManager } from './SceneManager';
import type { Viewport } from './Viewport';
import { joinMeshGeometries } from './MeshOperations';

export class KeyboardManager {
  private transformEngine: TransformEngine;
  private editModeEngine: EditModeEngine;
  private sceneManager: SceneManager;
  private viewport: Viewport;
  private showAddMenuCb: (() => void) | null = null;

  constructor(
    transformEngine: TransformEngine,
    editModeEngine: EditModeEngine,
    sceneManager: SceneManager,
    viewport: Viewport,
  ) {
    this.transformEngine = transformEngine;
    this.editModeEngine = editModeEngine;
    this.sceneManager = sceneManager;
    this.viewport = viewport;
    window.addEventListener('keydown', this.onKey);
  }

  setAddMenuCallback(cb: () => void) {
    this.showAddMenuCb = cb;
  }

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const store = useEditorStore.getState();

    switch (e.key.toLowerCase()) {
      case 'tab':
        e.preventDefault();
        this.toggleMode();
        break;

      case 'g':
        store.setActiveTool('move');
        if (store.mode === 'edit') this.editModeEngine.startGrab();
        break;
      case 'r':
        store.setActiveTool('rotate');
        break;
      case 's':
        store.setActiveTool('scale');
        break;

      case 'e':
        if (store.mode === 'edit') this.editModeEngine.performExtrude(0.3);
        break;

      case '1':
        if (store.mode === 'edit') store.setEditSubMode('vertex');
        break;
      case '2':
        if (store.mode === 'edit') store.setEditSubMode('edge');
        break;
      case '3':
        if (store.mode === 'edit') store.setEditSubMode('face');
        break;

      case 'f':
        this.focusSelected();
        break;

      case 'x':
        if (!e.ctrlKey && !e.metaKey) {
          this.transformEngine.setAxisConstraint('X');
          if (store.mode === 'edit') this.editModeEngine.setGrabAxisConstraint('X');
        }
        break;
      case 'y':
        this.transformEngine.setAxisConstraint('Y');
        if (store.mode === 'edit') this.editModeEngine.setGrabAxisConstraint('Y');
        break;
      case 'z':
        if (!e.ctrlKey && !e.metaKey) {
          this.transformEngine.setAxisConstraint('Z');
          if (store.mode === 'edit') this.editModeEngine.setGrabAxisConstraint('Z');
        }
        break;

      case 'delete':
      case 'backspace':
        if (store.mode === 'object') {
          for (const id of [...store.selectedIds]) store.removeObject(id);
        }
        break;

      case 'a':
        if (e.shiftKey) {
          e.preventDefault();
          this.showAddMenuCb?.();
        } else if (store.mode === 'object') {
          store.selectAllToggle();
        }
        break;

      case 'j':
        if ((e.ctrlKey || e.metaKey) && store.mode === 'object') {
          e.preventDefault();
          this.performJoin();
        }
        break;

      case 'escape':
        store.setActiveTool('select');
        this.transformEngine.setAxisConstraint(null);
        if (store.mode === 'edit') {
          this.editModeEngine.cancelGrab();
          store.clearEditSelection();
        }
        break;
    }
  };

  private toggleMode() {
    const s = useEditorStore.getState();
    if (s.mode === 'object') {
      if (s.selectedIds.length === 1) {
        s.setMode('edit');
        s.setEditObjectId(s.selectedIds[0]);
      }
    } else {
      s.setMode('object');
      s.setEditObjectId(null);
    }
  }

  private performJoin() {
    const store = useEditorStore.getState();
    if (store.selectedIds.length < 2) return;
    const meshes: THREE.Mesh[] = [];
    for (const id of store.selectedIds) {
      const m = this.sceneManager.getMeshById(id);
      if (m && (m as THREE.Mesh).isMesh) meshes.push(m as THREE.Mesh);
    }
    const merged = joinMeshGeometries(meshes);
    if (!merged) return;
    const targetId = store.selectedIds[0];
    const targetObj = store.objects[targetId];
    for (let i = 1; i < store.selectedIds.length; i++) {
      store.removeObject(store.selectedIds[i]);
    }
    const rawMesh = this.sceneManager.getMeshById(targetId);
    const mesh = rawMesh && (rawMesh as THREE.Mesh).isMesh ? (rawMesh as THREE.Mesh) : null;
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = merged;
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      store.updateObject(targetId, {
        name: targetObj.name + ' (Joined)',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      });
    }
    store.setSelection([targetId]);
  }

  private focusSelected() {
    const store = useEditorStore.getState();
    const id = store.selectedIds[0];
    if (!id) return;
    const rawObj = this.sceneManager.getMeshById(id);
    if (!rawObj) return;
    const mesh = (rawObj as THREE.Mesh).isMesh ? (rawObj as THREE.Mesh) : null;
    if (mesh) mesh.geometry.computeBoundingSphere();
    const bs = mesh?.geometry.boundingSphere ?? null;
    const worldPos = new THREE.Vector3();
    rawObj.getWorldPosition(worldPos);
    this.viewport.focusOn(worldPos, bs ? bs.radius * Math.max(...rawObj.scale.toArray()) : 1);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
  }
}

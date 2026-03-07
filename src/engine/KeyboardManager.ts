import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import type { TransformEngine } from './TransformEngine';
import type { EditModeEngine } from './EditModeEngine';
import type { SceneManager } from './SceneManager';
import { joinMeshGeometries } from './MeshOperations';

export class KeyboardManager {
  private transformEngine: TransformEngine;
  private editModeEngine: EditModeEngine;
  private sceneManager: SceneManager;
  private showAddMenuCb: (() => void) | null = null;

  constructor(
    transformEngine: TransformEngine,
    editModeEngine: EditModeEngine,
    sceneManager: SceneManager,
  ) {
    this.transformEngine = transformEngine;
    this.editModeEngine = editModeEngine;
    this.sceneManager = sceneManager;
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

      case 'x':
        if (!e.ctrlKey && !e.metaKey)
          this.transformEngine.setAxisConstraint('X');
        break;
      case 'y':
        this.transformEngine.setAxisConstraint('Y');
        break;
      case 'z':
        if (!e.ctrlKey && !e.metaKey)
          this.transformEngine.setAxisConstraint('Z');
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
      if (m) meshes.push(m);
    }
    const merged = joinMeshGeometries(meshes);
    if (!merged) return;
    const targetId = store.selectedIds[0];
    const targetObj = store.objects[targetId];
    for (let i = 1; i < store.selectedIds.length; i++) {
      store.removeObject(store.selectedIds[i]);
    }
    const mesh = this.sceneManager.getMeshById(targetId);
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

  dispose() {
    window.removeEventListener('keydown', this.onKey);
  }
}

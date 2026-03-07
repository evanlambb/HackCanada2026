import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Viewport } from './Viewport';
import type { SceneManager } from './SceneManager';
import { useEditorStore } from '../store/editorStore';

export class TransformEngine {
  private viewport: Viewport;
  private sceneManager: SceneManager;
  controls: TransformControls;
  private unsub: () => void;

  constructor(viewport: Viewport, sceneManager: SceneManager) {
    this.viewport = viewport;
    this.sceneManager = sceneManager;

    this.controls = new TransformControls(
      viewport.camera,
      viewport.renderer.domElement,
    );
    this.controls.setSize(0.75);
    viewport.scene.add(this.controls.getHelper());

    this.controls.addEventListener('dragging-changed', (e) => {
      viewport.controls.enabled = !e.value;
    });

    this.controls.addEventListener('objectChange', () => {
      const obj = this.controls.object;
      if (!obj) return;
      const id = obj.userData.id;
      if (!id) return;
      useEditorStore.getState().updateObject(id, {
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      });
    });

    this.unsub = useEditorStore.subscribe((state, prev) => {
      if (
        state.selectedIds !== prev.selectedIds ||
        state.mode !== prev.mode
      ) {
        this.updateAttachment();
      }
      if (state.activeTool !== prev.activeTool) {
        this.applyToolMode(state.activeTool);
        this.updateCursor(state.activeTool);
      }
    });
    this.updateAttachment();
  }

  private updateAttachment() {
    const s = useEditorStore.getState();
    if (s.mode === 'edit') {
      this.controls.detach();
      return;
    }
    if (s.selectedIds.length === 1) {
      const mesh = this.sceneManager.getMeshById(s.selectedIds[0]);
      if (mesh) {
        this.controls.attach(mesh);
        this.applyToolMode(s.activeTool);
        return;
      }
    }
    this.controls.detach();
  }

  private applyToolMode(tool: string) {
    switch (tool) {
      case 'move':
        this.controls.setMode('translate');
        break;
      case 'rotate':
        this.controls.setMode('rotate');
        break;
      case 'scale':
        this.controls.setMode('scale');
        break;
      default:
        this.controls.setMode('translate');
        break;
    }
  }

  private updateCursor(tool: string) {
    const el = this.viewport.renderer.domElement;
    switch (tool) {
      case 'move':
        el.style.cursor = 'move';
        break;
      case 'rotate':
        el.style.cursor = 'alias';
        break;
      case 'scale':
        el.style.cursor = 'nesw-resize';
        break;
      default:
        el.style.cursor = '';
        break;
    }
  }

  setAxisConstraint(axis: 'X' | 'Y' | 'Z' | null) {
    if (!axis) {
      this.controls.showX = true;
      this.controls.showY = true;
      this.controls.showZ = true;
    } else {
      this.controls.showX = axis === 'X';
      this.controls.showY = axis === 'Y';
      this.controls.showZ = axis === 'Z';
    }
  }

  dispose() {
    this.unsub();
    this.controls.detach();
    this.controls.dispose();
  }
}

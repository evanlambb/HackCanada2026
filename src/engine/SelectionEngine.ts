import * as THREE from 'three';
import type { Viewport } from './Viewport';
import type { SceneManager } from './SceneManager';
import { useEditorStore } from '../store/editorStore';

export class SelectionEngine {
  private viewport: Viewport;
  private sceneManager: SceneManager;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private downPos = new THREE.Vector2();
  private isDown = false;

  constructor(viewport: Viewport, sceneManager: SceneManager) {
    this.viewport = viewport;
    this.sceneManager = sceneManager;
    const el = viewport.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.isDown = true;
    this.downPos.set(e.clientX, e.clientY);
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.isDown) return;
    this.isDown = false;
    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 4) return; // was a drag

    const store = useEditorStore.getState();
    if (store.mode === 'edit') return;

    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.viewport.camera);
    const hits = this.raycaster.intersectObjects(
      this.sceneManager.getMeshes(),
      false,
    );

    if (hits.length > 0) {
      const id = hits[0].object.userData.id as string | undefined;
      if (!id) return;
      if (e.shiftKey) {
        if (store.selectedIds.includes(id)) store.removeFromSelection(id);
        else store.addToSelection(id);
      } else {
        store.setSelection([id]);
      }
    } else if (!e.shiftKey) {
      store.setSelection([]);
    }
  };

  dispose() {
    const el = this.viewport.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
  }
}

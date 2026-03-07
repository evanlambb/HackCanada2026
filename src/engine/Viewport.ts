import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  container: HTMLDivElement;

  private gridHelper: THREE.GridHelper;
  private axesHelper: THREE.AxesHelper;
  private animationId = 0;
  private renderCallbacks: Array<() => void> = [];
  private lastW = 0;
  private lastH = 0;
  private clock = new THREE.Clock();
  private _lastDelta = 0;

  constructor(container: HTMLDivElement) {
    this.container = container;

    const initW = Math.max(1, container.clientWidth);
    const initH = Math.max(1, container.clientHeight);
    this.lastW = initW;
    this.lastH = initH;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x111111);
    this.renderer.setSize(initW, initH, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, initW / initH, 0.1, 1000);
    this.camera.position.set(5, 4, 5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.mouseButtons = {
      LEFT: -1 as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };

    // Alt+left-click orbit: capture-phase listener fires before OrbitControls
    container.addEventListener('pointerdown', this.onAltPointerDown, true);
    container.addEventListener('pointerup', this.onAltPointerUp, true);

    this.gridHelper = new THREE.GridHelper(20, 20, 0x2a2a2a, 0x1a1a1a);
    this.scene.add(this.gridHelper);

    this.axesHelper = new THREE.AxesHelper(2);
    this.scene.add(this.axesHelper);

    const ambient = new THREE.AmbientLight(0x404040, 2);
    this.scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 1.5);
    dir1.position.set(5, 10, 7);
    this.scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dir2.position.set(-5, 5, -5);
    this.scene.add(dir2);

    this.animate();
  }

  getDelta() {
    return this._lastDelta;
  }

  onRender(cb: () => void) {
    this.renderCallbacks.push(cb);
  }

  /**
   * Captures a clean screenshot at a fixed 3/4 view (front-right, elevated).
   * If selectedIds is non-empty, only those meshes are visible and the camera
   * frames their bounding box; other user meshes are hidden during capture.
   * Call onBefore to hide transform gizmo and edit overlays; onAfter to restore.
   */
  captureScreenshot(
    onBefore?: () => void,
    onAfter?: () => void,
    selectedIds: string[] = [],
  ): string {
    onBefore?.();
    this.gridHelper.visible = false;
    this.axesHelper.visible = false;
    const prevBg = this.scene.background;
    this.scene.background = new THREE.Color(0xd0d0d0);

    const prevPos = this.camera.position.clone();
    const prevTarget = this.controls.target.clone();

    const selectedSet = new Set(selectedIds);
    const hidden: THREE.Object3D[] = [];
    const box = new THREE.Box3();

    this.scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh || !obj.userData.id) return;
      const id = obj.userData.id as string;
      if (selectedSet.size > 0) {
        if (!selectedSet.has(id)) {
          hidden.push(obj);
          obj.visible = false;
        } else {
          box.expandByObject(obj);
        }
      } else {
        box.expandByObject(obj);
      }
    });

    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dir = new THREE.Vector3(1, 0.75, 1).normalize();
      const dist = Math.max(sphere.radius * 2.5, 3);
      this.camera.position.copy(center).addScaledVector(dir, dist);
      this.controls.target.copy(center);
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');

    for (const obj of hidden) obj.visible = true;
    this.scene.background = prevBg;
    this.gridHelper.visible = true;
    this.axesHelper.visible = true;
    this.camera.position.copy(prevPos);
    this.controls.target.copy(prevTarget);
    this.controls.update();
    onAfter?.();
    return dataUrl;
  }

  focusOn(position: THREE.Vector3, boundingRadius = 1) {
    this.controls.target.copy(position);
    const dir = this.camera.position.clone().sub(position).normalize();
    const dist = Math.max(boundingRadius * 3, 2);
    this.camera.position.copy(position).addScaledVector(dir, dist);
    this.controls.update();
  }

  /* Alt+drag orbit helpers */

  private onAltPointerDown = (e: PointerEvent) => {
    if (e.button === 0 && e.altKey) {
      this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    }
  };

  private onAltPointerUp = (e: PointerEvent) => {
    if (e.button === 0) {
      this.controls.mouseButtons.LEFT = -1 as unknown as THREE.MOUSE;
    }
  };

  /* Resize handling */

  private onResize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);
    this._lastDelta = this.clock.getDelta();

    // Safety-net: detect size mismatch each frame (fixes FlexLayout late layout)
    const cw = Math.max(1, this.container.clientWidth);
    const ch = Math.max(1, this.container.clientHeight);
    if (cw !== this.lastW || ch !== this.lastH) {
      this.onResize();
    }

    this.controls.update();
    for (const cb of this.renderCallbacks) cb();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.container.removeEventListener('pointerdown', this.onAltPointerDown, true);
    this.container.removeEventListener('pointerup', this.onAltPointerUp, true);
    this.controls.dispose();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

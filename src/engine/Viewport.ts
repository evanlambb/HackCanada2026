import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  container: HTMLDivElement;

  private animationId = 0;
  private renderCallbacks: Array<() => void> = [];
  private lastW = 0;
  private lastH = 0;
  private clock = new THREE.Clock();
  private _lastDelta = 0;

  // VR properties
  private xrEnabled = false;
  private vrDolly: THREE.Group | null = null;
  private xrControllers: THREE.Group[] = [];
  private xrControllerGrips: THREE.Group[] = [];
  private teleportMarker: THREE.Mesh | null = null;
  private xrFloorPlane: THREE.Mesh | null = null;
  private xrRaycaster = new THREE.Raycaster();

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

    const grid = new THREE.GridHelper(20, 20, 0x2a2a2a, 0x1a1a1a);
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(2);
    this.scene.add(axes);

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

  focusOn(position: THREE.Vector3, boundingRadius = 1) {
    this.controls.target.copy(position);
    const dir = this.camera.position.clone().sub(position).normalize();
    const dist = Math.max(boundingRadius * 3, 2);
    this.camera.position.copy(position).addScaledVector(dir, dist);
    this.controls.update();
  }

  enableXR(): void {
    if (this.xrEnabled) return;
    this.xrEnabled = true;

    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    // Create VR dolly positioned at current camera world pos.
    // Camera becomes a child at local (0,0,0); XR tracking moves it relative to dolly.
    this.vrDolly = new THREE.Group();
    this.vrDolly.position.copy(this.camera.position);
    this.scene.add(this.vrDolly);
    this.vrDolly.add(this.camera);
    this.camera.position.set(0, 0, 0);

    // Disable desktop orbit controls while the headset drives the camera
    this.controls.enabled = false;

    // Controllers with ray lines and grip models
    const factory = new XRControllerModelFactory();
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.addEventListener('selectend', this.onSelectEnd);
      this.vrDolly.add(controller);
      this.xrControllers.push(controller as unknown as THREE.Group);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      this.vrDolly.add(grip);
      this.xrControllerGrips.push(grip as unknown as THREE.Group);

      // Pointing ray
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
      line.name = 'line';
      line.scale.z = 5;
      controller.add(line);
    }

    // Teleport destination ring
    const markerGeo = new THREE.RingGeometry(0.25, 0.3, 32);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
    this.teleportMarker = new THREE.Mesh(markerGeo, markerMat);
    this.teleportMarker.rotation.x = -Math.PI / 2;
    this.teleportMarker.visible = false;
    this.scene.add(this.teleportMarker);

    // Invisible floor plane mesh used as a raycast target
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshBasicMaterial({ visible: false });
    this.xrFloorPlane = new THREE.Mesh(floorGeo, floorMat);
    this.xrFloorPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.xrFloorPlane);

    // Switch from RAF to the XR-managed animation loop
    cancelAnimationFrame(this.animationId);
    this.animationId = 0;
    this.renderer.setAnimationLoop(this.tick);
  }

  disableXR(): void {
    if (!this.xrEnabled) return;
    this.xrEnabled = false;

    this.renderer.setAnimationLoop(null);

    this.controls.enabled = true;

    // Restore camera to world space, preserving world transform
    if (this.vrDolly) {
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      this.camera.getWorldPosition(worldPos);
      this.camera.getWorldQuaternion(worldQuat);
      this.vrDolly.remove(this.camera);
      this.scene.remove(this.vrDolly);
      this.camera.position.copy(worldPos);
      this.camera.quaternion.copy(worldQuat);
      this.vrDolly = null;
    }

    // Cleanup controllers
    for (const c of this.xrControllers) {
      c.removeEventListener('selectend', this.onSelectEnd);
    }
    this.xrControllers = [];
    this.xrControllerGrips = [];

    if (this.teleportMarker) {
      this.scene.remove(this.teleportMarker);
      this.teleportMarker.geometry.dispose();
      (this.teleportMarker.material as THREE.Material).dispose();
      this.teleportMarker = null;
    }

    if (this.xrFloorPlane) {
      this.scene.remove(this.xrFloorPlane);
      this.xrFloorPlane.geometry.dispose();
      (this.xrFloorPlane.material as THREE.Material).dispose();
      this.xrFloorPlane = null;
    }

    this.renderer.xr.enabled = false;

    // Resume normal RAF loop
    this.animationId = requestAnimationFrame(this.animate);
  }

  private onSelectEnd = (): void => {
    if (this.teleportMarker?.visible && this.vrDolly) {
      this.vrDolly.position.copy(this.teleportMarker.position);
    }
  };

  private updateTeleport(): void {
    if (!this.xrEnabled || !this.teleportMarker || !this.xrFloorPlane) return;

    const controller = this.xrControllers[0];
    if (!controller) return;

    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);

    this.xrRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.xrRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = this.xrRaycaster.intersectObject(this.xrFloorPlane);
    if (intersects.length > 0) {
      this.teleportMarker.position.copy(intersects[0].point);
      this.teleportMarker.visible = true;
    } else {
      this.teleportMarker.visible = false;
    }
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

  // Core render work — called by both the RAF loop and the XR animation loop
  private tick = (): void => {
    this._lastDelta = this.clock.getDelta();

    if (this.xrEnabled) {
      this.updateTeleport();
    } else {
      this.controls.update();
    }

    for (const cb of this.renderCallbacks) cb();
    this.renderer.render(this.scene, this.camera);
  };

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);

    // Safety-net: detect size mismatch each frame (fixes FlexLayout late layout)
    const cw = Math.max(1, this.container.clientWidth);
    const ch = Math.max(1, this.container.clientHeight);
    if (cw !== this.lastW || ch !== this.lastH) {
      this.onResize();
    }

    this.tick();
  };

  dispose() {
    if (this.xrEnabled) {
      this.disableXR();
    }
    cancelAnimationFrame(this.animationId);
    this.renderer.setAnimationLoop(null);
    this.container.removeEventListener('pointerdown', this.onAltPointerDown, true);
    this.container.removeEventListener('pointerup', this.onAltPointerUp, true);
    this.controls.dispose();
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

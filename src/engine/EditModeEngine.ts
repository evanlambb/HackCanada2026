import * as THREE from 'three';
import type { Viewport } from './Viewport';
import type { SceneManager } from './SceneManager';
import { useEditorStore } from '../store/editorStore';
import { buildEdgeList, extrudeFaces, type EdgeData } from './MeshOperations';

export class EditModeEngine {
  private viewport: Viewport;
  private sceneManager: SceneManager;

  private vertexPoints: THREE.Points | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private faceHighlight: THREE.Mesh | null = null;

  private editGeometry: THREE.BufferGeometry | null = null;
  private edges: EdgeData[] = [];

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private downPos = new THREE.Vector2();
  private isDown = false;

  private grabbing = false;
  private grabStart = new THREE.Vector2();
  private grabOrigins: Float32Array | null = null;
  private grabVertexSet = new Set<number>();
  private grabPlane = new THREE.Plane();
  private grabStartWorld = new THREE.Vector3();
  private grabAxisConstraint: 'X' | 'Y' | 'Z' | null = null;
  private axisLine: THREE.Line | null = null;

  private unsub: () => void;

  constructor(viewport: Viewport, sceneManager: SceneManager) {
    this.viewport = viewport;
    this.sceneManager = sceneManager;
    this.raycaster.params.Points = { threshold: 0.1 };

    const el = viewport.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointermove', this.onMove);

    this.unsub = useEditorStore.subscribe((state, prev) => {
      if (
        state.mode !== prev.mode ||
        state.editObjectId !== prev.editObjectId
      ) {
        if (state.mode === 'edit' && state.editObjectId) {
          this.enterEditMode(state.editObjectId);
        } else if (state.mode === 'object') {
          this.exitEditMode();
        }
      }
      if (state.mode === 'edit') {
        if (state.editSubMode !== prev.editSubMode) this.rebuildOverlays();
        if (
          state.selectedVertices !== prev.selectedVertices ||
          state.selectedEdges !== prev.selectedEdges ||
          state.selectedFaces !== prev.selectedFaces
        )
          this.updateHighlights();
      }
    });
  }

  /* ---- mode entry / exit ---- */

  private getEditMesh(): THREE.Mesh | null {
    const id = useEditorStore.getState().editObjectId;
    if (!id) return null;
    return this.sceneManager.getMeshById(id) ?? null;
  }

  enterEditMode(objectId: string) {
    this.exitEditMode();
    const mesh = this.sceneManager.getMeshById(objectId);
    if (!mesh) return;

    let geo = mesh.geometry;
    if (!geo.index) {
      const count = geo.attributes.position.count;
      const idx: number[] = [];
      for (let i = 0; i < count; i++) idx.push(i);
      geo.setIndex(idx);
    }

    this.editGeometry = geo;
    this.edges = buildEdgeList(geo);

    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0.4;

    this.rebuildOverlays();

    this.viewport.controls.mouseButtons.LEFT = -1 as unknown as THREE.MOUSE;
  }

  exitEditMode() {
    this.clearOverlays();
    this.removeAxisLine();
    const mesh = this.getEditMesh();
    if (mesh) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = false;
      mat.opacity = 1;
    }
    this.editGeometry = null;
    this.edges = [];
    this.viewport.controls.mouseButtons.LEFT = -1 as unknown as THREE.MOUSE;
    useEditorStore.getState().clearEditSelection();
  }

  /* ---- overlays ---- */

  private clearOverlays() {
    for (const obj of [this.vertexPoints, this.edgeLines, this.faceHighlight]) {
      if (obj) {
        this.viewport.scene.remove(obj);
        obj.geometry.dispose();
        if (Array.isArray((obj as THREE.Mesh).material)) {
          for (const m of (obj as THREE.Mesh).material as THREE.Material[])
            m.dispose();
        } else {
          ((obj as THREE.Mesh).material as THREE.Material).dispose();
        }
      }
    }
    this.vertexPoints = null;
    this.edgeLines = null;
    this.faceHighlight = null;
  }

  rebuildOverlays() {
    this.clearOverlays();
    const mesh = this.getEditMesh();
    if (!mesh || !this.editGeometry) return;
    this.buildVertexOverlay(mesh);
    this.buildEdgeOverlay(mesh);
    const sub = useEditorStore.getState().editSubMode;
    if (sub === 'face') this.buildFaceOverlay(mesh);
    this.updateHighlights();
  }

  private buildVertexOverlay(mesh: THREE.Mesh) {
    const pos = this.editGeometry!.attributes.position;
    const unique: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(5)}_${pos.getY(i).toFixed(5)}_${pos.getZ(i).toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(unique, 3));
    const colors = new Float32Array(unique.length);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = 0.9;
      colors[i + 1] = 0.9;
      colors[i + 2] = 0.9;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 8,
      sizeAttenuation: false,
      vertexColors: true,
      depthTest: false,
    });
    this.vertexPoints = new THREE.Points(geo, mat);
    this.vertexPoints.matrixAutoUpdate = false;
    this.vertexPoints.matrix.copy(mesh.matrixWorld);
    this.vertexPoints.renderOrder = 999;
    this.viewport.scene.add(this.vertexPoints);
  }

  private buildEdgeOverlay(mesh: THREE.Mesh) {
    if (!this.editGeometry) return;
    const pos = this.editGeometry.attributes.position;
    const arr: number[] = [];
    for (const e of this.edges) {
      arr.push(
        pos.getX(e.a), pos.getY(e.a), pos.getZ(e.a),
        pos.getX(e.b), pos.getY(e.b), pos.getZ(e.b),
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const colors = new Float32Array(arr.length);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = 0.35;
      colors[i + 1] = 0.35;
      colors[i + 2] = 0.35;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
    this.edgeLines = new THREE.LineSegments(geo, mat);
    this.edgeLines.matrixAutoUpdate = false;
    this.edgeLines.matrix.copy(mesh.matrixWorld);
    this.edgeLines.renderOrder = 998;
    this.viewport.scene.add(this.edgeLines);
  }

  private buildFaceOverlay(mesh: THREE.Mesh) {
    if (!this.editGeometry) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4a90d9,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.faceHighlight = new THREE.Mesh(this.editGeometry.clone(), mat);
    this.faceHighlight.matrixAutoUpdate = false;
    this.faceHighlight.matrix.copy(mesh.matrixWorld);
    this.faceHighlight.renderOrder = 997;
    this.viewport.scene.add(this.faceHighlight);
  }

  /* ---- highlight updates ---- */

  updateHighlights() {
    const state = useEditorStore.getState();

    if (this.vertexPoints) {
      const c = this.vertexPoints.geometry.attributes.color;
      if (c) {
        for (let i = 0; i < c.count; i++) {
          if (state.selectedVertices.has(i)) c.setXYZ(i, 1, 0.5, 0);
          else c.setXYZ(i, 0.9, 0.9, 0.9);
        }
        c.needsUpdate = true;
      }
    }

    if (this.edgeLines) {
      const c = this.edgeLines.geometry.attributes.color;
      if (c) {
        for (let i = 0; i < this.edges.length; i++) {
          if (state.selectedEdges.has(i)) {
            c.setXYZ(i * 2, 1, 0.5, 0);
            c.setXYZ(i * 2 + 1, 1, 0.5, 0);
          } else {
            c.setXYZ(i * 2, 0.35, 0.35, 0.35);
            c.setXYZ(i * 2 + 1, 0.35, 0.35, 0.35);
          }
        }
        c.needsUpdate = true;
      }
    }

    if (this.faceHighlight && this.editGeometry) {
      if (state.selectedFaces.size > 0) {
        const pos = this.editGeometry.attributes.position;
        const idx = this.editGeometry.index!;
        const verts: number[] = [];
        const idxArr: number[] = [];
        for (const fi of state.selectedFaces) {
          const base = verts.length / 3;
          for (let j = 0; j < 3; j++) {
            const vi = idx.getX(fi * 3 + j);
            verts.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
          }
          idxArr.push(base, base + 1, base + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        g.setIndex(idxArr);
        this.faceHighlight.geometry.dispose();
        this.faceHighlight.geometry = g;
        (this.faceHighlight.material as THREE.MeshBasicMaterial).opacity = 0.35;
      } else {
        (this.faceHighlight.material as THREE.MeshBasicMaterial).opacity = 0;
      }
    }
  }

  /* ---- pointer handlers ---- */

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (useEditorStore.getState().mode !== 'edit') return;
    this.isDown = true;
    this.downPos.set(e.clientX, e.clientY);
  };

  private onUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.isDown) return;
    this.isDown = false;
    if (useEditorStore.getState().mode !== 'edit') return;

    if (this.grabbing) {
      this.grabbing = false;
      this.grabOrigins = null;
      this.grabVertexSet.clear();
      this.grabAxisConstraint = null;
      this.removeAxisLine();
      this.viewport.renderer.domElement.style.cursor = '';
      return;
    }

    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 4) return;

    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.viewport.camera);

    const sub = useEditorStore.getState().editSubMode;
    if (sub === 'vertex') this.pickVertex(e.shiftKey);
    else if (sub === 'edge') this.pickEdge(e.shiftKey);
    else if (sub === 'face') this.pickFace(e.shiftKey);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.grabbing || !this.editGeometry || !this.grabOrigins) return;
    const mesh = this.getEditMesh();
    if (!mesh) return;

    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.viewport.camera);
    const hitPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.grabPlane, hitPoint)) return;

    const delta = hitPoint.clone().sub(this.grabStartWorld);
    const inv = mesh.matrixWorld.clone().invert();
    const localDelta = delta.clone().transformDirection(inv);

    if (this.grabAxisConstraint === 'X') { localDelta.y = 0; localDelta.z = 0; }
    if (this.grabAxisConstraint === 'Y') { localDelta.x = 0; localDelta.z = 0; }
    if (this.grabAxisConstraint === 'Z') { localDelta.x = 0; localDelta.y = 0; }

    const pos = this.editGeometry.attributes.position;
    let oi = 0;
    for (const vi of this.grabVertexSet) {
      pos.setX(vi, this.grabOrigins[oi * 3] + localDelta.x);
      pos.setY(vi, this.grabOrigins[oi * 3 + 1] + localDelta.y);
      pos.setZ(vi, this.grabOrigins[oi * 3 + 2] + localDelta.z);
      oi++;
    }
    pos.needsUpdate = true;
    this.editGeometry.computeVertexNormals();
    this.editGeometry.computeBoundingSphere();
    this.rebuildOverlays();
  };

  startGrab() {
    if (!this.editGeometry) return;
    const state = useEditorStore.getState();
    if (state.mode !== 'edit') return;
    const mesh = this.getEditMesh();
    if (!mesh) return;

    this.grabAxisConstraint = null;
    const pos = this.editGeometry.attributes.position;
    const verts = new Set<number>();

    if (state.editSubMode === 'vertex') {
      for (const vi of state.selectedVertices) {
        for (const bi of this.bufferIndicesForUniqueVert(vi)) verts.add(bi);
      }
    } else if (state.editSubMode === 'edge') {
      for (const ei of state.selectedEdges) {
        verts.add(this.edges[ei].a);
        verts.add(this.edges[ei].b);
      }
    } else {
      const idx = this.editGeometry.index!;
      for (const fi of state.selectedFaces) {
        verts.add(idx.getX(fi * 3));
        verts.add(idx.getX(fi * 3 + 1));
        verts.add(idx.getX(fi * 3 + 2));
      }
    }
    if (verts.size === 0) return;

    this.grabVertexSet = verts;
    const origins = new Float32Array(verts.size * 3);
    let i = 0;
    for (const vi of verts) {
      origins[i * 3] = pos.getX(vi);
      origins[i * 3 + 1] = pos.getY(vi);
      origins[i * 3 + 2] = pos.getZ(vi);
      i++;
    }
    this.grabOrigins = origins;

    const centroid = new THREE.Vector3();
    for (const vi of verts) {
      centroid.x += pos.getX(vi);
      centroid.y += pos.getY(vi);
      centroid.z += pos.getZ(vi);
    }
    centroid.divideScalar(verts.size);
    centroid.applyMatrix4(mesh.matrixWorld);

    const camDir = this.viewport.camera.getWorldDirection(new THREE.Vector3());
    this.grabPlane.setFromNormalAndCoplanarPoint(camDir, centroid);
    this.grabStartWorld.copy(centroid);
    this.grabbing = true;
    this.viewport.renderer.domElement.style.cursor = 'grabbing';
  }

  cancelGrab() {
    if (!this.grabbing || !this.editGeometry || !this.grabOrigins) return;
    const pos = this.editGeometry.attributes.position;
    let i = 0;
    for (const vi of this.grabVertexSet) {
      pos.setX(vi, this.grabOrigins[i * 3]);
      pos.setY(vi, this.grabOrigins[i * 3 + 1]);
      pos.setZ(vi, this.grabOrigins[i * 3 + 2]);
      i++;
    }
    pos.needsUpdate = true;
    this.editGeometry.computeVertexNormals();
    this.rebuildOverlays();
    this.grabbing = false;
    this.grabOrigins = null;
    this.grabVertexSet.clear();
    this.grabAxisConstraint = null;
    this.removeAxisLine();
    this.viewport.renderer.domElement.style.cursor = '';
  }

  setGrabAxisConstraint(axis: 'X' | 'Y' | 'Z' | null) {
    this.grabAxisConstraint = axis;
    this.updateAxisLine();
  }

  private updateAxisLine() {
    if (this.axisLine) {
      this.viewport.scene.remove(this.axisLine);
      this.axisLine.geometry.dispose();
      (this.axisLine.material as THREE.Material).dispose();
      this.axisLine = null;
    }

    if (!this.grabAxisConstraint || !this.grabbing) return;

    const colors: Record<string, number> = { X: 0xff4444, Y: 0x44ff44, Z: 0x4488ff };
    const dirs: Record<string, THREE.Vector3> = {
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
      Z: new THREE.Vector3(0, 0, 1),
    };
    const color = colors[this.grabAxisConstraint];
    const dir = dirs[this.grabAxisConstraint];
    const origin = this.grabStartWorld;
    const len = 50;
    const pts = [
      origin.clone().addScaledVector(dir, -len),
      origin.clone().addScaledVector(dir, len),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 1 });
    this.axisLine = new THREE.Line(geo, mat);
    this.axisLine.renderOrder = 1000;
    this.viewport.scene.add(this.axisLine);
  }

  private removeAxisLine() {
    if (this.axisLine) {
      this.viewport.scene.remove(this.axisLine);
      this.axisLine.geometry.dispose();
      (this.axisLine.material as THREE.Material).dispose();
      this.axisLine = null;
    }
  }

  /* ---- picking ---- */

  private pickVertex(add: boolean) {
    if (!this.vertexPoints) return;
    const hits = this.raycaster.intersectObject(this.vertexPoints);
    if (hits.length > 0 && hits[0].index !== undefined) {
      const s = useEditorStore.getState();
      if (add) {
        s.toggleVertex(hits[0].index);
      } else {
        const n = new Set<number>();
        n.add(hits[0].index);
        s.setSelectedVertices(n);
      }
    } else if (!add) {
      useEditorStore.getState().setSelectedVertices(new Set());
    }
  }

  private pickEdge(add: boolean) {
    if (!this.editGeometry) return;
    const mesh = this.getEditMesh();
    if (!mesh) return;
    const pos = this.editGeometry.attributes.position;
    let best = -1;
    let bestDist = 0.15;
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      const a = new THREE.Vector3(pos.getX(e.a), pos.getY(e.a), pos.getZ(e.a)).applyMatrix4(mesh.matrixWorld);
      const b = new THREE.Vector3(pos.getX(e.b), pos.getY(e.b), pos.getZ(e.b)).applyMatrix4(mesh.matrixWorld);
      const d = this.raySegDist(this.raycaster.ray, a, b);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    const s = useEditorStore.getState();
    if (best >= 0) {
      if (add) s.toggleEdge(best);
      else {
        const n = new Set<number>();
        n.add(best);
        s.setSelectedEdges(n);
      }
    } else if (!add) {
      s.setSelectedEdges(new Set());
    }
  }

  private pickFace(add: boolean) {
    const mesh = this.getEditMesh();
    if (!mesh) return;
    const hits = this.raycaster.intersectObject(mesh);
    if (hits.length > 0 && hits[0].faceIndex != null) {
      const fi = hits[0].faceIndex!;
      const s = useEditorStore.getState();
      if (add) s.toggleFace(fi);
      else {
        const n = new Set<number>();
        n.add(fi);
        s.setSelectedFaces(n);
      }
    } else if (!add) {
      useEditorStore.getState().setSelectedFaces(new Set());
    }
  }

  private raySegDist(ray: THREE.Ray, a: THREE.Vector3, b: THREE.Vector3): number {
    const seg = b.clone().sub(a);
    const len = seg.length();
    seg.normalize();
    const diff = ray.origin.clone().sub(a);
    const d1 = ray.direction.dot(seg);
    const d3 = seg.dot(diff);
    const denom = 1 - d1 * d1;
    if (Math.abs(denom) < 1e-6) {
      return diff.clone().sub(seg.clone().multiplyScalar(d3)).length();
    }
    const d2 = ray.direction.dot(diff);
    let t = (d1 * d3 - d2) / denom;
    let s = d1 * t + d3;
    t = Math.max(0, t);
    s = Math.max(0, Math.min(len, s));
    const pRay = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    const pSeg = a.clone().add(seg.clone().multiplyScalar(s));
    return pRay.distanceTo(pSeg);
  }

  /* ---- edit operations ---- */

  moveSelected(delta: THREE.Vector3) {
    if (!this.editGeometry) return;
    const state = useEditorStore.getState();
    const pos = this.editGeometry.attributes.position;
    const mesh = this.getEditMesh();
    if (!mesh) return;
    const inv = mesh.matrixWorld.clone().invert();
    const local = delta.clone().transformDirection(inv);
    const verts = new Set<number>();

    if (state.editSubMode === 'vertex') {
      for (const vi of state.selectedVertices) {
        for (const bi of this.bufferIndicesForUniqueVert(vi)) verts.add(bi);
      }
    } else if (state.editSubMode === 'edge') {
      for (const ei of state.selectedEdges) {
        verts.add(this.edges[ei].a);
        verts.add(this.edges[ei].b);
      }
    } else {
      const idx = this.editGeometry.index!;
      for (const fi of state.selectedFaces) {
        verts.add(idx.getX(fi * 3));
        verts.add(idx.getX(fi * 3 + 1));
        verts.add(idx.getX(fi * 3 + 2));
      }
    }

    for (const vi of verts) {
      pos.setX(vi, pos.getX(vi) + local.x);
      pos.setY(vi, pos.getY(vi) + local.y);
      pos.setZ(vi, pos.getZ(vi) + local.z);
    }
    pos.needsUpdate = true;
    this.editGeometry.computeVertexNormals();
    this.editGeometry.computeBoundingSphere();
    this.rebuildOverlays();
  }

  private bufferIndicesForUniqueVert(uid: number): number[] {
    if (!this.editGeometry) return [];
    const pos = this.editGeometry.attributes.position;
    const uniq: Array<[number, number, number]> = [];
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(5)}_${pos.getY(i).toFixed(5)}_${pos.getZ(i).toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
      }
    }
    if (uid >= uniq.length) return [];
    const [tx, ty, tz] = uniq[uid];
    const out: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (
        Math.abs(pos.getX(i) - tx) < 1e-5 &&
        Math.abs(pos.getY(i) - ty) < 1e-5 &&
        Math.abs(pos.getZ(i) - tz) < 1e-5
      )
        out.push(i);
    }
    return out;
  }

  performExtrude(distance = 0.3) {
    const state = useEditorStore.getState();
    if (state.editSubMode !== 'face' || state.selectedFaces.size === 0) return;
    if (!this.editGeometry) return;
    const newGeo = extrudeFaces(this.editGeometry, state.selectedFaces, distance);
    const mesh = this.getEditMesh();
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = newGeo;
      this.editGeometry = newGeo;
      this.edges = buildEdgeList(newGeo);
      state.clearEditSelection();
      this.rebuildOverlays();
    }
  }

  setOverlaysVisible(visible: boolean) {
    if (this.vertexPoints) this.vertexPoints.visible = visible;
    if (this.edgeLines) this.edgeLines.visible = visible;
    if (this.faceHighlight) this.faceHighlight.visible = visible;
    if (this.axisLine) this.axisLine.visible = visible;
  }

  dispose() {
    this.unsub();
    this.clearOverlays();
    this.removeAxisLine();
    const el = this.viewport.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointermove', this.onMove);
  }
}

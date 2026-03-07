import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GeometryType } from '../store/types';

export function createGeometry(type: GeometryType): THREE.BufferGeometry {
  switch (type) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 32, 16);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 32);
    case 'torus':
      return new THREE.TorusGeometry(0.4, 0.15, 16, 32);
    case 'plane':
      return new THREE.PlaneGeometry(1, 1);
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(0.5, 0);
    case 'imported':
      return new THREE.BoxGeometry(1, 1, 1);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function joinMeshGeometries(
  meshes: THREE.Mesh[],
): THREE.BufferGeometry | null {
  if (meshes.length === 0) return null;
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    const g = m.geometry.clone();
    m.updateMatrixWorld();
    g.applyMatrix4(m.matrixWorld);
    geos.push(g);
  }
  return mergeGeometries(geos, false);
}

export interface EdgeData {
  a: number;
  b: number;
}

export function buildEdgeList(geo: THREE.BufferGeometry): EdgeData[] {
  const idx = geo.index;
  if (!idx) return [];
  const set = new Set<string>();
  const edges: EdgeData[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const tri = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    const pairs: [number, number][] = [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ];
    for (const [p, q] of pairs) {
      const lo = Math.min(p, q);
      const hi = Math.max(p, q);
      const key = `${lo}_${hi}`;
      if (!set.has(key)) {
        set.add(key);
        edges.push({ a: lo, b: hi });
      }
    }
  }
  return edges;
}

export interface ExtrudeResult {
  geometry: THREE.BufferGeometry;
  normal: THREE.Vector3;
  newVertexIndices: Set<number>;
  /** Maps side-face duplicate vertex index → master extruded vertex index it must follow */
  followers: Map<number, number>;
}

export function extrudeFaces(
  geometry: THREE.BufferGeometry,
  faceIndices: Set<number>,
  distance: number,
): ExtrudeResult {
  const posAttr = geometry.attributes.position;
  const indexAttr = geometry.index;
  if (!indexAttr) return { geometry, normal: new THREE.Vector3(0, 1, 0), newVertexIndices: new Set(), followers: new Map() };

  const positions = Array.from(posAttr.array as Float32Array);
  const indices = Array.from(indexAttr.array);

  const vertexMap = new Map<number, number>();

  // Collect per-face normals and find shared boundary edges
  const faceNormals: THREE.Vector3[] = [];
  const edgeCount = new Map<string, number>();

  for (const fi of faceIndices) {
    const i0 = indices[fi * 3];
    const i1 = indices[fi * 3 + 1];
    const i2 = indices[fi * 3 + 2];
    const v0 = new THREE.Vector3(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    const v1 = new THREE.Vector3(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    const v2 = new THREE.Vector3(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
    const n = new THREE.Vector3().crossVectors(
      v1.clone().sub(v0),
      v2.clone().sub(v0),
    ).normalize();
    faceNormals.push(n);

    // Track edges to find boundary (non-shared) edges for side faces
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = `${Math.min(a, b)}_${Math.max(a, b)}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }

    // Duplicate vertices
    for (const vi of [i0, i1, i2]) {
      if (!vertexMap.has(vi)) {
        const newIdx = positions.length / 3;
        vertexMap.set(vi, newIdx);
        positions.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
      }
    }
  }

  // Compute average normal for displacement direction
  const avgN = new THREE.Vector3();
  for (const n of faceNormals) avgN.add(n);
  avgN.divideScalar(faceNormals.length).normalize();

  // Offset new vertices along average normal
  const newVertexIndices = new Set<number>();
  for (const [, ni] of vertexMap) {
    positions[ni * 3] += avgN.x * distance;
    positions[ni * 3 + 1] += avgN.y * distance;
    positions[ni * 3 + 2] += avgN.z * distance;
    newVertexIndices.add(ni);
  }

  const followers = new Map<number, number>();

  // Rewire selected faces to use new (extruded) vertices
  // and create side faces only on boundary edges
  for (const fi of faceIndices) {
    const i0 = indices[fi * 3];
    const i1 = indices[fi * 3 + 1];
    const i2 = indices[fi * 3 + 2];
    const n0 = vertexMap.get(i0)!;
    const n1 = vertexMap.get(i1)!;
    const n2 = vertexMap.get(i2)!;

    // Rewire face to extruded vertices
    indices[fi * 3] = n0;
    indices[fi * 3 + 1] = n1;
    indices[fi * 3 + 2] = n2;

    // Create side quads on boundary edges with duplicate vertices for hard normals
    for (const [a, b, na, nb] of [
      [i0, i1, n0, n1],
      [i1, i2, n1, n2],
      [i2, i0, n2, n0],
    ] as [number, number, number, number][]) {
      const key = `${Math.min(a, b)}_${Math.max(a, b)}`;
      if ((edgeCount.get(key) ?? 0) <= 1) {
        const sa = positions.length / 3;
        positions.push(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
        const sb = positions.length / 3;
        positions.push(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
        const sna = positions.length / 3;
        positions.push(positions[na * 3], positions[na * 3 + 1], positions[na * 3 + 2]);
        const snb = positions.length / 3;
        positions.push(positions[nb * 3], positions[nb * 3 + 1], positions[nb * 3 + 2]);
        indices.push(sa, sb, snb);
        indices.push(sa, snb, sna);
        // Track extruded-side duplicates as followers of their masters
        followers.set(sna, na);
        followers.set(snb, nb);
      }
    }
  }

  // Add follower vertices to the movable set so they're included in the grab
  for (const fi of followers.keys()) newVertexIndices.add(fi);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geometry: geo, normal: avgN, newVertexIndices, followers };
}

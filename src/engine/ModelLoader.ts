import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface LoadedModel {
  name: string;
  geometry: THREE.BufferGeometry;
  animations: THREE.AnimationClip[];
  /** Original scene root, only set when animations are present */
  scene: THREE.Object3D | null;
}

function extractGeometries(object: THREE.Object3D): THREE.BufferGeometry[] {
  const geos: THREE.BufferGeometry[] = [];
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geo = mesh.geometry.clone();
      mesh.updateMatrixWorld();
      geo.applyMatrix4(mesh.matrixWorld);
      geos.push(geo);
    }
  });
  return geos;
}

export async function loadModelFile(file: File): Promise<LoadedModel> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const name = file.name.replace(/\.[^.]+$/, '');
  const arrayBuffer = await file.arrayBuffer();
  const url = URL.createObjectURL(new Blob([arrayBuffer]));

  let root: THREE.Object3D;
  let animations: THREE.AnimationClip[] = [];

  try {
    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      root = gltf.scene;
      animations = gltf.animations ?? [];
    } else if (ext === 'fbx') {
      const loader = new FBXLoader();
      root = await loader.loadAsync(url);
      animations = (root as THREE.Group & { animations?: THREE.AnimationClip[] }).animations ?? [];
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      const text = new TextDecoder().decode(arrayBuffer);
      root = loader.parse(text);
    } else {
      throw new Error(`Unsupported format: .${ext}`);
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  const geos = extractGeometries(root);
  if (geos.length === 0) throw new Error('No meshes found in file');

  let merged: THREE.BufferGeometry;
  if (geos.length === 1) {
    merged = geos[0];
  } else {
    const normalized = geos.map((g) => {
      if (!g.index) return g;
      return g.toNonIndexed();
    });
    merged = mergeGeometries(normalized, false) ?? normalized[0];
  }

  merged.computeVertexNormals();
  merged.computeBoundingSphere();

  const bs = merged.boundingSphere;
  if (bs && bs.radius > 5) {
    const scale = 2 / bs.radius;
    merged.scale(scale, scale, scale);
    merged.computeBoundingSphere();
  }

  return {
    name,
    geometry: merged,
    animations,
    scene: animations.length > 0 ? root : null,
  };
}

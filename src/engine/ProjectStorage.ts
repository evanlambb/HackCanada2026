import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SceneObject } from '../store/types';
import type { Vec3 } from '../store/types';

const DB_NAME = 'editor-project-db';
const STORE_NAME = 'project';
const SCENE_STATE_KEY = 'sceneState';
const ASSET_KEY_PREFIX = 'asset:';

export interface SerializedSceneState {
  objects: Record<string, SceneObject>;
  imageLibrary: string[];
  enhanceScreenshot: string | null;
  enhanceResult: string | null;
  nextIdCounter: number;
  cameraPosition: Vec3;
  cameraTarget: Vec3;
}

export interface LoadedProject {
  state: SerializedSceneState;
  assets: Map<string, ArrayBuffer>;
}

export interface SceneManagerForStorage {
  getExportableObjects(): Map<string, THREE.Object3D>;
  preloadAsset(
    id: string,
    scene: THREE.Object3D | null,
    geometry: THREE.BufferGeometry,
    clips: THREE.AnimationClip[],
  ): void;
}

export interface ViewportForStorage {
  getCameraState(): { position: Vec3; target: Vec3 };
  setCameraState(position: Vec3, target: Vec3): void;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
  });
}

function exportObjectToGlb(object: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => resolve(result as ArrayBuffer),
      reject,
      { binary: true },
    );
  });
}

function extractGeometriesFromScene(object: THREE.Object3D): THREE.BufferGeometry[] {
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

/**
 * Parse a GLB ArrayBuffer into geometry, optional scene root, and animation clips.
 * Mirrors the structure expected by SceneManager.importModel / preloadAsset.
 */
export function parseGlbAsset(buffer: ArrayBuffer): Promise<{
  geometry: THREE.BufferGeometry;
  scene: THREE.Object3D | null;
  clips: THREE.AnimationClip[];
}> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        const root = gltf.scene;
        const clips = gltf.animations ?? [];
        const geos = extractGeometriesFromScene(root);
        if (geos.length === 0) {
          resolve({
            geometry: new THREE.BufferGeometry(),
            scene: null,
            clips: [],
          });
          return;
        }
        const merged =
          geos.length === 1
            ? geos[0]
            : mergeGeometries(
                geos.map((g) => (g.index ? g.toNonIndexed() : g)),
                false,
              ) ?? geos[0];
        merged.computeVertexNormals();
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        const scene = clips.length > 0 ? root : null;
        resolve({ geometry: merged, scene, clips });
      },
      undefined,
      reject,
    );
  });
}

/**
 * Save full project state and all 3D assets to IndexedDB.
 * Exports every scene object to GLB (covers primitives and imported meshes).
 */
export async function saveProject(
  getState: () => {
    objects: Record<string, SceneObject>;
    imageLibrary: string[];
    enhanceScreenshot: string | null;
    enhanceResult: string | null;
    getNextIdCounter?: () => number;
  },
  sceneManager: SceneManagerForStorage,
  viewport: ViewportForStorage,
): Promise<void> {
  const state = getState();
  const nextIdCounter =
    typeof state.getNextIdCounter === 'function'
      ? state.getNextIdCounter()
      : 1;

  const camera = viewport.getCameraState();
  const serialized: SerializedSceneState = {
    objects: state.objects,
    imageLibrary: state.imageLibrary,
    enhanceScreenshot: state.enhanceScreenshot,
    enhanceResult: state.enhanceResult,
    nextIdCounter,
    cameraPosition: camera.position,
    cameraTarget: camera.target,
  };

  const exportables = sceneManager.getExportableObjects();
  const assetBuffers = new Map<string, ArrayBuffer>();
  for (const id of Object.keys(state.objects)) {
    const object = exportables.get(id);
    if (!object) continue;
    try {
      const buffer = await exportObjectToGlb(object);
      assetBuffers.set(id, buffer);
    } catch (e) {
      console.warn(`ProjectStorage: failed to export object ${id}`, e);
    }
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    store.put(JSON.stringify(serialized), SCENE_STATE_KEY);
    for (const [id, buffer] of assetBuffers) {
      store.put(buffer, ASSET_KEY_PREFIX + id);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Load project from IndexedDB. Returns null if no project or corrupt.
 */
export async function loadProject(): Promise<LoadedProject | null> {
  try {
    const db = await openDb();
    const stateRaw = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(SCENE_STATE_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(tx.error);
    });
    db.close();

    if (stateRaw == null || typeof stateRaw !== 'string') return null;
    let state: SerializedSceneState;
    try {
      state = JSON.parse(stateRaw) as SerializedSceneState;
    } catch {
      return null;
    }
    if (
      !state ||
      typeof state.objects !== 'object' ||
      !Array.isArray(state.imageLibrary)
    ) {
      return null;
    }
    state.enhanceScreenshot = state.enhanceScreenshot ?? null;
    state.enhanceResult = state.enhanceResult ?? null;
    state.nextIdCounter =
      typeof state.nextIdCounter === 'number' && state.nextIdCounter >= 1
        ? state.nextIdCounter
        : 1;
    state.cameraPosition = Array.isArray(state.cameraPosition)
      ? state.cameraPosition
      : [5, 4, 5];
    state.cameraTarget = Array.isArray(state.cameraTarget)
      ? state.cameraTarget
      : [0, 0, 0];

    const db2 = await openDb();
    const allKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db2.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(tx.error);
    });

    const assetKeys = allKeys.filter(
      (k) => typeof k === 'string' && k.startsWith(ASSET_KEY_PREFIX),
    ) as string[];
    const assets = new Map<string, ArrayBuffer>();
    for (const key of assetKeys) {
      const buffer = await new Promise<ArrayBuffer | undefined>(
        (resolve, reject) => {
          const tx = db2.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(tx.error);
        },
      );
      if (buffer) {
        const id = key.slice(ASSET_KEY_PREFIX.length);
        assets.set(id, buffer);
      }
    }
    db2.close();

    return { state, assets };
  } catch {
    return null;
  }
}

/**
 * Clear all project data from IndexedDB.
 */
export async function clearProject(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

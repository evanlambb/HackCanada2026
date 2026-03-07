import { useState, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createImageTo3D, pollTask, type MeshyTask, type ModelType } from '../../engine/MeshyAPI';
import { engineRef } from '../../engine/engineRef';
import { useEditorStore } from '../../store/editorStore';

type ViewSlot = 'front' | 'back' | 'left' | 'right' | 'top';
const VIEW_LABELS: { key: ViewSlot; label: string }[] = [
  { key: 'front', label: 'Front' },
  { key: 'back', label: 'Back' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
  { key: 'top', label: 'Top' },
];

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AddOrReplaceButton({
  resultTask,
  onAction,
  onReset,
}: {
  resultTask: MeshyTask | null;
  onAction: () => void;
  onReset: () => void;
}) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const hasSelection = selectedIds.length > 0;

  return (
    <div className="meshgen-done">
      {resultTask?.thumbnail_url && (
        <img src={resultTask.thumbnail_url} alt="preview" className="meshgen-result-thumb" />
      )}
      <button className="meshgen-generate-btn" onClick={onAction}>
        {hasSelection ? 'Replace Selected' : 'Add to Scene'}
      </button>
      <button className="meshgen-reset-btn" onClick={onReset}>New</button>
    </div>
  );
}

export default function MeshGenPanel() {
  const [images, setImages] = useState<Record<ViewSlot, string | null>>({
    front: null, back: null, left: null, right: null, top: null,
  });
  const [activeSlot, setActiveSlot] = useState<ViewSlot>('front');
  const [modelType, setModelType] = useState<ModelType>('standard');
  const [withTexture, setWithTexture] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'generating' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultTask, setResultTask] = useState<MeshyTask | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<{ cancel: () => void } | null>(null);

  const hasAnyImage = Object.values(images).some(Boolean);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    const uri = await fileToDataUri(file);
    setImages((prev) => ({ ...prev, [activeSlot]: uri }));
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const textData = e.dataTransfer.getData('text/plain');
    if (textData && textData.startsWith('data:image')) {
      setImages((prev) => ({ ...prev, [activeSlot]: textData }));
      return;
    }
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [activeSlot]);

  function clearSlot(slot: ViewSlot) {
    setImages((prev) => ({ ...prev, [slot]: null }));
  }

  async function generate() {
    const primaryImage = images.front || Object.values(images).find(Boolean);
    if (!primaryImage) return;

    setStatus('uploading');
    setProgress(0);
    setErrorMsg('');
    setResultTask(null);

    try {
      const taskId = await createImageTo3D(primaryImage, {
        modelType,
        shouldTexture: withTexture,
      });

      setStatus('generating');

      const poller = pollTask(taskId, (task) => {
        setProgress(task.progress);
        if (task.status === 'SUCCEEDED') {
          setStatus('done');
          setResultTask(task);
        } else if (task.status === 'FAILED') {
          setStatus('error');
          setErrorMsg(task.task_error?.message || 'Generation failed');
        }
      });
      cancelRef.current = poller;
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function addOrReplaceInScene() {
    if (!resultTask?.model_urls?.glb) return;
    try {
      const store = useEditorStore.getState();
      const selectedId = store.selectedIds[0];
      const sm = engineRef.current?.sceneManager;

      // Capture the selected object's bounding box BEFORE downloading
      let targetBox: THREE.Box3 | null = null;
      let targetCenter = new THREE.Vector3();
      let targetSize = new THREE.Vector3();
      if (selectedId && sm) {
        const oldObj = sm.getMeshById(selectedId);
        if (oldObj) {
          targetBox = new THREE.Box3().setFromObject(oldObj);
          targetBox.getCenter(targetCenter);
          targetBox.getSize(targetSize);
        }
      }

      // Download and parse GLB
      const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(resultTask.model_urls.glb)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const buffer = await res.arrayBuffer();

      const loader = new GLTFLoader();
      const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>(
        (resolve, reject) => loader.parse(buffer, '', resolve, reject),
      );

      const scene = gltf.scene;
      const clips = gltf.animations ?? [];

      // Compute desired final scale and position BEFORE import
      // (importModel/addMesh will overwrite scene.position/scale with store defaults)
      let finalPos: [number, number, number] = [0, 0, 0];
      let finalScale: [number, number, number] = [1, 1, 1];

      if (targetBox && targetSize.length() > 0) {
        // Replace mode: match the height (Y) of the old object
        const newBox = new THREE.Box3().setFromObject(scene);
        const newSize = newBox.getSize(new THREE.Vector3());

        // Use height (Y) as primary reference since these are typically upright models.
        // Fall back to largest dimension if Y is degenerate.
        const oldRef = targetSize.y > 0.01 ? targetSize.y : Math.max(targetSize.x, targetSize.y, targetSize.z);
        const newRef = newSize.y > 0.01 ? newSize.y : Math.max(newSize.x, newSize.y, newSize.z);
        const uniformScale = oldRef / Math.max(newRef, 0.001);

        // Apply scale temporarily to compute final center position
        scene.scale.set(uniformScale, uniformScale, uniformScale);
        scene.updateMatrixWorld(true);
        const scaledBox = new THREE.Box3().setFromObject(scene);
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
        const offset = targetCenter.clone().sub(scaledCenter);

        finalScale = [uniformScale, uniformScale, uniformScale];
        finalPos = [offset.x, offset.y, offset.z];

        // Reset scene transforms (addMesh will set them from the store)
        scene.scale.set(1, 1, 1);
        scene.position.set(0, 0, 0);
      } else {
        // Add mode: auto-scale if too large
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 5) {
          const s = 2 / maxDim;
          finalScale = [s, s, s];
        }
      }

      // Gather merged geometry for fallback/edit mode
      const geos: THREE.BufferGeometry[] = [];
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const geo = mesh.geometry.clone();
          mesh.updateMatrixWorld();
          geo.applyMatrix4(mesh.matrixWorld);
          geos.push(geo);
        }
      });
      let mergedGeo: THREE.BufferGeometry;
      if (geos.length <= 1) {
        mergedGeo = geos[0] ?? new THREE.BufferGeometry();
      } else {
        const normalized = geos.map((g) => (g.index ? g.toNonIndexed() : g));
        mergedGeo = mergeGeometries(normalized, false) ?? normalized[0];
      }

      // Delete old object right before adding the new one (atomic swap)
      if (targetBox && selectedId) {
        useEditorStore.getState().removeObject(selectedId);
      }

      const importedId = engineRef.current?.sceneManager.importModel(
        'MeshyGen',
        mergedGeo,
        scene,
        clips,
      );
      if (importedId) {
        const s = useEditorStore.getState();
        if (resultTask.id) s.setMeshyTaskId(importedId, resultTask.id);
        // Apply the computed position and scale via the store
        // This triggers syncObjects → updateMesh which applies them to the Three.js object
        s.updateObject(importedId, {
          position: finalPos,
          scale: finalScale,
        });
      }
    } catch (err) {
      console.error('Failed to add to scene:', err);
    }
  }

  function reset() {
    cancelRef.current?.cancel();
    setStatus('idle');
    setProgress(0);
    setResultTask(null);
    setErrorMsg('');
  }

  return (
    <div className="meshgen-panel">
      {/* View slot tabs */}
      <div className="meshgen-tabs">
        {VIEW_LABELS.map(({ key, label }) => (
          <button
            key={key}
            className={`meshgen-tab ${activeSlot === key ? 'active' : ''} ${images[key] ? 'has-image' : ''}`}
            onClick={() => setActiveSlot(key)}
          >
            {label}
            {images[key] && <span className="meshgen-tab-dot" />}
          </button>
        ))}
      </div>

      {/* Drop zone / preview */}
      <div
        className={`meshgen-dropzone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg"
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
        {images[activeSlot] ? (
          <div className="meshgen-preview">
            <img src={images[activeSlot]!} alt={activeSlot} />
            <button
              className="meshgen-clear"
              onClick={(e) => { e.stopPropagation(); clearSlot(activeSlot); }}
            >
              &times;
            </button>
          </div>
        ) : (
          <div className="meshgen-placeholder">
            <div className="meshgen-placeholder-icon">+</div>
            <div>Drop {activeSlot} view image here</div>
            <div style={{ fontSize: 10, opacity: 0.4, marginTop: 4 }}>or click to browse</div>
          </div>
        )}
      </div>

      {/* Options */}
      <div className="meshgen-options">
        <div className="meshgen-option-row">
          <span className="meshgen-option-label">Type</span>
          <div className="meshgen-toggle">
            <button
              className={modelType === 'standard' ? 'active' : ''}
              onClick={() => setModelType('standard')}
            >
              Standard
            </button>
            <button
              className={modelType === 'lowpoly' ? 'active' : ''}
              onClick={() => setModelType('lowpoly')}
            >
              Low Poly
            </button>
          </div>
        </div>
        <div className="meshgen-option-row">
          <span className="meshgen-option-label">Texture</span>
          <div className="meshgen-toggle">
            <button
              className={!withTexture ? 'active' : ''}
              onClick={() => setWithTexture(false)}
            >
              Off
            </button>
            <button
              className={withTexture ? 'active' : ''}
              onClick={() => setWithTexture(true)}
            >
              On
            </button>
          </div>
        </div>
      </div>

      {/* Action area */}
      <div className="meshgen-actions">
        {status === 'idle' && (
          <button
            className="meshgen-generate-btn"
            disabled={!hasAnyImage}
            onClick={generate}
          >
            Generate 3D Mesh
          </button>
        )}

        {(status === 'uploading' || status === 'generating') && (
          <div className="meshgen-progress">
            <div className="meshgen-progress-bar">
              <div className="meshgen-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="meshgen-progress-text">
              {status === 'uploading' ? 'Sending...' : `Generating: ${progress}%`}
            </div>
          </div>
        )}

        {status === 'done' && (
          <AddOrReplaceButton resultTask={resultTask} onAction={addOrReplaceInScene} onReset={reset} />
        )}

        {status === 'error' && (
          <div className="meshgen-error">
            <div className="meshgen-error-msg">{errorMsg}</div>
            <button className="meshgen-reset-btn" onClick={reset}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}

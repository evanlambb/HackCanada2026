import { useState, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { useEditorStore } from '../../store/editorStore';
import { engineRef } from '../../engine/engineRef';
import { pickAnimation } from '../../engine/GeminiAPI';
import { exportToGlbDataUri } from '../../engine/GLBExporter';
import {
  createRiggingTask,
  getRiggingTask,
  createAnimationTask,
  getAnimationTask,
  pollAnyTask,
} from '../../engine/MeshyAPI';
import type { AnimationData } from '../../store/types';

type PipelineStage =
  | 'idle'
  | 'picking'
  | 'rigging'
  | 'animating'
  | 'importing'
  | 'done'
  | 'error';

interface PipelineState {
  stage: PipelineStage;
  pickedName: string;
  progress: number;
  error: string;
}

const INITIAL_STATE: PipelineState = {
  stage: 'idle',
  pickedName: '',
  progress: 0,
  error: '',
};

export default function AnimationsPanel() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const objects = useEditorStore((s) => s.objects);
  const selectedObj = selectedIds.length > 0 ? objects[selectedIds[0]] : null;
  const animations = selectedObj?.animations ?? [];
  const activeAnimation = selectedObj?.activeAnimation ?? null;

  const [prompt, setPrompt] = useState('');
  const [pipe, setPipe] = useState<PipelineState>(INITIAL_STATE);
  const cancelRef = useRef<{ cancel: () => void } | null>(null);

  function handlePlayStop(name: string) {
    if (!selectedObj) return;
    const sm = engineRef.current?.sceneManager;
    if (!sm) return;
    if (activeAnimation === name) {
      sm.stopAnimation(selectedObj.id);
    } else {
      sm.playAnimation(selectedObj.id, name);
    }
  }

  async function runPipeline() {
    if (!selectedObj || !prompt.trim()) return;
    const objectId = selectedObj.id;
    const store = useEditorStore.getState;

    setPipe({ stage: 'picking', pickedName: '', progress: 0, error: '' });

    try {
      // Step 1: Gemini picks the animation
      const { actionId, name: pickedName } = await pickAnimation(prompt.trim());
      setPipe((p) => ({ ...p, pickedName, stage: 'rigging' }));

      // Step 2: Rig if needed
      let rigTaskId = store().objects[objectId]?.rigTaskId;

      if (!rigTaskId) {
        const meshyTaskId = store().objects[objectId]?.meshyTaskId;
        let rigInput: { inputTaskId: string } | { modelDataUri: string };

        if (meshyTaskId) {
          rigInput = { inputTaskId: meshyTaskId };
        } else {
          const obj3d = engineRef.current?.sceneManager.getMeshById(objectId);
          if (!obj3d) throw new Error('Object not found in scene');
          const dataUri = await exportToGlbDataUri(obj3d);
          rigInput = { modelDataUri: dataUri };
        }

        const taskId = await createRiggingTask(rigInput).catch((err) => {
          if (String(err).includes('422') || String(err).includes('Pose estimation')) {
            throw new Error('Rigging failed: model must be a textured humanoid character (not a primitive). Import a character model first.');
          }
          throw err;
        });

        const { promise } = pollAnyTask(
          () => getRiggingTask(taskId),
          (t) => setPipe((p) => ({ ...p, progress: t.progress })),
        );
        const rigResult = await promise;
        rigTaskId = taskId;

        useEditorStore.getState().setRigTaskId(objectId, taskId);

        // Import the rigged character back into the scene
        if (rigResult.result?.rigged_character_glb_url) {
          const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(rigResult.result.rigged_character_glb_url)}`;
          const res = await fetch(proxyUrl);
          const buffer = await res.arrayBuffer();
          const loader = new GLTFLoader();
          const gltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>(
            (resolve, reject) => loader.parse(buffer, '', resolve, reject),
          );

          // Collect basic animation clips from the rigged model
          const basicClips = gltf.animations ?? [];
          if (basicClips.length > 0 || gltf.scene.children.length > 0) {
            const sm = engineRef.current?.sceneManager;
            if (sm) {
              // Remove old object, import the rigged version
              const existingObj = sm.getMeshById(objectId);
              if (existingObj) {
                sm.viewport.scene.remove(existingObj);
              }

              gltf.scene.traverse((child) => { child.userData.id = objectId; });
              gltf.scene.userData.id = objectId;
              const objData = store().objects[objectId];
              if (objData) {
                gltf.scene.position.set(...objData.position);
                gltf.scene.rotation.set(...objData.rotation);
                gltf.scene.scale.set(...objData.scale);
              }
              sm.viewport.scene.add(gltf.scene);
              sm.meshMap.set(objectId, gltf.scene);

              if (basicClips.length > 0) {
                sm.animationManager.register(objectId, gltf.scene, basicClips);
                const animData: AnimationData[] = basicClips.map((c) => ({
                  name: c.name,
                  duration: parseFloat(c.duration.toFixed(2)),
                }));
                useEditorStore.getState().addAnimationsToObject(objectId, animData);
              }
            }
          }
        }
      }

      // Step 3: Generate the chosen animation
      setPipe((p) => ({ ...p, stage: 'animating', progress: 0 }));

      const animTaskId = await createAnimationTask(rigTaskId!, actionId);
      const { promise: animPromise } = pollAnyTask(
        () => getAnimationTask(animTaskId),
        (t) => setPipe((p) => ({ ...p, progress: t.progress })),
      );
      const animResult = await animPromise;

      // Step 4: Import the animation
      setPipe((p) => ({ ...p, stage: 'importing', progress: 100 }));

      const animGlbUrl = animResult.result?.animation_glb_url;
      if (!animGlbUrl) throw new Error('No animation GLB returned');

      const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(animGlbUrl)}`;
      const animRes = await fetch(proxyUrl);
      const animBuffer = await animRes.arrayBuffer();
      const animLoader = new GLTFLoader();
      const animGltf = await new Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>(
        (resolve, reject) => animLoader.parse(animBuffer, '', resolve, reject),
      );

      const newClips = animGltf.animations ?? [];
      if (newClips.length > 0) {
        const sm = engineRef.current?.sceneManager;
        const sceneObj = sm?.getMeshById(objectId);
        if (sm && sceneObj) {
          // Name the clip after the picked animation
          newClips[0].name = pickedName;

          // Register with the animation manager (merges with existing clips)
          const mixer = (sm.animationManager as any).mixers?.get(objectId) as THREE.AnimationMixer | undefined;
          if (mixer) {
            const existingClips = (sm.animationManager as any).clips?.get(objectId) as THREE.AnimationClip[] | undefined;
            if (existingClips) {
              existingClips.push(...newClips);
            }
          } else {
            sm.animationManager.register(objectId, sceneObj, newClips);
          }

          const animData: AnimationData[] = newClips.map((c) => ({
            name: c.name,
            duration: parseFloat(c.duration.toFixed(2)),
          }));
          useEditorStore.getState().addAnimationsToObject(objectId, animData);

          // Auto-play the new animation
          sm.playAnimation(objectId, pickedName);
        }
      }

      setPipe((p) => ({ ...p, stage: 'done' }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setPipe((p) => ({ ...p, stage: 'error', error: msg }));
    }
  }

  function reset() {
    cancelRef.current?.cancel();
    setPipe(INITIAL_STATE);
  }

  const isRunning = pipe.stage !== 'idle' && pipe.stage !== 'done' && pipe.stage !== 'error';

  return (
    <div className="anim-panel">
      {/* Prompt input */}
      <div className="anim-prompt-section">
        <div className="anim-section-title">Generate Animation</div>
        <textarea
          className="anim-prompt-input"
          placeholder={selectedObj ? 'Describe the animation... e.g. "walk confidently"' : 'Select an object first'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!selectedObj || isRunning}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!isRunning && selectedObj && prompt.trim()) runPipeline();
            }
          }}
        />
        <button
          className="anim-generate-btn"
          disabled={!selectedObj || !prompt.trim() || isRunning}
          onClick={runPipeline}
        >
          {isRunning ? 'Working...' : 'Generate'}
        </button>
      </div>

      {/* Pipeline status */}
      {pipe.stage !== 'idle' && (
        <div className="anim-pipeline">
          <PipelineStep label="Picking animation" stage="picking" current={pipe.stage} />
          {pipe.pickedName && (
            <div className="anim-picked">
              Matched: <strong>{pipe.pickedName}</strong>
            </div>
          )}
          <PipelineStep label="Rigging model" stage="rigging" current={pipe.stage} progress={pipe.stage === 'rigging' ? pipe.progress : undefined} />
          <PipelineStep label="Generating animation" stage="animating" current={pipe.stage} progress={pipe.stage === 'animating' ? pipe.progress : undefined} />
          <PipelineStep label="Importing" stage="importing" current={pipe.stage} />

          {pipe.stage === 'done' && (
            <div className="anim-done-msg">Animation added and playing.</div>
          )}
          {pipe.stage === 'error' && (
            <div className="anim-error-msg">{pipe.error}</div>
          )}
          {(pipe.stage === 'done' || pipe.stage === 'error') && (
            <button className="anim-reset-btn" onClick={reset}>New</button>
          )}
        </div>
      )}

      {/* Existing animations */}
      {selectedObj && animations.length > 0 && (
        <div className="anim-existing">
          <div className="anim-section-title">Animations</div>
          <div className="anim-btn-list">
            {animations.map((anim) => (
              <button
                key={anim.name}
                className={`anim-play-btn${activeAnimation === anim.name ? ' active' : ''}`}
                onClick={() => handlePlayStop(anim.name)}
              >
                <span className="anim-play-name">{anim.name}</span>
                <span className="anim-play-dur">{anim.duration.toFixed(1)}s</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!selectedObj && (
        <div className="anim-empty">Select an object to animate</div>
      )}
    </div>
  );
}

function PipelineStep({
  label,
  stage,
  current,
  progress,
}: {
  label: string;
  stage: PipelineStage;
  current: PipelineStage;
  progress?: number;
}) {
  const stages: PipelineStage[] = ['picking', 'rigging', 'animating', 'importing', 'done'];
  const ci = stages.indexOf(current);
  const si = stages.indexOf(stage);
  const isDone = ci > si || current === 'done';
  const isActive = current === stage;

  return (
    <div className={`anim-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>
      <span className="anim-step-indicator">
        {isDone ? '\u2713' : isActive ? '\u25CF' : '\u25CB'}
      </span>
      <span className="anim-step-label">{label}</span>
      {isActive && progress !== undefined && (
        <span className="anim-step-pct">{progress}%</span>
      )}
    </div>
  );
}

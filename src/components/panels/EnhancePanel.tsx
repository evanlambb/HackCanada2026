import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { engineRef } from '../../engine/engineRef';

const API_BASE = import.meta.env.VITE_ENHANCE_API ?? 'http://localhost:3001';

function buildPrompt(fields: {
  persona: string;
  clothing: string;
  accessories: string;
  facialFeatures: string;
}): string {
  return `This is an image-to-image prompt. Precisely adhere to the geometric volume, proportions, and pose of the provided blocked-out character input. Do not warp the underlying silhouette.
Subject Detail: An ultra-detailed digital concept art full-body render of a ${fields.persona || '[Character Class, e.g., Sci-fi Mercenary / Female Paladin]'}.
Costume & Texture: The character is wearing ${fields.clothing || '[Describe Clothing/Armor here in detail]'}. Add high-fidelity micro-textures to all surfaces.
Facial Features/Accessory: Detail the face as ${fields.facialFeatures || '[e.g., aged, stern, wearing a mechanical mask]'}. Add accessories like ${fields.accessories || '[e.g., pouches, holstered weapon]'}.
LIGHTING CRUCIAL: The lighting must be perfect, flat, neutral, studio-diffuse lighting. There must be NO heavy shadows, NO harsh directional light, NO dramatic rim lighting, and NO baked ambient occlusion. The light should be bright, even, and reveal all textures clearly from every angle.
Background: The character is isolated on a perfectly flat, uniform, neutral light gray color background (no floor texture, no environment) to ensure easy isolation for 3D conversion.`;
}

export default function EnhancePanel() {
  const screenshot = useEditorStore((s) => s.enhanceScreenshot);
  const result = useEditorStore((s) => s.enhanceResult);
  const loading = useEditorStore((s) => s.enhanceLoading);
  const setEnhanceScreenshot = useEditorStore((s) => s.setEnhanceScreenshot);
  const setEnhanceResult = useEditorStore((s) => s.setEnhanceResult);
  const setEnhanceLoading = useEditorStore((s) => s.setEnhanceLoading);
  const objectCount = useEditorStore((s) => Object.keys(s.objects).length);

  const [persona, setPersona] = useState('');
  const [clothing, setClothing] = useState('');
  const [accessories, setAccessories] = useState('');
  const [facialFeatures, setFacialFeatures] = useState('');

  function handleCapture() {
    const eng = engineRef.current;
    if (!eng) return;
    const onBefore = () => {
      eng.transformEngine.controls.getHelper().visible = false;
      eng.editModeEngine.setOverlaysVisible(false);
    };
    const onAfter = () => {
      eng.transformEngine.controls.getHelper().visible = true;
      eng.editModeEngine.setOverlaysVisible(true);
    };
    const dataUrl = eng.viewport.captureScreenshot(onBefore, onAfter);
    setEnhanceScreenshot(dataUrl);
  }

  async function handleGenerate() {
    if (!screenshot) return;
    setEnhanceLoading(true);
    setEnhanceResult(null);
    try {
      const prompt = buildPrompt({
        persona,
        clothing,
        accessories,
        facialFeatures,
      });
      const res = await fetch(`${API_BASE}/api/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: screenshot, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Enhance failed');
      if (data.image) {
        setEnhanceResult(data.image);
      } else if (data.error) {
        setEnhanceResult(data.error);
      }
    } catch (err) {
      console.error(err);
      setEnhanceResult(
        err instanceof Error ? err.message : 'Enhance failed',
      );
    } finally {
      setEnhanceLoading(false);
    }
  }

  const isError = result && typeof result === 'string' && !result.startsWith('data:');
  const isImageResult = result && typeof result === 'string' && result.startsWith('data:');

  return (
    <div className="enhance-panel">
      <div className="enhance-panel-section">
        <div className="enhance-panel-title">Blockout</div>
        <button
          type="button"
          className="enhance-btn"
          disabled={objectCount === 0}
          title="Capture current view from Scene View"
          onClick={handleCapture}
        >
          Capture Blockout
        </button>
        <div className="enhance-preview-wrap">
          {screenshot ? (
            <img src={screenshot} alt="Blockout" />
          ) : (
            <div className="enhance-preview-placeholder">No capture</div>
          )}
        </div>
      </div>

      <div className="enhance-panel-section">
        <div className="enhance-panel-title">Prompt</div>
        <div className="enhance-form">
          <label>
            Character description / persona
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="e.g. Sci-fi Mercenary, Female Paladin"
              rows={2}
            />
          </label>
          <label>
            Clothing / armour
            <textarea
              value={clothing}
              onChange={(e) => setClothing(e.target.value)}
              placeholder="e.g. segmented plating, weathered leather straps"
              rows={2}
            />
          </label>
          <label>
            Accessories
            <textarea
              value={accessories}
              onChange={(e) => setAccessories(e.target.value)}
              placeholder="e.g. pouches, holstered weapon"
              rows={2}
            />
          </label>
          <label>
            Facial features
            <textarea
              value={facialFeatures}
              onChange={(e) => setFacialFeatures(e.target.value)}
              placeholder="e.g. aged, stern, mechanical mask"
              rows={2}
            />
          </label>
        </div>
      </div>

      <div className="enhance-panel-section">
        <button
          type="button"
          className="enhance-btn enhance-btn-primary"
          disabled={loading || !screenshot}
          onClick={handleGenerate}
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>
        {isError && <p className="enhance-error">{result}</p>}
        {isImageResult && (
          <>
            <div className="enhance-panel-title">Generated</div>
            <div className="enhance-preview-wrap">
              <img src={result as string} alt="Generated character" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

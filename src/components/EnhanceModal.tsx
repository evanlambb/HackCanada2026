import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';

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

export default function EnhanceModal() {
  const open = useEditorStore((s) => s.enhanceModalOpen);
  const screenshot = useEditorStore((s) => s.enhanceScreenshot);
  const result = useEditorStore((s) => s.enhanceResult);
  const loading = useEditorStore((s) => s.enhanceLoading);
  const closeEnhanceModal = useEditorStore((s) => s.closeEnhanceModal);
  const setEnhanceResult = useEditorStore((s) => s.setEnhanceResult);
  const setEnhanceLoading = useEditorStore((s) => s.setEnhanceLoading);

  const [persona, setPersona] = useState('');
  const [clothing, setClothing] = useState('');
  const [accessories, setAccessories] = useState('');
  const [facialFeatures, setFacialFeatures] = useState('');

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

  function handleClose() {
    setPersona('');
    setClothing('');
    setAccessories('');
    setFacialFeatures('');
    closeEnhanceModal();
  }

  if (!open) return null;

  return (
    <div className="enhance-modal-overlay" onClick={handleClose}>
      <div
        className="enhance-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="enhance-modal-header">
          <h2>Enhance Character</h2>
          <button type="button" className="enhance-modal-close" onClick={handleClose}>
            ×
          </button>
        </div>
        <div className="enhance-modal-body">
          <div className="enhance-preview">
            <p>Blockout preview</p>
            {screenshot ? (
              <img src={screenshot} alt="Blockout" />
            ) : (
              <div className="enhance-preview-placeholder">No capture</div>
            )}
            {result && typeof result === 'string' && result.startsWith('data:') && (
              <>
                <p>Generated</p>
                <img src={result} alt="Generated character" />
              </>
            )}
            {result && typeof result === 'string' && !result.startsWith('data:') && (
              <p className="enhance-error">{result}</p>
            )}
          </div>
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
        <div className="enhance-modal-footer">
          <button
            type="button"
            className="enhance-btn enhance-btn-primary"
            disabled={loading || !screenshot}
            onClick={handleGenerate}
          >
            {loading ? 'Generating…' : 'Generate'}
          </button>
          <button
            type="button"
            className="enhance-btn"
            onClick={handleClose}
          >
            {result ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

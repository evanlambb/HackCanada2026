import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { engineRef } from '../../engine/engineRef';

const GEMINI_BASE = '/api/gemini';
const MODEL = 'gemini-3.1-flash-image-preview';

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

async function callGeminiImageGen(imageDataUri: string, prompt: string): Promise<string> {
  let base64Data = imageDataUri;
  if (base64Data.includes(',')) {
    base64Data = base64Data.split(',')[1] ?? base64Data;
  }

  const res = await fetch(`${GEMINI_BASE}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64Data } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        maxOutputTokens: 8192,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType ?? 'image/png';
      return `data:${mime};base64,${part.inlineData.data}`;
    }
  }

  throw new Error('No image returned from Gemini');
}

export default function EnhancePanel() {
  const screenshot = useEditorStore((s) => s.enhanceScreenshot);
  const result = useEditorStore((s) => s.enhanceResult);
  const loading = useEditorStore((s) => s.enhanceLoading);
  const setEnhanceScreenshot = useEditorStore((s) => s.setEnhanceScreenshot);
  const setEnhanceResult = useEditorStore((s) => s.setEnhanceResult);
  const setEnhanceLoading = useEditorStore((s) => s.setEnhanceLoading);
  const selectedIds = useEditorStore((s) => s.selectedIds);

  const imageLibrary = useEditorStore((s) => s.imageLibrary);
  const addToImageLibrary = useEditorStore((s) => s.addToImageLibrary);

  const [persona, setPersona] = useState('');
  const [clothing, setClothing] = useState('');
  const [accessories, setAccessories] = useState('');
  const [facialFeatures, setFacialFeatures] = useState('');

  // Refine state: which library image is selected for refinement
  const [refineIndex, setRefineIndex] = useState<number | null>(null);
  const [refinePrompt, setRefinePrompt] = useState('');
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineError, setRefineError] = useState('');

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
    const dataUrl = eng.viewport.captureScreenshot(onBefore, onAfter, selectedIds);
    setEnhanceScreenshot(dataUrl);
  }

  async function handleGenerate() {
    if (!screenshot) return;
    setEnhanceLoading(true);
    setEnhanceResult(null);
    try {
      const prompt = buildPrompt({ persona, clothing, accessories, facialFeatures });
      const imageDataUri = await callGeminiImageGen(screenshot, prompt);
      setEnhanceResult(imageDataUri);
      addToImageLibrary(imageDataUri);
    } catch (err) {
      console.error(err);
      setEnhanceResult(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setEnhanceLoading(false);
    }
  }

  async function handleRefine() {
    if (refineIndex === null || !refinePrompt.trim()) return;
    const sourceImage = imageLibrary[refineIndex];
    if (!sourceImage) return;

    setRefineLoading(true);
    setRefineError('');
    try {
      const prompt = `Edit this image according to the following instruction. Keep everything else the same, only change what is described:\n\n${refinePrompt.trim()}`;
      const refined = await callGeminiImageGen(sourceImage, prompt);
      addToImageLibrary(refined);
      setRefineIndex(null);
      setRefinePrompt('');
    } catch (err) {
      console.error(err);
      setRefineError(err instanceof Error ? err.message : 'Refinement failed');
    } finally {
      setRefineLoading(false);
    }
  }

  function handleLibraryClick(index: number) {
    if (refineIndex === index) {
      setRefineIndex(null);
    } else {
      setRefineIndex(index);
      setRefinePrompt('');
      setRefineError('');
    }
  }

  const isError = result && typeof result === 'string' && !result.startsWith('data:');
  const isImageResult = result && typeof result === 'string' && result.startsWith('data:');

  return (
    <div className="enhance-panel">
      {/* Blockout capture */}
      <div className="enhance-panel-section">
        <div className="enhance-panel-title">Blockout</div>
        <button
          type="button"
          className="enhance-btn"
          disabled={selectedIds.length === 0}
          title="Capture selected object(s) at 3/4 view from Scene View"
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

      {/* Prompt fields */}
      <div className="enhance-panel-section">
        <div className="enhance-panel-title">Prompt</div>
        <div className="enhance-form">
          <label>
            Character description / persona
            <textarea value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="e.g. Sci-fi Mercenary, Female Paladin" rows={2} />
          </label>
          <label>
            Clothing / armour
            <textarea value={clothing} onChange={(e) => setClothing(e.target.value)} placeholder="e.g. segmented plating, weathered leather straps" rows={2} />
          </label>
          <label>
            Accessories
            <textarea value={accessories} onChange={(e) => setAccessories(e.target.value)} placeholder="e.g. pouches, holstered weapon" rows={2} />
          </label>
          <label>
            Facial features
            <textarea value={facialFeatures} onChange={(e) => setFacialFeatures(e.target.value)} placeholder="e.g. aged, stern, mechanical mask" rows={2} />
          </label>
        </div>
      </div>

      {/* Generate button + progress */}
      <div className="enhance-panel-section">
        {!loading ? (
          <button
            type="button"
            className="enhance-btn enhance-btn-primary"
            disabled={loading || !screenshot}
            onClick={handleGenerate}
          >
            Generate
          </button>
        ) : (
          <div className="meshgen-progress">
            <div className="meshgen-progress-bar">
              <div className="meshgen-progress-fill" style={{ width: '100%' }} />
            </div>
            <div className="meshgen-progress-text">Generating image...</div>
          </div>
        )}
        {isError && <p className="enhance-error">{result}</p>}
        {isImageResult && (
          <>
            <div className="enhance-panel-title" style={{ marginTop: 8 }}>Generated</div>
            <div className="enhance-preview-wrap">
              <img src={result as string} alt="Generated character" />
            </div>
          </>
        )}
      </div>

      {/* Library + Refine */}
      <div className="enhance-panel-section">
        <div className="enhance-panel-title">Library</div>
        {imageLibrary.length === 0 ? (
          <div className="enhance-library-empty">No images generated yet</div>
        ) : (
          <>
            <div className="enhance-library-grid">
              {imageLibrary.map((uri, i) => (
                <img
                  key={i}
                  src={uri}
                  alt={`Generated ${i + 1}`}
                  className={`enhance-library-thumb ${refineIndex === i ? 'selected' : ''}`}
                  draggable
                  onClick={() => handleLibraryClick(i)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', uri);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                />
              ))}
            </div>

            {/* Refine section -- shown when a library image is selected */}
            {refineIndex !== null && (
              <div className="enhance-refine">
                <div className="enhance-refine-header">
                  <div className="enhance-panel-title" style={{ margin: 0 }}>Refine</div>
                  <button
                    className="enhance-refine-close"
                    onClick={() => setRefineIndex(null)}
                  >
                    &times;
                  </button>
                </div>
                <div className="enhance-refine-preview">
                  <img src={imageLibrary[refineIndex]} alt="Selected for refinement" />
                </div>
                <textarea
                  className="enhance-refine-input"
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  placeholder="Describe what to change... e.g. 'make the armor gold instead of silver'"
                  rows={2}
                  disabled={refineLoading}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!refineLoading && refinePrompt.trim()) handleRefine();
                    }
                  }}
                />
                {!refineLoading ? (
                  <button
                    className="enhance-btn enhance-btn-primary"
                    disabled={!refinePrompt.trim()}
                    onClick={handleRefine}
                    style={{ width: '100%' }}
                  >
                    Refine
                  </button>
                ) : (
                  <div className="meshgen-progress">
                    <div className="meshgen-progress-bar">
                      <div className="meshgen-progress-fill" style={{ width: '100%' }} />
                    </div>
                    <div className="meshgen-progress-text">Refining...</div>
                  </div>
                )}
                {refineError && <p className="enhance-error">{refineError}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

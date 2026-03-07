import { useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { useEditorStore } from '../../store/editorStore';
import { sceneComposer, type ComposerData, type ComposerObject } from '../../engine/SceneComposer';

const COMPOSE_SYSTEM_PROMPT = `You are a 3D scene composition assistant. Generate a JSON structure for character blocking using primitive shapes. You can generate ANY character type: humanoids, quadrupeds, creatures, robots, animals, fantasy beings, etc.

STEP 1 — CLASSIFY THE CHARACTER TYPE:
Determine the character type from the description and choose the appropriate bind pose:
- Biped/humanoid → T-POSE: body vertical (Y axis), legs down, arms extended horizontally along X axis
- Quadruped (dog, horse, cat, etc.) → STANDING POSE: torso horizontal along Z axis, 4 legs extending down (Y axis), head forward (-Z), tail back (+Z)
- Winged creature (bird, dragon) → SPREAD POSE: body along Z axis, wings extended along X axis, legs down
- Serpentine (snake, worm) → body coiled or straight along Z axis, head at one end
- Other → choose the neutral bind pose that best exposes all limbs for future rigging

STEP 2 — GEOMETRY RULES (apply to ALL character types):
1. All connected parts MUST touch with NO GAPS — calculate positions precisely
2. For any two connected parts: position2 = position1 ± (scale1/2 + scale2/2) along the connection axis
3. Bilateral symmetry: mirrored parts (left/right limbs, wings) must be placed at equal and opposite offsets (±X or ±Z)
4. All limbs in the bind pose must be straight and extended — no bent joints
5. Character should stand on or above Y=0 (floor level)
6. Use realistic proportions relative to the overall character size
7. Choose anatomically appropriate colors for each body part
8. Output valid JSON only — no markdown fences, no explanation

BIND POSE EXAMPLES:

Biped (humanoid) — T-pose:
- Torso: position [0, 1.0, 0], scale [0.4, 0.6, 0.3] → top at Y=1.3, side edges at X=±0.2
- Head: scale [0.3, 0.3, 0.3] → position [0, 1.3+0.15, 0] = [0, 1.45, 0]
- Right upper arm: scale [0.3, 0.12, 0.12] → position [0.2+0.15, 1.1, 0] = [0.35, 1.1, 0]
- Right forearm: scale [0.25, 0.1, 0.1] → position [0.35+0.15+0.125, 1.1, 0] = [0.625, 1.1, 0]
- Right leg: scale [0.15, 0.5, 0.15] → position [0.1, 1.0-0.3-0.25, 0] = [0.1, 0.45, 0]

Quadruped (dog) — standing pose:
- Torso: position [0, 0.6, 0], scale [0.35, 0.3, 0.7] → bottom at Y=0.45, front at Z=-0.35, back at Z=+0.35
- Head: scale [0.25, 0.22, 0.3] → position [0, 0.75, -0.35-0.15] = [0, 0.75, -0.5]
- Front-right leg: scale [0.1, 0.4, 0.1] → position [0.15, 0.45-0.2, -0.25] = [0.15, 0.25, -0.25]
- Tail: scale [0.08, 0.08, 0.25] → position [0, 0.65, 0.35+0.125] = [0, 0.65, 0.475]

Schema:
{
  "objects": [
    {
      "name": "descriptive_name",
      "type": "box" | "cylinder" | "sphere",
      "position": [x, y, z],
      "rotation": [x, y, z],
      "scale": [x, y, z],
      "color": "#hexcode"
    }
  ]
}`;

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return text.trim();
}

async function callCompose(
  prompt: string,
  image?: string,
  existingScene?: ComposerObject[],
  selectedObject?: string,
): Promise<ComposerObject[]> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string;
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY not set in .env');

  let userContent = '';
  if (existingScene && existingScene.length > 0) {
    userContent += `Current scene:\n${JSON.stringify(existingScene, null, 2)}\n\n`;
    if (selectedObject) {
      userContent += `Apply this modification to "${selectedObject}" (and adjust connected objects to maintain contact): ${prompt}`;
    } else {
      userContent += `Apply this modification to the entire scene: ${prompt}`;
    }
  } else {
    userContent += `Generate character blocking for: ${prompt}`;
  }

  const ai = new GoogleGenAI({ apiKey });
  const parts: import('@google/genai').Part[] = [];

  if (image) {
    let base64 = image;
    if (base64.includes(',')) base64 = base64.split(',')[1] ?? base64;
    parts.push({ inlineData: { mimeType: 'image/png', data: base64 } });
  }
  parts.push({ text: `${COMPOSE_SYSTEM_PROMPT}\n\nUser request: ${userContent}` });

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { role: 'user', parts },
  });

  const text = response.text ?? '';
  const parsed = JSON.parse(extractJSON(text)) as { objects: ComposerObject[] };
  if (!parsed.objects || !Array.isArray(parsed.objects)) throw new Error('Invalid response format');
  return parsed.objects;
}

const EXAMPLES = [
  'Humanoid robot',
  'Fantasy elf archer',
  'Cartoon hero',
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function SceneComposerPanel() {
  const prompt = useEditorStore((s) => s.composerPrompt);
  const loading = useEditorStore((s) => s.composerLoading);
  const error = useEditorStore((s) => s.composerError);
  const refImage = useEditorStore((s) => s.composerRefImage);
  const setPrompt = useEditorStore((s) => s.setComposerPrompt);
  const setLoading = useEditorStore((s) => s.setComposerLoading);
  const setError = useEditorStore((s) => s.setComposerError);
  const setRefImage = useEditorStore((s) => s.setComposerRefImage);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const objects = useEditorStore((s) => s.objects);

  const fileRef = useRef<HTMLInputElement>(null);
  const modifyRef = useRef<HTMLInputElement>(null);

  const selectedComposerId = selectedIds.find((id) => sceneComposer.isComposerObject(id)) ?? null;
  const selectedObj = selectedComposerId ? objects[selectedComposerId] : null;

  async function handleGenerate() {
    if (!prompt.trim()) { setError('Please enter a description.'); return; }
    setLoading(true);
    setError(null);
    try {
      const objects = await callCompose(prompt.trim(), refImage ?? undefined);
      sceneComposer.replaceAll({ objects } as ComposerData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateAll() {
    const modifyPrompt = modifyRef.current?.value.trim();
    if (!modifyPrompt) { setError('Enter a modification prompt.'); return; }
    setLoading(true);
    setError(null);
    try {
      const objects = await callCompose(modifyPrompt, undefined, sceneComposer.getSceneSnapshot());
      sceneComposer.replaceAll({ objects } as ComposerData);
      if (modifyRef.current) modifyRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateSelected() {
    if (!selectedComposerId) { setError('Select a composer object first.'); return; }
    const modifyPrompt = modifyRef.current?.value.trim();
    if (!modifyPrompt) { setError('Enter a modification prompt.'); return; }
    setLoading(true);
    setError(null);
    try {
      const objects = await callCompose(
        modifyPrompt,
        undefined,
        sceneComposer.getSceneSnapshot(),
        selectedObj?.name ?? '',
      );
      sceneComposer.replaceAll({ objects } as ComposerData);
      if (modifyRef.current) modifyRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpe?g|webp)$/)) {
      setError('Only PNG, JPG, or WEBP images are supported.');
      return;
    }
    const uri = await fileToBase64(file);
    setRefImage(uri);
    e.target.value = '';
  }

  function handleClear() {
    sceneComposer.clearComposerObjects();
  }

  return (
    <div className="composer-panel">
      {/* Prompt section */}
      <div className="composer-section">
        <div className="composer-section-title">Describe Character</div>
        <textarea
          className="composer-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your character..."
          rows={4}
          disabled={loading}
        />
        <div className="composer-examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="composer-example-btn"
              onClick={() => setPrompt(ex)}
              disabled={loading}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Reference image */}
      <div className="composer-section">
        <div className="composer-section-title">Reference Image (optional)</div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          style={{ display: 'none' }}
          onChange={handleImageUpload}
        />
        {refImage ? (
          <div className="composer-img-preview">
            <img src={refImage} alt="Reference" />
            <button
              type="button"
              className="composer-img-clear"
              onClick={() => setRefImage(null)}
            >
              &times;
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="composer-upload-btn"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
          >
            + Upload Image
          </button>
        )}
      </div>

      {/* Generate button */}
      <div className="composer-section">
        <button
          type="button"
          className="composer-generate-btn"
          disabled={loading || !prompt.trim()}
          onClick={handleGenerate}
        >
          {loading ? (
            <span className="composer-spinner" />
          ) : null}
          {loading ? 'Generating…' : 'Generate Blocking'}
        </button>
        {sceneComposer.getComposerIds().size > 0 && !loading && (
          <button
            type="button"
            className="composer-clear-btn"
            onClick={handleClear}
          >
            Clear Scene
          </button>
        )}
      </div>

      {/* Modify section */}
      {sceneComposer.getComposerIds().size > 0 && (
        <div className="composer-section">
          <div className="composer-section-title">Modify</div>
          {selectedComposerId && selectedObj ? (
            <div className="composer-selected-label">
              Selected: <span>{selectedObj.name}</span>
            </div>
          ) : (
            <div className="composer-selected-label composer-selected-none">
              No composer object selected
            </div>
          )}
          <input
            ref={modifyRef}
            type="text"
            className="composer-modify-input"
            placeholder="e.g. make arms longer, add a helmet…"
            disabled={loading}
          />
          <div className="composer-modify-btns">
            <button
              type="button"
              className="composer-mod-btn"
              disabled={loading || !selectedComposerId}
              onClick={handleUpdateSelected}
            >
              Update Selected
            </button>
            <button
              type="button"
              className="composer-mod-btn composer-mod-btn-all"
              disabled={loading}
              onClick={handleUpdateAll}
            >
              Update All
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="composer-error">{error}</div>}
    </div>
  );
}

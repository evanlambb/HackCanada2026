import { useEffect, useRef } from 'react';
import { Viewport } from '../../engine/Viewport';
import { SceneManager } from '../../engine/SceneManager';
import { SelectionEngine } from '../../engine/SelectionEngine';
import { TransformEngine } from '../../engine/TransformEngine';
import { EditModeEngine } from '../../engine/EditModeEngine';
import { KeyboardManager } from '../../engine/KeyboardManager';
import { engineRef } from '../../engine/engineRef';
import { useEditorStore } from '../../store/editorStore';
import type { ActiveTool } from '../../store/types';

const tools: { tool: ActiveTool; label: string; key: string }[] = [
  { tool: 'select', label: 'Sel', key: '' },
  { tool: 'move', label: 'Move', key: 'G' },
  { tool: 'rotate', label: 'Rot', key: 'R' },
  { tool: 'scale', label: 'Scl', key: 'S' },
];

function SceneHUD() {
  const mode = useEditorStore((s) => s.mode);
  const editSubMode = useEditorStore((s) => s.editSubMode);
  const activeTool = useEditorStore((s) => s.activeTool);
  const setMode = useEditorStore((s) => s.setMode);
  const setEditObjectId = useEditorStore((s) => s.setEditObjectId);
  const setEditSubMode = useEditorStore((s) => s.setEditSubMode);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  function toggleMode() {
    if (mode === 'object') {
      if (selectedIds.length === 1) {
        setMode('edit');
        setEditObjectId(selectedIds[0]);
      }
    } else {
      setMode('object');
      setEditObjectId(null);
    }
  }

  return (
    <div className="scene-hud">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="hud-group">
          <button
            className={`hud-btn ${mode === 'object' ? 'active' : ''}`}
            onClick={toggleMode}
          >
            Object<span className="key">Tab</span>
          </button>
          <button
            className={`hud-btn ${mode === 'edit' ? 'active' : ''}`}
            onClick={toggleMode}
            disabled={mode === 'object' && selectedIds.length !== 1}
          >
            Edit<span className="key">Tab</span>
          </button>
        </div>

        {mode === 'edit' && (
          <div className="hud-group">
            {(['vertex', 'edge', 'face'] as const).map((sub, i) => (
              <button
                key={sub}
                className={`hud-btn ${editSubMode === sub ? 'active' : ''}`}
                onClick={() => setEditSubMode(sub)}
              >
                {sub.charAt(0).toUpperCase() + sub.slice(1)}
                <span className="key">{i + 1}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        <div className="hud-group">
          {tools.map((t) => (
            <button
              key={t.tool}
              className={`hud-btn ${activeTool === t.tool ? 'active' : ''}`}
              onClick={() => setActiveTool(t.tool)}
            >
              {t.label}
              {t.key && <span className="key">{t.key}</span>}
            </button>
          ))}
          {mode === 'edit' && (
            <>
              <div className="hud-sep" />
              <button
                className={`hud-btn ${activeTool === 'extrude' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTool('extrude');
                  engineRef.current?.editModeEngine.performExtrude();
                }}
              >
                Extr<span className="key">E</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SceneStatus() {
  const mode = useEditorStore((s) => s.mode);
  const editSubMode = useEditorStore((s) => s.editSubMode);
  const activeTool = useEditorStore((s) => s.activeTool);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedVerts = useEditorStore((s) => s.selectedVertices);
  const selectedEdges = useEditorStore((s) => s.selectedEdges);
  const selectedFaces = useEditorStore((s) => s.selectedFaces);

  return (
    <div className="scene-status">
      <span>
        <strong>{mode === 'edit' ? `Edit / ${editSubMode}` : 'Object'}</strong>
      </span>
      <span>{activeTool}</span>
      {mode === 'object' && <span>sel: {selectedIds.length}</span>}
      {mode === 'edit' && (
        <span>v={selectedVerts.size} e={selectedEdges.size} f={selectedFaces.size}</span>
      )}
      <span className="hint">alt+drag: orbit &middot; rmb: pan &middot; scroll: zoom &middot; f: focus</span>
    </div>
  );
}

export default function SceneViewPanel() {
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const viewport = new Viewport(el);
    const sceneManager = new SceneManager(viewport);
    const selectionEngine = new SelectionEngine(viewport, sceneManager);
    const transformEngine = new TransformEngine(viewport, sceneManager);
    const editModeEngine = new EditModeEngine(viewport, sceneManager);
    const keyboardManager = new KeyboardManager(
      transformEngine,
      editModeEngine,
      sceneManager,
      viewport,
    );

    engineRef.current = {
      viewport,
      sceneManager,
      selectionEngine,
      transformEngine,
      editModeEngine,
      keyboardManager,
    };

    return () => {
      keyboardManager.dispose();
      editModeEngine.dispose();
      transformEngine.dispose();
      selectionEngine.dispose();
      sceneManager.dispose();
      viewport.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div className="scene-view-wrap">
      <div ref={canvasRef} className="scene-canvas" />
      <SceneHUD />
      <SceneStatus />
    </div>
  );
}

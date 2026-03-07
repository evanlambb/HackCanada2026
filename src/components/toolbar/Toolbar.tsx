import { useEditorStore } from '../../store/editorStore';
import AddMenu from './AddMenu';
import { engineRef } from '../../engine/engineRef';
import type { ActiveTool } from '../../store/types';

const tools: { tool: ActiveTool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: '' },
  { tool: 'move', label: 'Move', key: 'G' },
  { tool: 'rotate', label: 'Rotate', key: 'R' },
  { tool: 'scale', label: 'Scale', key: 'S' },
];

export default function Toolbar() {
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
    <div className="app-toolbar">
      <AddMenu />
      <div className="tb-sep" />

      <button
        className={`tb-btn ${mode === 'object' ? 'active' : ''}`}
        onClick={toggleMode}
      >
        Object Mode
      </button>
      <button
        className={`tb-btn ${mode === 'edit' ? 'active' : ''}`}
        onClick={toggleMode}
        disabled={mode === 'object' && selectedIds.length !== 1}
      >
        Edit Mode
      </button>

      {mode === 'edit' && (
        <>
          <div className="tb-sep" />
          {(['vertex', 'edge', 'face'] as const).map((sub, i) => (
            <button
              key={sub}
              className={`tb-btn ${editSubMode === sub ? 'active' : ''}`}
              onClick={() => setEditSubMode(sub)}
            >
              {sub.charAt(0).toUpperCase() + sub.slice(1)} ({i + 1})
            </button>
          ))}
        </>
      )}

      <div className="tb-sep" />

      {tools.map((t) => (
        <button
          key={t.tool}
          className={`tb-btn ${activeTool === t.tool ? 'active' : ''}`}
          onClick={() => setActiveTool(t.tool)}
        >
          {t.label}
          {t.key && <span style={{ opacity: 0.5, marginLeft: 4 }}>{t.key}</span>}
        </button>
      ))}

      {mode === 'edit' && (
        <>
          <div className="tb-sep" />
          <button
            className={`tb-btn ${activeTool === 'extrude' ? 'active' : ''}`}
            onClick={() => {
              setActiveTool('extrude');
              engineRef.current?.editModeEngine.performExtrude(0.3);
            }}
          >
            Extrude <span style={{ opacity: 0.5, marginLeft: 4 }}>E</span>
          </button>
        </>
      )}
    </div>
  );
}

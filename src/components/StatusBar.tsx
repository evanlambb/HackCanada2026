import { useEditorStore } from '../store/editorStore';

export default function StatusBar() {
  const mode = useEditorStore((s) => s.mode);
  const editSubMode = useEditorStore((s) => s.editSubMode);
  const activeTool = useEditorStore((s) => s.activeTool);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedVerts = useEditorStore((s) => s.selectedVertices);
  const selectedEdges = useEditorStore((s) => s.selectedEdges);
  const selectedFaces = useEditorStore((s) => s.selectedFaces);
  const objects = useEditorStore((s) => s.objects);

  const objCount = Object.keys(objects).length;

  return (
    <div className="app-statusbar">
      <span>
        Mode: <strong>{mode === 'edit' ? `Edit (${editSubMode})` : 'Object'}</strong>
      </span>
      <span>
        Tool: <strong>{activeTool}</strong>
      </span>
      <span>Objects: {objCount}</span>
      {mode === 'object' && <span>Selected: {selectedIds.length}</span>}
      {mode === 'edit' && (
        <span>
          Selected: V={selectedVerts.size} E={selectedEdges.size} F=
          {selectedFaces.size}
        </span>
      )}
      <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
        Alt+drag / Middle-click: orbit &middot; Right-click: pan &middot; Scroll: zoom &middot; F: focus
      </span>
    </div>
  );
}

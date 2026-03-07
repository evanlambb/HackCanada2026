import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';

export default function HierarchyPanel() {
  const objects = useEditorStore((s) => s.objects);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const setSelection = useEditorStore((s) => s.setSelection);
  const addToSelection = useEditorStore((s) => s.addToSelection);
  const removeFromSelection = useEditorStore((s) => s.removeFromSelection);
  const updateObject = useEditorStore((s) => s.updateObject);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const sorted = Object.values(objects).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  function handleClick(id: string, e: React.MouseEvent) {
    if (e.shiftKey) {
      if (selectedIds.includes(id)) removeFromSelection(id);
      else addToSelection(id);
    } else {
      setSelection([id]);
    }
  }

  function handleDoubleClick(id: string) {
    setEditingId(id);
    setEditName(objects[id].name);
  }

  function commitRename() {
    if (editingId && editName.trim()) {
      updateObject(editingId, { name: editName.trim() });
    }
    setEditingId(null);
  }

  return (
    <div className="hierarchy-panel">
      {sorted.length === 0 && (
        <div className="inspector-empty">No objects in scene</div>
      )}
      {sorted.map((obj) => (
        <div
          key={obj.id}
          className={`hierarchy-item ${selectedIds.includes(obj.id) ? 'selected' : ''}`}
          onClick={(e) => handleClick(obj.id, e)}
          onDoubleClick={() => handleDoubleClick(obj.id)}
        >
          <span className="icon">&#9642;</span>
          {editingId === obj.id ? (
            <input
              className="name-input"
              value={editName}
              autoFocus
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="name">{obj.name}</span>
          )}
        </div>
      ))}
    </div>
  );
}

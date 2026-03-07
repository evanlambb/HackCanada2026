import { useState, useRef, useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';
import type { GeometryType } from '../../store/types';
import { engineRef } from '../../engine/engineRef';

const primitives: { type: GeometryType; label: string }[] = [
  { type: 'box', label: 'Cube' },
  { type: 'sphere', label: 'Sphere' },
  { type: 'cylinder', label: 'Cylinder' },
  { type: 'cone', label: 'Cone' },
  { type: 'torus', label: 'Torus' },
  { type: 'plane', label: 'Plane' },
  { type: 'icosahedron', label: 'Icosahedron' },
];

function AddMenu() {
  const addObject = useEditorStore((s) => s.addObject);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    engineRef.current?.keyboardManager.setAddMenuCallback(() =>
      setOpen((o) => !o),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function add(type: GeometryType) {
    addObject(type);
    setOpen(false);
  }

  return (
    <div className="add-menu-wrap" ref={ref}>
      <button className="add-btn" onClick={() => setOpen((o) => !o)} title="Add primitive (Shift+A)">
        +
      </button>
      {open && (
        <div className="add-menu">
          {primitives.map((p) => (
            <button
              key={p.type}
              className="add-menu-item"
              onClick={() => add(p.type)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
      <div className="hierarchy-header">
        <span className="hierarchy-title">Scene</span>
        <AddMenu />
      </div>
      <div className="hierarchy-list">
        {sorted.length === 0 && (
          <div className="hierarchy-empty">Empty scene</div>
        )}
        {sorted.map((obj) => (
          <div
            key={obj.id}
            className={`hierarchy-item ${selectedIds.includes(obj.id) ? 'selected' : ''}`}
            onClick={(e) => handleClick(obj.id, e)}
            onDoubleClick={() => handleDoubleClick(obj.id)}
          >
            <span className="icon">&#9670;</span>
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
    </div>
  );
}

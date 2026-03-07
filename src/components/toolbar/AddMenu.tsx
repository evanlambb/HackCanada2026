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

export default function AddMenu() {
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
      <button className="tb-btn" onClick={() => setOpen((o) => !o)}>
        + Add
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

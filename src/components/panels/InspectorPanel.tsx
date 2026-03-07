import { useEditorStore } from '../../store/editorStore';
import type { Vec3 } from '../../store/types';
import { engineRef } from '../../engine/engineRef';

function Vec3Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
}) {
  function set(axis: number, raw: string) {
    const n = parseFloat(raw);
    if (isNaN(n)) return;
    const v: Vec3 = [...value];
    v[axis] = n;
    onChange(v);
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontFamily: 'var(--mono)',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-dim)',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        {label}
      </div>
      <div className="inspector-row">
        <span className="inspector-label x">X</span>
        <input
          className="inspector-input"
          type="number"
          step="0.1"
          value={Number(value[0].toFixed(3))}
          onChange={(e) => set(0, e.target.value)}
        />
        <span className="inspector-label y">Y</span>
        <input
          className="inspector-input"
          type="number"
          step="0.1"
          value={Number(value[1].toFixed(3))}
          onChange={(e) => set(1, e.target.value)}
        />
        <span className="inspector-label z">Z</span>
        <input
          className="inspector-input"
          type="number"
          step="0.1"
          value={Number(value[2].toFixed(3))}
          onChange={(e) => set(2, e.target.value)}
        />
      </div>
    </div>
  );
}

export default function InspectorPanel() {
  const objects = useEditorStore((s) => s.objects);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const updateObject = useEditorStore((s) => s.updateObject);

  if (selectedIds.length === 0) {
    return (
      <div className="inspector-panel">
        <div className="inspector-empty">No selection</div>
      </div>
    );
  }

  if (selectedIds.length > 1) {
    return (
      <div className="inspector-panel">
        <div className="inspector-empty">{selectedIds.length} objects</div>
      </div>
    );
  }

  const obj = objects[selectedIds[0]];
  if (!obj) return null;

  const mesh = engineRef.current?.sceneManager.getMeshById(obj.id);
  const vertexCount = mesh?.geometry.attributes.position?.count ?? 0;
  const faceCount = mesh?.geometry.index
    ? mesh.geometry.index.count / 3
    : vertexCount / 3;

  const toDeg = (r: Vec3): Vec3 => [
    (r[0] * 180) / Math.PI,
    (r[1] * 180) / Math.PI,
    (r[2] * 180) / Math.PI,
  ];
  const toRad = (d: Vec3): Vec3 => [
    (d[0] * Math.PI) / 180,
    (d[1] * Math.PI) / 180,
    (d[2] * Math.PI) / 180,
  ];

  return (
    <div className="inspector-panel">
      <div className="inspector-section">
        <div className="inspector-section-title">Transform</div>
        <Vec3Row
          label="Position"
          value={obj.position}
          onChange={(v) => updateObject(obj.id, { position: v })}
        />
        <Vec3Row
          label="Rotation"
          value={toDeg(obj.rotation)}
          onChange={(v) => updateObject(obj.id, { rotation: toRad(v) })}
        />
        <Vec3Row
          label="Scale"
          value={obj.scale}
          onChange={(v) => updateObject(obj.id, { scale: v })}
        />
      </div>

      <div className="inspector-section">
        <div className="inspector-section-title">Material</div>
        <input
          className="inspector-color"
          type="color"
          value={obj.color}
          onChange={(e) => updateObject(obj.id, { color: e.target.value })}
        />
      </div>

      <div className="inspector-section">
        <div className="inspector-section-title">Geometry</div>
        <div className="inspector-info">{obj.geometryType}</div>
        <div className="inspector-info">{vertexCount} verts &middot; {Math.floor(faceCount)} faces</div>
      </div>
    </div>
  );
}

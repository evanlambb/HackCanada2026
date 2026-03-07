import { useEditorStore } from '../../store/editorStore';
import { engineRef } from '../../engine/engineRef';

export default function AnimationsPanel() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const objects = useEditorStore((s) => s.objects);

  const selectedObj = selectedIds.length > 0 ? objects[selectedIds[0]] : null;
  const animations = selectedObj?.animations ?? [];
  const activeAnimation = selectedObj?.activeAnimation ?? null;

  function handleClick(name: string) {
    if (!selectedObj) return;
    const sm = engineRef.current?.sceneManager;
    if (!sm) return;
    if (activeAnimation === name) {
      sm.stopAnimation(selectedObj.id);
    } else {
      sm.playAnimation(selectedObj.id, name);
    }
  }

  if (!selectedObj || animations.length === 0) {
    return (
      <div className="animation-panel">
        <div className="animation-empty-state">
          {selectedObj
            ? 'No animations available for this model'
            : 'Select an object to view animations'}
        </div>
      </div>
    );
  }

  return (
    <div className="animation-panel">
      <div className="animation-panel-header">
        <span className="animation-panel-title">Animations</span>
        <span className="animation-panel-object">{selectedObj.name}</span>
      </div>
      <div className="animation-buttons">
        {animations.map((anim) => (
          <button
            key={anim.name}
            className={`animation-btn${activeAnimation === anim.name ? ' active' : ''}`}
            onClick={() => handleClick(anim.name)}
            title={anim.name}
          >
            <span className="animation-btn-name">{anim.name}</span>
            <span className="animation-btn-duration">{anim.duration.toFixed(1)}s</span>
          </button>
        ))}
      </div>
    </div>
  );
}

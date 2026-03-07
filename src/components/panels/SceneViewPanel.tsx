import { useEffect, useRef } from 'react';
import { Viewport } from '../../engine/Viewport';
import { SceneManager } from '../../engine/SceneManager';
import { SelectionEngine } from '../../engine/SelectionEngine';
import { TransformEngine } from '../../engine/TransformEngine';
import { EditModeEngine } from '../../engine/EditModeEngine';
import { KeyboardManager } from '../../engine/KeyboardManager';
import { engineRef } from '../../engine/engineRef';

export default function SceneViewPanel() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
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

  return <div ref={containerRef} className="scene-view" />;
}

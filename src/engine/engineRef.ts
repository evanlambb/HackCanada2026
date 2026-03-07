import type { Viewport } from './Viewport';
import type { SceneManager } from './SceneManager';
import type { SelectionEngine } from './SelectionEngine';
import type { TransformEngine } from './TransformEngine';
import type { EditModeEngine } from './EditModeEngine';
import type { KeyboardManager } from './KeyboardManager';

export interface EngineInstances {
  viewport: Viewport;
  sceneManager: SceneManager;
  selectionEngine: SelectionEngine;
  transformEngine: TransformEngine;
  editModeEngine: EditModeEngine;
  keyboardManager: KeyboardManager;
}

export const engineRef: { current: EngineInstances | null } = { current: null };

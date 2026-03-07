import { useEditorStore } from '../store/editorStore';
import type { GeometryType, Vec3 } from '../store/types';

export interface ComposerObject {
  name: string;
  type: 'box' | 'cylinder' | 'sphere';
  position: [number, number, number];
  rotation: [number, number, number]; // degrees from Gemini
  scale: [number, number, number];
  color: string;
}

export interface ComposerData {
  objects: ComposerObject[];
}

function degToRad(d: number): number {
  return d * (Math.PI / 180);
}

class SceneComposerEngine {
  private composerIds = new Set<string>();

  instantiateFromJSON(data: ComposerData): void {
    const store = useEditorStore.getState();
    const newIds: string[] = [];

    for (const obj of data.objects) {
      const geoType = obj.type as GeometryType;
      const id = store.addObject(geoType, obj.position as Vec3);
      store.updateObject(id, {
        name: obj.name,
        rotation: [
          degToRad(obj.rotation[0]),
          degToRad(obj.rotation[1]),
          degToRad(obj.rotation[2]),
        ] as Vec3,
        scale: obj.scale as Vec3,
        color: obj.color,
      });
      this.composerIds.add(id);
      newIds.push(id);
    }

    // Select all newly created composer objects
    if (newIds.length > 0) {
      store.setSelection(newIds);
    }
  }

  updateSingleObject(id: string, data: ComposerObject): void {
    const store = useEditorStore.getState();
    store.updateObject(id, {
      name: data.name,
      position: data.position as Vec3,
      rotation: [
        degToRad(data.rotation[0]),
        degToRad(data.rotation[1]),
        degToRad(data.rotation[2]),
      ] as Vec3,
      scale: data.scale as Vec3,
      color: data.color,
    });
  }

  replaceAll(data: ComposerData): void {
    this.clearComposerObjects();
    this.instantiateFromJSON(data);
  }

  clearComposerObjects(): void {
    const store = useEditorStore.getState();
    for (const id of this.composerIds) {
      store.removeObject(id);
    }
    this.composerIds.clear();
  }

  getComposerIds(): Set<string> {
    return new Set(this.composerIds);
  }

  isComposerObject(id: string): boolean {
    return this.composerIds.has(id);
  }

  getSceneSnapshot(): ComposerObject[] {
    const store = useEditorStore.getState();
    const result: ComposerObject[] = [];
    for (const id of this.composerIds) {
      const obj = store.objects[id];
      if (!obj) continue;
      const type = obj.geometryType as 'box' | 'cylinder' | 'sphere';
      if (type !== 'box' && type !== 'cylinder' && type !== 'sphere') continue;
      result.push({
        name: obj.name,
        type,
        position: [...obj.position] as [number, number, number],
        rotation: [
          obj.rotation[0] * (180 / Math.PI),
          obj.rotation[1] * (180 / Math.PI),
          obj.rotation[2] * (180 / Math.PI),
        ],
        scale: [...obj.scale] as [number, number, number],
        color: obj.color,
      });
    }
    return result;
  }
}

export const sceneComposer = new SceneComposerEngine();

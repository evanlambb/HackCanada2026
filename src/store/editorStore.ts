import { create } from 'zustand';
import type {
  SceneObject,
  EditorMode,
  EditSubMode,
  ActiveTool,
  Vec3,
  GeometryType,
  AnimationData,
} from './types';

let nextId = 1;
function generateId(): string {
  return `obj_${nextId++}`;
}
function peekId(): string {
  return `obj_${nextId}`;
}

const geoNames: Record<GeometryType, string> = {
  box: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cone: 'Cone',
  torus: 'Torus',
  plane: 'Plane',
  icosahedron: 'Icosahedron',
  imported: 'Import',
};

export interface EditorState {
  objects: Record<string, SceneObject>;
  selectedIds: string[];
  mode: EditorMode;
  editSubMode: EditSubMode;
  activeTool: ActiveTool;
  editObjectId: string | null;

  selectedVertices: Set<number>;
  selectedEdges: Set<number>;
  selectedFaces: Set<number>;

  enhanceScreenshot: string | null;
  enhanceResult: string | null;
  enhanceLoading: boolean;
  enhanceGallery: { filename: string; url: string }[];
  setEnhanceScreenshot: (s: string | null) => void;
  setEnhanceResult: (s: string | null) => void;
  setEnhanceLoading: (loading: boolean) => void;
  setEnhanceGallery: (images: { filename: string; url: string }[]) => void;
  addToEnhanceGallery: (image: { filename: string; url: string }) => void;

  peekNextId: () => string;
  addObject: (type: GeometryType, position?: Vec3) => string;
  addImportedObject: (name: string, animations?: AnimationData[]) => string;
  setActiveAnimation: (objectId: string, animationName: string | null) => void;
  setRigTaskId: (objectId: string, taskId: string) => void;
  setMeshyTaskId: (objectId: string, taskId: string) => void;
  addAnimationsToObject: (objectId: string, anims: AnimationData[]) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<SceneObject>) => void;
  setSelection: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  setMode: (mode: EditorMode) => void;
  setEditSubMode: (subMode: EditSubMode) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setEditObjectId: (id: string | null) => void;
  selectAllToggle: () => void;

  setSelectedVertices: (vertices: Set<number>) => void;
  setSelectedEdges: (edges: Set<number>) => void;
  setSelectedFaces: (faces: Set<number>) => void;
  toggleVertex: (index: number) => void;
  toggleEdge: (index: number) => void;
  toggleFace: (index: number) => void;
  clearEditSelection: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  objects: {},
  selectedIds: [],
  mode: 'object',
  editSubMode: 'vertex',
  activeTool: 'select',
  editObjectId: null,
  selectedVertices: new Set(),
  selectedEdges: new Set(),
  selectedFaces: new Set(),

  enhanceScreenshot: null,
  enhanceResult: null,
  enhanceLoading: false,
  enhanceGallery: [],
  setEnhanceScreenshot: (s) => set({ enhanceScreenshot: s }),
  setEnhanceResult: (s) => set({ enhanceResult: s }),
  setEnhanceLoading: (loading) => set({ enhanceLoading: loading }),
  setEnhanceGallery: (images) => set({ enhanceGallery: images }),
  addToEnhanceGallery: (image) =>
    set((s) => ({
      enhanceGallery: [
        image,
        ...s.enhanceGallery.filter((existing) => existing.filename !== image.filename),
      ],
    })),

  peekNextId: () => peekId(),

  addObject: (type, position = [0, 0, 0]) => {
    const id = generateId();
    const baseName = geoNames[type] ?? 'Object';
    const existing = Object.values(get().objects).map((o) => o.name);
    let name = baseName;
    let c = 1;
    while (existing.includes(name)) {
      name = `${baseName}.${String(c).padStart(3, '0')}`;
      c++;
    }
    const obj: SceneObject = {
      id,
      name,
      type: 'mesh',
      geometryType: type,
      position,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#808080',
      children: [],
      parent: null,
      visible: true,
    };
    set((s) => ({
      objects: { ...s.objects, [id]: obj },
      selectedIds: [id],
    }));
    return id;
  },

  addImportedObject: (importName, animations) => {
    const id = generateId();
    const existing = Object.values(get().objects).map((o) => o.name);
    let name = importName;
    let c = 1;
    while (existing.includes(name)) {
      name = `${importName}.${String(c).padStart(3, '0')}`;
      c++;
    }
    const obj: SceneObject = {
      id,
      name,
      type: 'mesh',
      geometryType: 'imported',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#808080',
      children: [],
      parent: null,
      visible: true,
      animations: animations ?? [],
      activeAnimation: null,
    };
    set((s) => ({
      objects: { ...s.objects, [id]: obj },
      selectedIds: [id],
    }));
    return id;
  },

  setActiveAnimation: (objectId, animationName) =>
    set((s) => {
      if (!s.objects[objectId]) return s;
      return {
        objects: {
          ...s.objects,
          [objectId]: { ...s.objects[objectId], activeAnimation: animationName },
        },
      };
    }),

  setRigTaskId: (objectId, taskId) =>
    set((s) => {
      if (!s.objects[objectId]) return s;
      return {
        objects: {
          ...s.objects,
          [objectId]: { ...s.objects[objectId], rigTaskId: taskId },
        },
      };
    }),

  setMeshyTaskId: (objectId, taskId) =>
    set((s) => {
      if (!s.objects[objectId]) return s;
      return {
        objects: {
          ...s.objects,
          [objectId]: { ...s.objects[objectId], meshyTaskId: taskId },
        },
      };
    }),

  addAnimationsToObject: (objectId, anims) =>
    set((s) => {
      if (!s.objects[objectId]) return s;
      const existing = s.objects[objectId].animations ?? [];
      return {
        objects: {
          ...s.objects,
          [objectId]: {
            ...s.objects[objectId],
            animations: [...existing, ...anims],
          },
        },
      };
    }),

  removeObject: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.objects;
      return {
        objects: rest,
        selectedIds: s.selectedIds.filter((x) => x !== id),
      };
    }),

  updateObject: (id, updates) =>
    set((s) => {
      if (!s.objects[id]) return s;
      return {
        objects: { ...s.objects, [id]: { ...s.objects[id], ...updates } },
      };
    }),

  setSelection: (ids) => set({ selectedIds: ids }),
  addToSelection: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds
        : [...s.selectedIds, id],
    })),
  removeFromSelection: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.filter((x) => x !== id),
    })),

  setMode: (mode) => set({ mode }),
  setEditSubMode: (subMode) => set({ editSubMode: subMode }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setEditObjectId: (id) => set({ editObjectId: id }),

  selectAllToggle: () => {
    const s = get();
    if (s.mode === 'object') {
      const all = Object.keys(s.objects);
      set({ selectedIds: s.selectedIds.length === all.length ? [] : all });
    }
  },

  setSelectedVertices: (v) => set({ selectedVertices: v }),
  setSelectedEdges: (e) => set({ selectedEdges: e }),
  setSelectedFaces: (f) => set({ selectedFaces: f }),

  toggleVertex: (i) =>
    set((s) => {
      const n = new Set(s.selectedVertices);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return { selectedVertices: n };
    }),
  toggleEdge: (i) =>
    set((s) => {
      const n = new Set(s.selectedEdges);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return { selectedEdges: n };
    }),
  toggleFace: (i) =>
    set((s) => {
      const n = new Set(s.selectedFaces);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return { selectedFaces: n };
    }),

  clearEditSelection: () =>
    set({
      selectedVertices: new Set(),
      selectedEdges: new Set(),
      selectedFaces: new Set(),
    }),
}));

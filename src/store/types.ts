export type Vec3 = [number, number, number];

export type GeometryType =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'plane'
  | 'icosahedron';

export type EditorMode = 'object' | 'edit';
export type EditSubMode = 'vertex' | 'edge' | 'face';
export type ActiveTool = 'select' | 'move' | 'rotate' | 'scale' | 'extrude';

export interface SceneObject {
  id: string;
  name: string;
  type: 'mesh' | 'group';
  geometryType: GeometryType;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  children: string[];
  parent: string | null;
  visible: boolean;
}

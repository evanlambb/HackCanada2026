import { useRef } from 'react';
import { Layout, Model, type IJsonModel, type TabNode } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import SceneViewPanel from './panels/SceneViewPanel';
import HierarchyPanel from './panels/HierarchyPanel';
import InspectorPanel from './panels/InspectorPanel';
import AnimationsPanel from './panels/AnimationsPanel';
import MeshGenPanel from './panels/MeshGenPanel';
import EnhancePanel from './panels/EnhancePanel';
import SceneComposerPanel from './panels/SceneComposerPanel';

const layoutJson: IJsonModel = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    splitterSize: 4,
  },
  borders: [],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row',
        weight: 18,
        children: [
          {
            type: 'tabset',
            weight: 50,
            children: [
              { type: 'tab', name: 'Hierarchy', component: 'hierarchy' },
            ],
          },
          {
            type: 'tabset',
            weight: 50,
            children: [
              { type: 'tab', name: 'Composer', component: 'composer' },
              { type: 'tab', name: 'Mesh Gen', component: 'meshGen' },
            ],
          },
        ],
      },
      {
        // Nested row → FlexLayout alternates direction, so this is vertical
        type: 'row',
        weight: 58,
        children: [
          {
            type: 'tabset',
            weight: 75,
            children: [
              { type: 'tab', name: 'Scene View', component: 'sceneView' },
            ],
          },
          {
            type: 'tabset',
            weight: 25,
            children: [
              { type: 'tab', name: 'Animation Gen', component: 'animations' },
            ],
          },
        ],
      },
      {
        type: 'tabset',
        weight: 24,
        children: [
          { type: 'tab', name: 'Inspector', component: 'inspector' },
          { type: 'tab', name: 'Image Gen', component: 'enhance' },
        ],
      },
    ],
  },
};

export default function EditorLayout() {
  const modelRef = useRef(Model.fromJson(layoutJson));

  function factory(node: TabNode) {
    switch (node.getComponent()) {
      case 'sceneView':
        return <SceneViewPanel />;
      case 'hierarchy':
        return <HierarchyPanel />;
      case 'inspector':
        return <InspectorPanel />;
      case 'animations':
        return <AnimationsPanel />;
      case 'meshGen':
        return <MeshGenPanel />;
      case 'enhance':
        return <EnhancePanel />;
      case 'composer':
        return <SceneComposerPanel />;
      default:
        return null;
    }
  }

  return (
    <div className="app-layout">
      <Layout model={modelRef.current} factory={factory} />
    </div>
  );
}

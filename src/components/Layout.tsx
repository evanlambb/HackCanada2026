import { useRef } from 'react';
import { Layout, Model, type IJsonModel, type TabNode } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import SceneViewPanel from './panels/SceneViewPanel';
import HierarchyPanel from './panels/HierarchyPanel';
import InspectorPanel from './panels/InspectorPanel';

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
        type: 'tabset',
        weight: 18,
        children: [
          { type: 'tab', name: 'Hierarchy', component: 'hierarchy' },
        ],
      },
      {
        type: 'tabset',
        weight: 58,
        children: [
          { type: 'tab', name: 'Scene View', component: 'sceneView' },
        ],
      },
      {
        type: 'tabset',
        weight: 24,
        children: [
          { type: 'tab', name: 'Inspector', component: 'inspector' },
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

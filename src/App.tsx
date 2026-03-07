import Toolbar from './components/toolbar/Toolbar';
import EditorLayout from './components/Layout';
import StatusBar from './components/StatusBar';

export default function App() {
  return (
    <div className="app-container">
      <Toolbar />
      <EditorLayout />
      <StatusBar />
    </div>
  );
}

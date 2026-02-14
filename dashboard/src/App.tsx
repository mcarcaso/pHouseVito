import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import Chat from './components/Chat';
import Sessions from './components/Sessions';
import Memories from './components/Memories';
import Skills from './components/Skills';
import Secrets from './components/Secrets';
import Jobs from './components/Jobs';
import Settings from './components/Settings';
import System from './components/System';
import './App.css';

function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>Vito</h1>
        <nav className="tabs">
          <NavLink to="/chat">Chat</NavLink>
          <NavLink to="/sessions">Sessions</NavLink>
          <NavLink to="/memories">Memories</NavLink>
          <NavLink to="/skills">Skills</NavLink>
          <NavLink to="/jobs">Jobs</NavLink>
          <NavLink to="/secrets">Secrets</NavLink>
          <NavLink to="/system">System</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>

      <main className="content">
        <Routes>
          <Route path="/chat" element={<Chat />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/memories" element={<Memories />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/secrets" element={<Secrets />} />
          <Route path="/system" element={<System />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;

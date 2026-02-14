import { useState, useRef, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import Chat from './components/Chat';
import Sessions from './components/Sessions';
import Memories from './components/Memories';
import Skills from './components/Skills';
import Secrets from './components/Secrets';
import Jobs from './components/Jobs';
import Settings from './components/Settings';
import System from './components/System';
import Server from './components/Server';
import Apps from './components/Apps';
import Channels from './components/Channels';
import Traces from './components/Traces';
import './App.css';

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close menu on route change (mobile only)
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Close menu on outside click (mobile only)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // Get current page title for header
  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/chat' || path === '/') return 'Chat';
    if (path.startsWith('/sessions')) return 'Sessions';
    if (path.startsWith('/memories')) return 'Memories';
    if (path.startsWith('/skills')) return 'Skills';
    if (path.startsWith('/jobs')) return 'Jobs';
    if (path.startsWith('/channels')) return 'Channels';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/secrets')) return 'Secrets';
    if (path.startsWith('/system')) return 'System';
    if (path.startsWith('/server')) return 'Server';
    if (path.startsWith('/apps')) return 'Apps';
    if (path.startsWith('/traces')) return 'Traces';
    return 'Vito';
  };

  const navContent = (
    <>
      <NavLink to="/chat" className="nav-menu-item">
        <span className="nav-menu-icon">💬</span>
        Chat
      </NavLink>

      <div className="nav-menu-divider" />
      <span className="nav-menu-section">Admin</span>

      <NavLink to="/sessions" className="nav-menu-item">
        <span className="nav-menu-icon">📡</span>
        Sessions
      </NavLink>
      <NavLink to="/memories" className="nav-menu-item">
        <span className="nav-menu-icon">🧠</span>
        Memories
      </NavLink>
      <NavLink to="/skills" className="nav-menu-item">
        <span className="nav-menu-icon">🛠️</span>
        Skills
      </NavLink>
      <NavLink to="/jobs" className="nav-menu-item">
        <span className="nav-menu-icon">⏰</span>
        Jobs
      </NavLink>
      <NavLink to="/apps" className="nav-menu-item">
        <span className="nav-menu-icon">🚀</span>
        Apps
      </NavLink>
      <NavLink to="/traces" className="nav-menu-item">
        <span className="nav-menu-icon">🔍</span>
        Traces
      </NavLink>

      <div className="nav-menu-divider" />
      <span className="nav-menu-section">Config</span>

      <NavLink to="/channels" className="nav-menu-item">
        <span className="nav-menu-icon">📡</span>
        Channels
      </NavLink>
      <NavLink to="/settings" className="nav-menu-item">
        <span className="nav-menu-icon">⚙️</span>
        Settings
      </NavLink>
      <NavLink to="/secrets" className="nav-menu-item">
        <span className="nav-menu-icon">🔑</span>
        Secrets
      </NavLink>

      <div className="nav-menu-divider" />

      <NavLink to="/system" className="nav-menu-item">
        <span className="nav-menu-icon">📄</span>
        System
      </NavLink>
      <NavLink to="/server" className="nav-menu-item">
        <span className="nav-menu-icon">🖥️</span>
        Server
      </NavLink>
    </>
  );

  return (
    <div className="app">
      {/* Desktop sidebar — always visible */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">🤌</span>
          <span className="sidebar-title">Vito</span>
        </div>
        <nav className="sidebar-nav">
          {navContent}
        </nav>
      </aside>

      {/* Mobile top bar with hamburger */}
      <header className="top-bar">
        <div className="hamburger-area" ref={menuRef}>
          <button
            className={`hamburger-btn ${menuOpen ? 'open' : ''}`}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>

          {menuOpen && (
            <nav className="nav-menu">
              {navContent}
            </nav>
          )}
        </div>

        <h1 className="top-bar-title">{getPageTitle()}</h1>
      </header>

      {/* Overlay when menu open (mobile) */}
      {menuOpen && <div className="menu-overlay" onClick={() => setMenuOpen(false)} />}

      <main className="content">
        <Routes>
          <Route path="/chat" element={<Chat />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/memories" element={<Memories />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/secrets" element={<Secrets />} />
          <Route path="/system" element={<System />} />
          <Route path="/server" element={<Server />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/traces" element={<Traces />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;

import { useState, useRef, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import Chat from './components/Chat';
import Sessions from './components/Sessions';
import Memory from './components/Memory';
import Skills from './components/Skills';
import Secrets from './components/Secrets';
import Jobs from './components/Jobs';
import System from './components/System';
import Server from './components/Server';
import Apps from './components/Apps';
import Drive from './components/Drive';
import Traces from './components/Traces';
import PiSessions from './components/PiSessions';
import UnifiedSettings from './components/settings/UnifiedSettings';
import Login from './components/Login';
import { loadDefaults } from './utils/defaults';

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'login' | 'setup'>('loading');
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Check auth status on mount
  useEffect(() => {
    fetch('/api/auth/check')
      .then(r => r.json())
      .then(data => {
        if (!data.passwordSet) setAuthState('setup');
        else if (data.authenticated) setAuthState('authenticated');
        else setAuthState('login');
      })
      .catch(() => setAuthState('authenticated')); // If check fails, allow through (offline/dev)
  }, []);

  // Load resolved settings defaults from the backend before any settings UI
  // can render — settingsResolution.ts pulls them out via getDefaults().
  useEffect(() => {
    loadDefaults()
      .then(() => setDefaultsLoaded(true))
      .catch((err) => {
        console.error('Failed to load settings defaults:', err);
        setDefaultsLoaded(true); // unblock the UI; settings panels will surface the error themselves
      });
  }, []);

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
    if (path.startsWith('/memory')) return 'Memory';
    if (path.startsWith('/skills')) return 'Skills';
    if (path.startsWith('/jobs')) return 'Jobs';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/secrets')) return 'Secrets';
    if (path.startsWith('/system')) return 'System';
    if (path.startsWith('/server')) return 'Server';
    if (path.startsWith('/apps')) return 'Apps';
    if (path.startsWith('/drive')) return 'Drive';
    if (path.startsWith('/traces')) return 'Traces';
    if (path.startsWith('/pi-sessions')) return 'Pi Sessions';
    return 'Chat';
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthState('login');
  };

  // Show loading spinner while checking auth or loading defaults
  if (authState === 'loading' || !defaultsLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a] text-neutral-400">
        Loading...
      </div>
    );
  }

  // Show login/setup screen
  if (authState === 'login' || authState === 'setup') {
    return (
      <Login
        mode={authState}
        onSuccess={() => setAuthState('authenticated')}
      />
    );
  }

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-950 text-blue-400'
        : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
    }`;

  const navContent = (
    <>
      <NavLink to="/chat" className={navItemClass}>
        <span className="w-6 text-center text-base">💬</span>
        Chat
      </NavLink>

      <div className="h-px bg-neutral-800 my-1.5 mx-2" />
      <span className="block px-3 py-1 text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">Admin</span>

      <NavLink to="/sessions" className={navItemClass}>
        <span className="w-6 text-center text-base">📡</span>
        Sessions
      </NavLink>
      <NavLink to="/memory" className={navItemClass}>
        <span className="w-6 text-center text-base">🧠</span>
        Memory
      </NavLink>
      <NavLink to="/skills" className={navItemClass}>
        <span className="w-6 text-center text-base">🛠️</span>
        Skills
      </NavLink>
      <NavLink to="/jobs" className={navItemClass}>
        <span className="w-6 text-center text-base">⏰</span>
        Jobs
      </NavLink>
      <NavLink to="/apps" className={navItemClass}>
        <span className="w-6 text-center text-base">🚀</span>
        Apps
      </NavLink>
      <NavLink to="/drive" className={navItemClass}>
        <span className="w-6 text-center text-base">📁</span>
        Drive
      </NavLink>
      <NavLink to="/traces" className={navItemClass}>
        <span className="w-6 text-center text-base">🔍</span>
        Traces
      </NavLink>
      <NavLink to="/pi-sessions" className={navItemClass}>
        <span className="w-6 text-center text-base">🧵</span>
        Pi Sessions
      </NavLink>

      <div className="h-px bg-neutral-800 my-1.5 mx-2" />
      <span className="block px-3 py-1 text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">Config</span>

      <NavLink to="/settings" className={navItemClass}>
        <span className="w-6 text-center text-base">⚙️</span>
        Settings
      </NavLink>
      <NavLink to="/secrets" className={navItemClass}>
        <span className="w-6 text-center text-base">🔑</span>
        Secrets
      </NavLink>

      <div className="h-px bg-neutral-800 my-1.5 mx-2" />

      <NavLink to="/system" className={navItemClass}>
        <span className="w-6 text-center text-base">📄</span>
        System
      </NavLink>
      <NavLink to="/server" className={navItemClass}>
        <span className="w-6 text-center text-base">🖥️</span>
        Server
      </NavLink>

      {authState === 'authenticated' && (
        <>
          <div className="h-px bg-neutral-800 my-1.5 mx-2" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-neutral-400 hover:bg-neutral-800 hover:text-white w-full text-left"
          >
            <span className="w-6 text-center text-base">🚪</span>
            Logout
          </button>
        </>
      )}
    </>
  );

  return (
    <div className="flex flex-col md:flex-row min-h-screen min-h-dvh bg-[#0a0a0a] text-neutral-200">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex flex-col w-[220px] min-w-[220px] h-screen h-dvh bg-neutral-900 border-r border-neutral-800 overflow-y-auto overflow-x-hidden shrink-0 fixed left-0 top-0">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <span className="text-2xl">🤌</span>
          <span className="text-lg font-bold text-white tracking-wide">Dashboard</span>
        </div>
        <nav className="px-2 pb-4 flex-1">
          {navContent}
        </nav>
      </aside>

      {/* Mobile top bar with hamburger */}
      <header className="md:hidden flex items-center gap-3 px-4 h-[52px] min-h-[52px] bg-neutral-900 border-b border-neutral-800 z-[200] shrink-0 fixed top-0 left-0 right-0">
        <div className="relative z-[300]" ref={menuRef}>
          <button
            className="flex flex-col justify-center gap-[5px] w-9 h-9 p-[7px] bg-transparent border-none cursor-pointer rounded-md transition-colors hover:bg-neutral-800"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <span className={`block w-full h-0.5 bg-neutral-400 rounded transition-all origin-center ${menuOpen ? 'translate-y-[7px] rotate-45' : ''}`} />
            <span className={`block w-full h-0.5 bg-neutral-400 rounded transition-all ${menuOpen ? 'opacity-0 scale-x-0' : ''}`} />
            <span className={`block w-full h-0.5 bg-neutral-400 rounded transition-all origin-center ${menuOpen ? '-translate-y-[7px] -rotate-45' : ''}`} />
          </button>

          {menuOpen && (
            <nav className="absolute top-[calc(100%+8px)] left-0 w-[220px] max-h-[calc(100dvh-70px)] overflow-y-auto bg-neutral-900 border border-neutral-800 rounded-xl p-2 shadow-2xl animate-[menuSlideIn_0.15s_ease-out]">
              {navContent}
            </nav>
          )}
        </div>

        <h1 className="text-base font-semibold text-white m-0 whitespace-nowrap overflow-hidden text-ellipsis">{getPageTitle()}</h1>
      </header>

      {/* Overlay when menu open (mobile) */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-[150] animate-[overlayFade_0.15s_ease-out]"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="flex-1 flex flex-col min-h-0 pt-[52px] md:pt-0 md:ml-[220px]">
        <Routes>
          <Route path="/chat" element={<Chat />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/settings" element={<UnifiedSettings />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/secrets" element={<Secrets />} />
          <Route path="/system" element={<System />} />
          <Route path="/server" element={<Server />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/drive/*" element={<Drive />} />
          <Route path="/traces" element={<Traces />} />
          <Route path="/pi-sessions" element={<PiSessions />} />
          {/* Redirects for old routes */}
          <Route path="/channels" element={<Navigate to="/settings?tab=channels" replace />} />
          <Route path="/harnesses" element={<Navigate to="/settings" replace />} />
          <Route path="/memories" element={<Navigate to="/memory" replace />} />
          <Route path="/sessions/:id/settings" element={<SessionSettingsRedirect />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/** Redirect old /sessions/:id/settings to new unified settings with session pre-selected */
function SessionSettingsRedirect() {
  const location = useLocation();
  const match = location.pathname.match(/\/sessions\/(.+)\/settings/);
  const sessionId = match?.[1] || '';
  return <Navigate to={`/settings?tab=sessions&session=${encodeURIComponent(sessionId)}`} replace />;
}

export default App;

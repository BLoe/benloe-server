import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Calendar,
  TrendingUp,
  MessageSquare,
  Settings,
  Dumbbell,
  ExternalLink,
  Activity,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/schedule', icon: Calendar, label: 'Schedule' },
  { path: '/progress', icon: TrendingUp, label: 'Progress' },
  { path: '/chat', icon: MessageSquare, label: 'Coach' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

function NavItem({ path, icon: Icon, label, isMobile = false }: {
  path: string;
  icon: typeof LayoutDashboard;
  label: string;
  isMobile?: boolean;
}) {
  const location = useLocation();
  const isActive = location.pathname === path;

  if (isMobile) {
    return (
      <NavLink
        to={path}
        className={`flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-all ${
          isActive
            ? 'text-emerald-400'
            : 'text-slate-500 hover:text-slate-300'
        }`}
      >
        <div className={`relative ${isActive ? 'animate-pulse-glow rounded-full' : ''}`}>
          <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
        </div>
        <span className="text-[10px] font-medium">{label}</span>
      </NavLink>
    );
  }

  return (
    <NavLink
      to={path}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all group ${
        isActive
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
      }`}
    >
      <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
      <span className="font-medium text-sm">{label}</span>
      {isActive && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400" />
      )}
    </NavLink>
  );
}

export function Navigation() {
  const { user } = useAuthStore();

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-64 flex-col bg-slate-900/50 border-r border-slate-800/50 backdrop-blur-xl z-50">
        {/* Logo */}
        <div className="p-6 border-b border-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Activity size={22} className="text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="font-semibold text-white tracking-tight">Fitness</h1>
              <p className="text-xs text-slate-500">Executive Director</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <NavItem key={item.path} {...item} />
          ))}
        </nav>

        {/* External Links */}
        <div className="p-4 border-t border-slate-800/50">
          <a
            href="https://weights.benloe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 transition-all group"
          >
            <Dumbbell size={20} />
            <span className="font-medium text-sm">PR Tracker</span>
            <ExternalLink size={14} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        </div>

        {/* User */}
        <div className="p-4 border-t border-slate-800/50">
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-sm font-semibold text-white">
              {user?.name?.[0] || user?.email?.[0] || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.name || 'User'}
              </p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800/50 z-50 safe-bottom">
        <div className="flex items-center justify-around px-2 py-1">
          {navItems.map((item) => (
            <NavItem key={item.path} {...item} isMobile />
          ))}
        </div>
      </nav>
    </>
  );
}

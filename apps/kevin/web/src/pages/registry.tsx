// The pages that ship with the app. To add a built-in page: create
// src/pages/<Name>.tsx with a default export and add one line to `builtins`
// (and to BUILTIN_PAGES in server/src/domains/spaces.ts so Ben can hide it).
// Spaces are not listed here: they come from the server at runtime and are
// all rendered by pages/Space.tsx.
import { Apple, Briefcase, ChefHat, Dumbbell, FileText, Home, LayoutGrid, type LucideIcon, Receipt, Settings, Wallet } from 'lucide-react';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import HomePage from './Home';

export interface PageDef {
  path: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType | LazyExoticComponent<ComponentType>;
}

export const home: PageDef = { path: '/', label: 'Home', icon: Home, component: HomePage };

/** The built-in areas. Which of them show in the nav, and in what order, is the server's answer (lib/nav.ts). */
export const builtins: PageDef[] = [
  { path: '/pantry', label: 'Pantry', icon: Apple, component: lazy(() => import('./Pantry')) },
  { path: '/cooking', label: 'Cooking', icon: ChefHat, component: lazy(() => import('./Cooking')) },
  { path: '/workouts', label: 'Workouts', icon: Dumbbell, component: lazy(() => import('./Workouts')) },
  { path: '/money', label: 'Money', icon: Wallet, component: lazy(() => import('./Money')) },
  { path: '/taxes', label: 'Taxes', icon: Receipt, component: lazy(() => import('./Taxes')) },
  { path: '/documents', label: 'Documents', icon: FileText, component: lazy(() => import('./Documents')) },
];

/** Always in the nav, below everything else. */
export const systemPages: PageDef[] = [
  { path: '/spaces', label: 'All spaces', icon: LayoutGrid, component: lazy(() => import('./Spaces')) },
  { path: '/jobs', label: 'Jobs', icon: Briefcase, component: lazy(() => import('./Jobs')) },
  { path: '/settings', label: 'Settings', icon: Settings, component: lazy(() => import('./Settings')) },
];

export const SpacePage = lazy(() => import('./Space'));

export const pages: PageDef[] = [home, ...builtins, ...systemPages];
export const builtinIcon = (path: string): LucideIcon | undefined => builtins.find((b) => b.path === path)?.icon;

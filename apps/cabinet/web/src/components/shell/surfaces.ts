export type SurfaceId = 'today' | 'domains' | 'money' | 'ops' | 'brain' | 'chat' | 'credentials';

export interface SurfaceDef {
  id: SurfaceId;
  label: string;
  key: string; // rail hotkey hint
}

export const SURFACES: SurfaceDef[] = [
  { id: 'today', label: 'Today', key: '1' },
  { id: 'domains', label: 'Domains', key: '2' },
  // Money sits next to Domains rather than at the end: it's a reading
  // surface like Today/Domains, not an operational one like Ops/Brain.
  // 1-5 were already spoken for, so it takes 6.
  { id: 'money', label: 'Money', key: '6' },
  { id: 'ops', label: 'Ops', key: '3' },
  { id: 'brain', label: 'Brain', key: '4' },
  { id: 'chat', label: 'Chat', key: '5' },
  // Credentials sits last: it's a setup surface, visited when an integration
  // needs a key and essentially never otherwise. 1-6 were taken, so it takes 7.
  { id: 'credentials', label: 'Credentials', key: '7' },
];

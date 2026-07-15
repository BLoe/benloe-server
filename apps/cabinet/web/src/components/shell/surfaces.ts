export type SurfaceId = 'today' | 'domains' | 'ops' | 'brain' | 'chat';

export interface SurfaceDef {
  id: SurfaceId;
  label: string;
  key: string; // rail hotkey hint
}

export const SURFACES: SurfaceDef[] = [
  { id: 'today', label: 'Today', key: '1' },
  { id: 'domains', label: 'Domains', key: '2' },
  { id: 'ops', label: 'Ops', key: '3' },
  { id: 'brain', label: 'Brain', key: '4' },
  { id: 'chat', label: 'Chat', key: '5' },
];

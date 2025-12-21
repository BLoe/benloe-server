export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  timezone: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Game {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  duration?: number;
  complexity?: number;
  bggId?: number;
  imageUrl?: string;
  description?: string;
  bestWith?: string;
}

export interface Event {
  id: string;
  title?: string;
  dateTime: string;
  location?: string;
  description?: string;
  status: 'OPEN' | 'FULL' | 'CANCELLED' | 'COMPLETED';
  game: Game;
  gameId: string;
  creatorId: string;
  commitments: Commitment[];
  commitmentDeadline?: string;
  committedCount?: number;
  waitlistedCount?: number;
  spotsAvailable?: number;
  isFull?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Keep the old name as alias for backward compatibility
export type GameEvent = Event;

export interface Commitment {
  id: string;
  status: 'COMMITTED' | 'WAITLISTED' | 'DECLINED';
  joinedAt: string;
  notes?: string;
  userId: string;
}

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

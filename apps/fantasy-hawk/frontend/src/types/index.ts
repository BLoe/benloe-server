export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export type UserRole = 'user' | 'admin';

export interface OAuthStatus {
  connected: boolean;
  expiresAt?: number;
  role?: UserRole;
}

export interface FantasyLeague {
  league_key: string;
  name: string;
  season: string;
  num_teams: number;
}

export interface FantasyTeam {
  team_key: string;
  team_id: string;
  name: string;
  url: string;
  team_logos?: Array<{
    url: string;
  }>;
  managers?: Array<{
    nickname: string;
  }>;
}

export interface Player {
  player_key: string;
  player_id: string;
  name: {
    full: string;
  };
  position_type: string;
  primary_position: string;
  stats?: PlayerStats[];
}

export interface PlayerStats {
  stat_id: string;
  value: string;
}

export interface Standing {
  team_key: string;
  team: FantasyTeam;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
}

export interface Matchup {
  week: string;
  teams: Array<{
    team_key: string;
    points: number;
  }>;
}

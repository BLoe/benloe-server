// Yahoo Fantasy API Types
// These are partial types for common response structures

export interface YahooFantasyResponse {
  fantasy_content: Record<string, unknown>;
}

export interface YahooGame {
  game_key: string;
  game_id: string;
  name: string;
  code: string;
  type: string;
  url: string;
  season: string;
  is_game_over: number;
  is_offseason: number;
}

export interface YahooLeague {
  league_key: string;
  league_id: string;
  name: string;
  url: string;
  logo_url?: string;
  draft_status: string;
  num_teams: number;
  edit_key: string;
  weekly_deadline: string;
  league_update_timestamp: string;
  scoring_type: string;
  league_type: string;
  renew: string;
  renewed: string;
  iris_group_chat_id: string;
  short_invitation_url: string;
  allow_add_to_dl_extra_pos: number;
  is_pro_league: string;
  is_cash_league: string;
  current_week: string;
  start_week: string;
  start_date: string;
  end_week: string;
  end_date: string;
  game_code: string;
  season: string;
}

export interface YahooTeam {
  team_key: string;
  team_id: string;
  name: string;
  is_owned_by_current_login: number;
  url: string;
  team_logos: {
    team_logo: {
      size: string;
      url: string;
    };
  };
  waiver_priority: number;
  number_of_moves: number;
  number_of_trades: number;
  roster_adds: {
    coverage_type: string;
    coverage_value: number;
    value: number;
  };
  clinched_playoffs: number;
  league_scoring_type: string;
  has_draft_grade: number;
  managers: YahooManager[];
}

export interface YahooManager {
  manager_id: string;
  nickname: string;
  guid: string;
  is_commissioner: string;
  is_current_login: string;
  email: string;
  image_url: string;
}

export interface YahooPlayer {
  player_key: string;
  player_id: string;
  name: {
    full: string;
    first: string;
    last: string;
    ascii_first: string;
    ascii_last: string;
  };
  editorial_player_key: string;
  editorial_team_key: string;
  editorial_team_full_name: string;
  editorial_team_abbr: string;
  uniform_number: string;
  display_position: string;
  headshot: {
    url: string;
    size: string;
  };
  image_url: string;
  is_undroppable: string;
  position_type: string;
  primary_position: string;
  eligible_positions: string[];
  has_player_notes: number;
  player_notes_last_timestamp: number;
}

export interface YahooMatchup {
  week: string;
  week_start: string;
  week_end: string;
  status: string;
  is_playoffs: string;
  is_consolation: string;
  is_matchup_recap_available: number;
  teams: YahooTeam[];
}

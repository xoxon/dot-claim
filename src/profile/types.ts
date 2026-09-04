export type League = {
  name: 'Bronz' | 'Gümüş' | 'Altın' | 'Elmas';
  color: string;
  minimum: number;
};

export type PlayerProfile = {
  id: string;
  displayName: string;
  canChangeDisplayName: boolean;
  avatarUrl: string | null;
  trophies: number;
  coins: number;
  xp: number;
  level: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  winStreak: number;
  bestWinStreak: number;
  league: League;
};

export type MatchReward = {
  trophyDelta: number;
  coinDelta: number;
  xpDelta: number;
  streakBonus: number;
  nextStreak: number;
};

export type LeaderboardEntry = PlayerProfile & {
  rank: number;
};

export type MatchHistoryItem = {
  id: string;
  difficulty: 'easy' | 'normal' | 'hard';
  score: { you: number; opponent: number };
  outcome: 'win' | 'loss' | 'draw';
  reason: 'completed' | 'forfeit';
  opponent: Pick<PlayerProfile, 'displayName' | 'avatarUrl'>;
  rewards: MatchReward | null;
  endedAt: string;
};

export type Difficulty = 'easy' | 'normal' | 'hard';

export type Dot = {
  id: string;
  x: number;
  y: number;
  color: string;
};

export type Edge = {
  id: string;
  a: string;
  b: string;
  owner: 'player' | 'rival';
};

export type Triangle = {
  id: string;
  dots: [string, string, string];
  owner: 'player' | 'rival';
};

export type GameState = {
  level: number;
  difficulty: Difficulty;
  dots: Dot[];
  edges: Edge[];
  triangles: Triangle[];
  turn: 'player' | 'rival';
  selectedDotId: string | null;
  playerScore: number;
  rivalScore: number;
  moveNumber: number;
  maxMoves: number;
  isComplete: boolean;
  isDaily: boolean;
};

export type PlayerStats = {
  completedLevels: number[];
  starsByLevel: Record<string, number>;
  wins: number;
  losses: number;
  dailyStreak: number;
  lastDailyDate: string | null;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  soundSettingsVersion: number;
};

export const DEFAULT_STATS: PlayerStats = {
  completedLevels: [],
  starsByLevel: {},
  wins: 0,
  losses: 0,
  dailyStreak: 0,
  lastDailyDate: null,
  soundEnabled: true,
  hapticsEnabled: true,
  soundSettingsVersion: 1,
};

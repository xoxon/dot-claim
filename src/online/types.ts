import type { Difficulty, Dot } from '../game/types';
import type { MatchReward, PlayerProfile } from '../profile/types';

export type MatchColor = 'blue' | 'red';
export type OnlineMode = 'classic' | 'dice';

export type OnlineEdge = {
  id: string;
  a: string;
  b: string;
  owner: MatchColor;
};

export type OnlineTriangle = {
  id: string;
  dots: [string, string, string];
  owner: MatchColor;
};

export type OnlineMatchState = {
  roomId: string;
  mode: OnlineMode;
  difficulty: Difficulty;
  dots: Dot[];
  edges: OnlineEdge[];
  triangles: OnlineTriangle[];
  scores: Record<MatchColor, number>;
  turn: MatchColor;
  diceValue: number | null;
  movesRemaining: number;
  moveNumber: number;
  maxMoves: number;
  started: boolean;
  ready: Record<MatchColor, boolean>;
  isComplete: boolean;
  players: Record<MatchColor, PlayerProfile>;
};

export type OnlineMatchResult = {
  roomId: string;
  mode: OnlineMode;
  scores: Record<MatchColor, number>;
  winner: MatchColor | 'draw';
  reason: 'completed' | 'forfeit';
  rewards: Record<MatchColor, MatchReward | null>;
  players: Record<MatchColor, PlayerProfile>;
};

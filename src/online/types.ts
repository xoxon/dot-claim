import type { Difficulty, Dot } from '../game/types';

export type MatchColor = 'blue' | 'red';

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
  difficulty: Difficulty;
  dots: Dot[];
  edges: OnlineEdge[];
  triangles: OnlineTriangle[];
  scores: Record<MatchColor, number>;
  turn: MatchColor;
  moveNumber: number;
  maxMoves: number;
  isComplete: boolean;
};

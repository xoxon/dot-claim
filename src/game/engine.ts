import { getMaxMoves, makeDots } from './levels';
import type { Difficulty, Dot, Edge, GameState, Triangle } from './types';

export const PLAYER_COLOR = '#58C7FF';
export const RIVAL_COLOR = '#FF6680';

export function createGame(level: number, difficulty: Difficulty, isDaily = false): GameState {
  return {
    level,
    difficulty,
    dots: makeDots(level, isDaily),
    edges: [],
    triangles: [],
    turn: 'player',
    selectedDotId: null,
    playerScore: 0,
    rivalScore: 0,
    moveNumber: 0,
    maxMoves: getMaxMoves(level, difficulty, isDaily),
    isComplete: false,
    isDaily,
  };
}

export function edgeKey(a: string, b: string): string {
  return [a, b].sort().join('--');
}

export function triangleKey(ids: string[]): string {
  return [...ids].sort().join('--');
}

export function canConnect(state: GameState, a: string, b: string): boolean {
  if (a === b || state.isComplete) return false;
  if (state.edges.some((edge) => edge.id === edgeKey(a, b))) return false;
  return !wouldPassThroughDot(state.dots, a, b);
}

export function playMove(state: GameState, a: string, b: string, owner: 'player' | 'rival'): GameState {
  if (!canConnect(state, a, b)) return state;
  const edge: Edge = { id: edgeKey(a, b), a, b, owner };
  const nextEdges = [...state.edges, edge];
  const claimed = findNewTriangles(state.dots, nextEdges, state.triangles, owner);
  const playerScore = state.playerScore + (owner === 'player' ? claimed.length : 0);
  const rivalScore = state.rivalScore + (owner === 'rival' ? claimed.length : 0);
  const moveNumber = state.moveNumber + 1;
  const isComplete = moveNumber >= state.maxMoves || legalMoves({ ...state, edges: nextEdges, isComplete: false }).length === 0;
  return {
    ...state,
    edges: nextEdges,
    triangles: [...state.triangles, ...claimed],
    playerScore,
    rivalScore,
    moveNumber,
    selectedDotId: null,
    turn: isComplete ? owner : owner === 'player' ? 'rival' : 'player',
    isComplete,
  };
}

export function legalMoves(state: GameState): Array<[string, string]> {
  const moves: Array<[string, string]> = [];
  for (let first = 0; first < state.dots.length; first += 1) {
    for (let second = first + 1; second < state.dots.length; second += 1) {
      const a = state.dots[first]?.id;
      const b = state.dots[second]?.id;
      if (a && b && canConnect(state, a, b)) moves.push([a, b]);
    }
  }
  return moves;
}

export function pickRivalMove(state: GameState): [string, string] | null {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  const scored = moves.map(([a, b]) => {
    const after = playMove({ ...state, isComplete: false }, a, b, 'rival');
    const gain = after.rivalScore - state.rivalScore;
    const centerBias = centrality(state.dots, a, b);
    const playerReplyGain = after.isComplete
      ? 0
      : legalMoves(after).reduce((best, [replyA, replyB]) => {
        const reply = playMove({ ...after, turn: 'player', isComplete: false }, replyA, replyB, 'player');
        return Math.max(best, reply.playerScore - after.playerScore);
      }, 0);
    return { move: [a, b] as [string, string], gain, centerBias, playerReplyGain, entropy: seededNoise(state.moveNumber, a, b) };
  });
  if (state.difficulty === 'easy') {
    scored.sort((left, right) => left.entropy - right.entropy);
  } else if (state.difficulty === 'normal') {
    scored.sort((left, right) => right.gain - left.gain || right.centerBias - left.centerBias || left.entropy - right.entropy);
  } else {
    scored.sort((left, right) => right.gain - left.gain || left.playerReplyGain - right.playerReplyGain || right.centerBias - left.centerBias || left.entropy - right.entropy);
  }
  return scored[0]?.move ?? null;
}

function findNewTriangles(dots: Dot[], edges: Edge[], existing: Triangle[], owner: 'player' | 'rival'): Triangle[] {
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const existingIds = new Set(existing.map((triangle) => triangle.id));
  const triangles: Triangle[] = [];
  for (let i = 0; i < dots.length; i += 1) {
    for (let j = i + 1; j < dots.length; j += 1) {
      for (let k = j + 1; k < dots.length; k += 1) {
        const a = dots[i]?.id;
        const b = dots[j]?.id;
        const c = dots[k]?.id;
        if (!a || !b || !c) continue;
        const id = triangleKey([a, b, c]);
        if (existingIds.has(id)) continue;
        if (edgeIds.has(edgeKey(a, b)) && edgeIds.has(edgeKey(a, c)) && edgeIds.has(edgeKey(b, c))) {
          triangles.push({ id, dots: [a, b, c], owner });
        }
      }
    }
  }
  return triangles;
}

function wouldPassThroughDot(dots: Dot[], aId: string, bId: string): boolean {
  const a = dots.find((dot) => dot.id === aId);
  const b = dots.find((dot) => dot.id === bId);
  if (!a || !b) return true;
  return dots.some((dot) => {
    if (dot.id === aId || dot.id === bId) return false;
    const cross = (b.x - a.x) * (dot.y - a.y) - (b.y - a.y) * (dot.x - a.x);
    if (Math.abs(cross) > 0.65) return false;
    const dotProduct = (dot.x - a.x) * (dot.x - b.x) + (dot.y - a.y) * (dot.y - b.y);
    return dotProduct < 0;
  });
}

function centrality(dots: Dot[], aId: string, bId: string): number {
  const a = dots.find((dot) => dot.id === aId);
  const b = dots.find((dot) => dot.id === bId);
  if (!a || !b) return 0;
  const midpointX = (a.x + b.x) / 2;
  const midpointY = (a.y + b.y) / 2;
  return 100 - Math.hypot(midpointX - 50, midpointY - 50);
}

function seededNoise(move: number, a: string, b: string): number {
  const text = `${move}-${a}-${b}`;
  return [...text].reduce((result, char) => (result * 31 + char.charCodeAt(0)) % 997, 7);
}

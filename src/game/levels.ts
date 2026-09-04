import type { Difficulty, Dot } from './types';

const COLORS = ['#FF5D73', '#FFC857', '#3DD6B8', '#59B7FF', '#B27BFF', '#FF8C5A', '#F273D4'];

const LEVEL_LAYOUTS: Array<Array<[number, number]>> = [
  [[16, 20], [50, 12], [84, 23], [26, 50], [65, 48], [16, 80], [50, 86], [85, 75]],
  [[14, 25], [40, 12], [72, 15], [88, 42], [62, 53], [34, 46], [14, 72], [42, 86], [78, 80]],
  [[12, 18], [45, 12], [80, 18], [24, 39], [58, 38], [88, 48], [14, 74], [48, 86], [76, 78]],
  [[18, 14], [55, 12], [84, 28], [34, 34], [66, 45], [12, 56], [36, 78], [70, 82], [88, 67]],
  [[12, 24], [35, 11], [63, 17], [88, 12], [22, 46], [49, 39], [76, 47], [13, 78], [44, 85], [72, 77]],
  [[20, 14], [49, 21], [78, 14], [12, 40], [35, 52], [65, 44], [88, 55], [23, 81], [54, 73], [78, 85]],
  [[12, 16], [39, 13], [67, 21], [89, 15], [24, 42], [50, 51], [79, 43], [13, 75], [38, 84], [67, 77], [88, 83]],
  [[17, 12], [50, 15], [83, 13], [11, 42], [31, 46], [61, 39], [89, 48], [18, 77], [48, 81], [77, 75]],
];

export function makeDots(level: number, isDaily = false): Dot[] {
  const layout = LEVEL_LAYOUTS[(isDaily ? dailyIndex() : Math.max(0, level - 1)) % LEVEL_LAYOUTS.length] ?? LEVEL_LAYOUTS[0]!;
  return layout.map(([x, y], index) => ({
    id: `dot-${index}`,
    x,
    y,
    color: COLORS[(index + level + (isDaily ? dailyIndex() : 0)) % COLORS.length]!,
  }));
}

export function getMaxMoves(level: number, difficulty: Difficulty, isDaily = false): number {
  const base = isDaily ? 18 : 12 + Math.min(level, 8);
  return base + (difficulty === 'easy' ? 2 : difficulty === 'hard' ? -2 : 0);
}

export function getLevelLabel(level: number, isDaily: boolean): string {
  return isDaily ? 'Günlük meydan okuma' : `Seviye ${level}`;
}

function dailyIndex(): number {
  const today = new Date();
  const stamp = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  return [...stamp].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

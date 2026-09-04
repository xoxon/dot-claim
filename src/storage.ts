import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_STATS, type PlayerStats } from './game/types';

const STATS_KEY = '@dot-claim/stats-v1';

export async function loadStats(): Promise<PlayerStats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return DEFAULT_STATS;
    const parsed = JSON.parse(raw) as Partial<PlayerStats>;
    // Before 1.1 sound effects did not exist. Enable them once for existing players,
    // while preserving any preference they set after this release.
    return {
      ...DEFAULT_STATS,
      ...parsed,
      soundEnabled: parsed.soundSettingsVersion === 1 ? Boolean(parsed.soundEnabled) : true,
      soundSettingsVersion: 1,
    };
  } catch {
    return DEFAULT_STATS;
  }
}

export async function saveStats(stats: PlayerStats): Promise<void> {
  try {
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // Progress storage is intentionally non-blocking; the game remains playable if disk storage is unavailable.
  }
}

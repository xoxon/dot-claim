import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { DirectMessage, FriendInvite, FriendsPayload, LeaderboardEntry, MatchHistoryItem, PlayerProfile } from './types';

export const MATCH_SERVER_URL = (process.env.EXPO_PUBLIC_MATCH_SERVER_URL ?? (__DEV__ ? 'http://127.0.0.1:3001' : '')).replace(/\/$/, '');

const TOKEN_KEY = 'dot-claim.auth-token-v1';
const DEVICE_KEY = 'dot-claim.device-id-v1';

type ApiFailure = Error & { status?: number };

function endpoint(path: string) {
  if (!MATCH_SERVER_URL) throw new Error('Çevrimiçi sunucu adresi ayarlanmamış.');
  return `${MATCH_SERVER_URL}${path}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    const error = new Error(body.error ?? 'Sunucu isteği tamamlanamadı.') as ApiFailure;
    error.status = response.status;
    throw error;
  }
  return body;
}

async function getDeviceId() {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_KEY, id);
  return id;
}

export async function loadAuthenticatedProfile(): Promise<{ token: string; profile: PlayerProfile }> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    try {
      const response = await fetch(endpoint('/v1/me'), { headers: { Authorization: `Bearer ${token}` } });
      const body = await parseResponse<{ profile: PlayerProfile }>(response);
      return { token, profile: body.profile };
    } catch (error) {
      if ((error as ApiFailure).status !== 401) throw error;
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
  }
  const response = await fetch(endpoint('/v1/auth/guest'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: await getDeviceId() }),
  });
  const body = await parseResponse<{ token: string; profile: PlayerProfile }>(response);
  await SecureStore.setItemAsync(TOKEN_KEY, body.token);
  return body;
}

export async function updateDisplayName(token: string, displayName: string) {
  const response = await fetch(endpoint('/v1/me'), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  return (await parseResponse<{ profile: PlayerProfile }>(response)).profile;
}

export async function uploadAvatar(token: string, base64: string) {
  const response = await fetch(endpoint('/v1/me/avatar'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64 }),
  });
  return (await parseResponse<{ profile: PlayerProfile }>(response)).profile;
}

export async function deleteAccount(token: string) {
  const response = await fetch(endpoint('/v1/me'), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Hesap silinemedi.');
  }
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(DEVICE_KEY),
  ]);
}

export async function fetchLeaderboard() {
  const response = await fetch(endpoint('/v1/leaderboard?limit=20'));
  return (await parseResponse<{ leaderboard: LeaderboardEntry[] }>(response)).leaderboard;
}

export async function fetchMatchHistory(token: string) {
  const response = await fetch(endpoint('/v1/me/matches?limit=8'), { headers: { Authorization: `Bearer ${token}` } });
  return (await parseResponse<{ matches: MatchHistoryItem[] }>(response)).matches;
}

export async function searchPlayers(token: string, query: string) {
  const response = await fetch(endpoint(`/v1/users/search?q=${encodeURIComponent(query)}`), { headers: { Authorization: `Bearer ${token}` } });
  return (await parseResponse<{ users: PlayerProfile[] }>(response)).users;
}

export async function fetchFriends(token: string) {
  const response = await fetch(endpoint('/v1/me/friends'), { headers: { Authorization: `Bearer ${token}` } });
  return await parseResponse<FriendsPayload>(response);
}

export async function sendFriendRequest(token: string, userId: string) {
  const response = await fetch(endpoint('/v1/me/friend-requests'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  return await parseResponse<{ state: 'pending' | 'accepted'; friend: PlayerProfile }>(response);
}

export async function respondToFriendRequest(token: string, requesterId: string, action: 'accept' | 'decline') {
  const response = await fetch(endpoint(`/v1/me/friend-requests/${encodeURIComponent(requesterId)}/${action}`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return await parseResponse<{ state: 'accepted' | 'declined'; friend?: PlayerProfile }>(response);
}

export async function createFriendInvite(token: string, friendId: string, mode: FriendInvite['mode'], difficulty: FriendInvite['difficulty']) {
  const response = await fetch(endpoint(`/v1/me/friends/${encodeURIComponent(friendId)}/invites`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, difficulty }),
  });
  return (await parseResponse<{ invite: FriendInvite }>(response)).invite;
}

export async function acceptFriendInvite(token: string, inviteId: string) {
  const response = await fetch(endpoint(`/v1/me/invites/${encodeURIComponent(inviteId)}/accept`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await parseResponse<{ invite: FriendInvite }>(response)).invite;
}

export async function fetchDirectMessages(token: string, friendId: string) {
  const response = await fetch(endpoint(`/v1/me/friends/${encodeURIComponent(friendId)}/messages?limit=50`), { headers: { Authorization: `Bearer ${token}` } });
  return (await parseResponse<{ messages: DirectMessage[] }>(response)).messages;
}

export async function sendDirectMessage(token: string, friendId: string, body: string) {
  const response = await fetch(endpoint(`/v1/me/friends/${encodeURIComponent(friendId)}/messages`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return (await parseResponse<{ message: DirectMessage }>(response)).message;
}

export function resolveAvatarUrl(url: string | null) {
  if (!url || url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${MATCH_SERVER_URL}${url}`;
}

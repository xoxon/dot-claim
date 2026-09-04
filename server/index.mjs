import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import { Server } from 'socket.io';

const SERVER_DIRECTORY = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(SERVER_DIRECTORY, '.env'), quiet: true });

const PORT = Number(process.env.PORT ?? 3001);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? ['*'];
const DATA_DIRECTORY = resolve(process.env.DATA_DIRECTORY ?? join(SERVER_DIRECTORY, 'data'));
const AVATAR_DIRECTORY = resolve(process.env.AVATAR_DIRECTORY ?? join(SERVER_DIRECTORY, 'uploads', 'avatars'));
const DATABASE_PATH = resolve(process.env.DATABASE_PATH ?? join(DATA_DIRECTORY, 'dot-claim.sqlite'));
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
const MAX_AVATAR_BYTES = Number(process.env.MAX_AVATAR_BYTES ?? 900_000);

mkdirSync(DATA_DIRECTORY, { recursive: true });
mkdirSync(AVATAR_DIRECTORY, { recursive: true });

const database = new Database(DATABASE_PATH);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name_locked INTEGER NOT NULL DEFAULT 0,
    avatar_path TEXT,
    avatar_version INTEGER NOT NULL DEFAULT 0,
    trophies INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    win_streak INTEGER NOT NULL DEFAULT 0,
    best_win_streak INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    difficulty TEXT NOT NULL,
    blue_user_id TEXT NOT NULL REFERENCES users(id),
    red_user_id TEXT NOT NULL REFERENCES users(id),
    blue_score INTEGER NOT NULL,
    red_score INTEGER NOT NULL,
    winner TEXT NOT NULL,
    reason TEXT NOT NULL,
    rewards_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS matches_blue_user_idx ON matches(blue_user_id, ended_at DESC);
  CREATE INDEX IF NOT EXISTS matches_red_user_idx ON matches(red_user_id, ended_at DESC);
  CREATE INDEX IF NOT EXISTS users_leaderboard_idx ON users(trophies DESC, xp DESC, wins DESC);
`);

const userColumns = database.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((column) => column.name === 'display_name_locked')) {
  database.exec('ALTER TABLE users ADD COLUMN display_name_locked INTEGER NOT NULL DEFAULT 0');
  database.prepare("UPDATE users SET display_name_locked = 1 WHERE display_name NOT GLOB 'Oyuncu [0-9][0-9][0-9][0-9]'").run();
}

const waiting = new Map();
const rooms = new Map();
const socketRoom = new Map();
const rateBuckets = new Map();
const DOT_COLORS = ['#FF5D73', '#FFC857', '#3DD6B8', '#59B7FF', '#B27BFF', '#FF8C5A', '#F273D4'];
const LAYOUTS = [
  [[16, 20], [50, 12], [84, 23], [26, 50], [65, 48], [16, 80], [50, 86], [85, 75]],
  [[14, 25], [40, 12], [72, 15], [88, 42], [62, 53], [34, 46], [14, 72], [42, 86], [78, 80]],
  [[12, 18], [45, 12], [80, 18], [24, 39], [58, 38], [88, 48], [14, 74], [48, 86], [76, 78]],
];
const LEAGUES = [
  { name: 'Elmas', minimum: 1000, color: '#BFEFFF' },
  { name: 'Altın', minimum: 650, color: '#FFC857' },
  { name: 'Gümüş', minimum: 300, color: '#C6D3DF' },
  { name: 'Bronz', minimum: 0, color: '#D89461' },
];

function now() {
  return new Date().toISOString();
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function makeToken() {
  return randomBytes(32).toString('base64url');
}

function getLeague(trophies) {
  return LEAGUES.find((league) => trophies >= league.minimum) ?? LEAGUES.at(-1);
}

function avatarUrl(user) {
  return user.avatar_path ? `${PUBLIC_BASE_URL}${user.avatar_path}?v=${user.avatar_version}` : null;
}

function publicUser(user) {
  const league = getLeague(user.trophies);
  return {
    id: user.id,
    displayName: user.display_name,
    canChangeDisplayName: !Boolean(user.display_name_locked),
    avatarUrl: avatarUrl(user),
    trophies: user.trophies,
    coins: user.coins,
    xp: user.xp,
    level: Math.max(1, Math.floor(user.xp / 500) + 1),
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    gamesPlayed: user.games_played,
    winStreak: user.win_streak,
    bestWinStreak: user.best_win_streak,
    league: { name: league.name, color: league.color, minimum: league.minimum },
  };
}

function getUserById(id) {
  return database.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashToken(token);
  const row = database.prepare(`
    SELECT users.* FROM auth_tokens
    INNER JOIN users ON users.id = auth_tokens.user_id
    WHERE auth_tokens.token_hash = ?
  `).get(tokenHash);
  if (row) database.prepare('UPDATE auth_tokens SET last_used_at = ? WHERE token_hash = ?').run(now(), tokenHash);
  return row ?? null;
}

function tokenFromRequest(request) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;
}

function normalizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 18 || !/^[\p{L}\p{N} _.\-]+$/u.test(name)) return null;
  return name;
}

function createAvailableDisplayName() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const name = `Oyuncu ${Math.floor(1000 + Math.random() * 9000)}`;
    if (!database.prepare('SELECT id FROM users WHERE display_name = ?').get(name)) return name;
  }
  return `Oyuncu ${randomUUID().slice(0, 8)}`;
}

function edgeKey(a, b) {
  return [a, b].sort().join('--');
}

function triangleKey(ids) {
  return [...ids].sort().join('--');
}

function makeDots(seed) {
  const layout = LAYOUTS[seed % LAYOUTS.length];
  return layout.map(([x, y], index) => ({ id: `dot-${index}`, x, y, color: DOT_COLORS[(index + seed) % DOT_COLORS.length] }));
}

function createMatch(difficulty, blueSocket, redSocket) {
  const seed = Math.floor(Math.random() * 1_000_000);
  const blueUser = getUserById(blueSocket.data.userId);
  const redUser = getUserById(redSocket.data.userId);
  return {
    id: randomUUID(),
    difficulty,
    dots: makeDots(seed),
    edges: [],
    triangles: [],
    scores: { blue: 0, red: 0 },
    turn: 'blue',
    moveNumber: 0,
    maxMoves: difficulty === 'easy' ? 16 : difficulty === 'hard' ? 12 : 14,
    started: false,
    ready: { blue: false, red: false },
    isComplete: false,
    finalized: false,
    startedAt: now(),
    players: {
      blue: { socketId: blueSocket.id, userId: blueSocket.data.userId, profile: publicUser(blueUser) },
      red: { socketId: redSocket.id, userId: redSocket.data.userId, profile: publicUser(redUser) },
    },
  };
}

function canConnect(state, aId, bId) {
  if (state.isComplete || aId === bId || typeof aId !== 'string' || typeof bId !== 'string') return false;
  if (!state.dots.some((dot) => dot.id === aId) || !state.dots.some((dot) => dot.id === bId)) return false;
  if (state.edges.some((edge) => edge.id === edgeKey(aId, bId))) return false;
  const a = state.dots.find((dot) => dot.id === aId);
  const b = state.dots.find((dot) => dot.id === bId);
  return !state.dots.some((dot) => {
    if (dot.id === aId || dot.id === bId) return false;
    const cross = (b.x - a.x) * (dot.y - a.y) - (b.y - a.y) * (dot.x - a.x);
    if (Math.abs(cross) > 0.65) return false;
    return (dot.x - a.x) * (dot.x - b.x) + (dot.y - a.y) * (dot.y - b.y) < 0;
  });
}

function findNewTriangles(state, owner) {
  const edgeIds = new Set(state.edges.map((edge) => edge.id));
  const existing = new Set(state.triangles.map((triangle) => triangle.id));
  const additions = [];
  for (let i = 0; i < state.dots.length; i += 1) {
    for (let j = i + 1; j < state.dots.length; j += 1) {
      for (let k = j + 1; k < state.dots.length; k += 1) {
        const ids = [state.dots[i].id, state.dots[j].id, state.dots[k].id];
        const id = triangleKey(ids);
        if (existing.has(id)) continue;
        if (edgeIds.has(edgeKey(ids[0], ids[1])) && edgeIds.has(edgeKey(ids[0], ids[2])) && edgeIds.has(edgeKey(ids[1], ids[2]))) additions.push({ id, dots: ids, owner });
      }
    }
  }
  return additions;
}

function legalMoveCount(state) {
  let count = 0;
  for (let first = 0; first < state.dots.length; first += 1) {
    for (let second = first + 1; second < state.dots.length; second += 1) {
      if (canConnect(state, state.dots[first].id, state.dots[second].id)) count += 1;
    }
  }
  return count;
}

function makeMove(state, a, b, owner) {
  state.edges.push({ id: edgeKey(a, b), a, b, owner });
  const claimed = findNewTriangles(state, owner);
  state.triangles.push(...claimed);
  state.scores[owner] += claimed.length;
  state.moveNumber += 1;
  state.isComplete = state.moveNumber >= state.maxMoves || legalMoveCount(state) === 0;
  if (!state.isComplete) state.turn = owner === 'blue' ? 'red' : 'blue';
}

function publicState(room) {
  return {
    roomId: room.id,
    difficulty: room.difficulty,
    dots: room.dots,
    edges: room.edges,
    triangles: room.triangles,
    scores: room.scores,
    turn: room.turn,
    moveNumber: room.moveNumber,
    maxMoves: room.maxMoves,
    started: room.started,
    ready: room.ready,
    isComplete: room.isComplete,
    players: { blue: room.players.blue.profile, red: room.players.red.profile },
  };
}

function roleFor(room, socketId) {
  if (room.players.blue.socketId === socketId) return 'blue';
  if (room.players.red.socketId === socketId) return 'red';
  return null;
}

function leaveWaiting(socketId) {
  for (const [difficulty, queue] of waiting) {
    const next = queue.filter((id) => id !== socketId);
    if (next.length) waiting.set(difficulty, next);
    else waiting.delete(difficulty);
  }
}

function rewardsFor(user, outcome) {
  const nextStreak = outcome === 'win' ? user.win_streak + 1 : 0;
  const streakBonus = outcome === 'win' && nextStreak > 0 && nextStreak % 3 === 0 ? 30 : 0;
  const base = outcome === 'win'
    ? { trophyDelta: 25, coinDelta: 50, xpDelta: 100 }
    : outcome === 'draw'
      ? { trophyDelta: 8, coinDelta: 20, xpDelta: 50 }
      : { trophyDelta: -12, coinDelta: 0, xpDelta: 20 };
  return { ...base, coinDelta: base.coinDelta + streakBonus, streakBonus, nextStreak };
}

function applyProgress(user, outcome) {
  const reward = rewardsFor(user, outcome);
  const updated = {
    ...user,
    trophies: Math.max(0, user.trophies + reward.trophyDelta),
    coins: user.coins + reward.coinDelta,
    xp: user.xp + reward.xpDelta,
    wins: user.wins + (outcome === 'win' ? 1 : 0),
    losses: user.losses + (outcome === 'loss' ? 1 : 0),
    draws: user.draws + (outcome === 'draw' ? 1 : 0),
    games_played: user.games_played + 1,
    win_streak: reward.nextStreak,
    best_win_streak: Math.max(user.best_win_streak, reward.nextStreak),
    updated_at: now(),
  };
  database.prepare(`
    UPDATE users SET trophies = ?, coins = ?, xp = ?, wins = ?, losses = ?, draws = ?, games_played = ?,
    win_streak = ?, best_win_streak = ?, updated_at = ? WHERE id = ?
  `).run(updated.trophies, updated.coins, updated.xp, updated.wins, updated.losses, updated.draws, updated.games_played, updated.win_streak, updated.best_win_streak, updated.updated_at, updated.id);
  return { reward, profile: getUserById(updated.id) };
}

function persistMatchResult(room, winner, reason) {
  const blue = getUserById(room.players.blue.userId);
  const red = getUserById(room.players.red.userId);
  const blueOutcome = winner === 'blue' ? 'win' : winner === 'red' ? 'loss' : 'draw';
  const redOutcome = winner === 'red' ? 'win' : winner === 'blue' ? 'loss' : 'draw';
  database.exec('BEGIN IMMEDIATE');
  try {
    const blueProgress = applyProgress(blue, blueOutcome);
    const redProgress = applyProgress(red, redOutcome);
    const rewards = { blue: blueProgress.reward, red: redProgress.reward };
    database.prepare(`
      INSERT INTO matches (id, difficulty, blue_user_id, red_user_id, blue_score, red_score, winner, reason, rewards_json, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(room.id, room.difficulty, blue.id, red.id, room.scores.blue, room.scores.red, winner, reason, JSON.stringify(rewards), room.startedAt, now());
    database.exec('COMMIT');
    return { rewards, profiles: { blue: publicUser(blueProgress.profile), red: publicUser(redProgress.profile) } };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function removeRoom(room) {
  rooms.delete(room.id);
  socketRoom.delete(room.players.blue.socketId);
  socketRoom.delete(room.players.red.socketId);
}

function cancelUnstartedRoom(room) {
  if (room.started || room.finalized) return;
  room.finalized = true;
  io.to(room.id).emit('opponent_left', { beforeStart: true });
  removeRoom(room);
}

function finishRoom(room, { reason = 'completed', winnerOverride = null } = {}) {
  if (room.finalized) return;
  room.finalized = true;
  const winner = winnerOverride ?? (room.scores.blue === room.scores.red ? 'draw' : room.scores.blue > room.scores.red ? 'blue' : 'red');
  let persisted;
  try {
    persisted = persistMatchResult(room, winner, reason);
    room.players.blue.profile = persisted.profiles.blue;
    room.players.red.profile = persisted.profiles.red;
  } catch (error) {
    console.error('Unable to persist match result', error);
    persisted = { rewards: { blue: null, red: null }, profiles: { blue: room.players.blue.profile, red: room.players.red.profile } };
  }
  io.to(room.id).emit('match_complete', {
    roomId: room.id,
    scores: room.scores,
    winner,
    reason,
    rewards: persisted.rewards,
    players: persisted.profiles,
  });
  const cleanup = setTimeout(() => removeRoom(room), 60_000);
  cleanup.unref();
}

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  return origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function applyCors(request, response) {
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin(request));
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
}

function sendJson(request, response, status, payload) {
  applyCors(request, response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, title, body) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(`<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Dot Claim destek ve gizlilik bilgileri" />
    <title>${title} · Dot Claim</title>
    <style>
      :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #07111f; color: #eaf3fa; line-height: 1.6; }
      main { max-width: 760px; margin: 0 auto; padding: 48px 24px 64px; }
      .brand { color: #58c7ff; font-size: .78rem; font-weight: 900; letter-spacing: .2em; }
      h1 { font-size: clamp(2rem, 8vw, 3rem); line-height: 1.05; margin: .5rem 0 1.2rem; }
      h2 { margin-top: 2.2rem; color: #f7fbff; font-size: 1.25rem; }
      p, li { color: #bfd0df; }
      a { color: #72d3ff; }
      .card { padding: 20px; border: 1px solid #285473; border-radius: 18px; background: #102b43; }
      .muted { color: #8ea6ba; font-size: .9rem; }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`);
}

function supportPage(response) {
  return sendHtml(response, 200, 'Destek', `
    <div class="brand">DOT CLAIM</div>
    <h1>Destek</h1>
    <div class="card"><strong>Dot Claim</strong>, noktaları birleştirip üçgen alanları sahiplenmeye dayalı çevrimiçi bir strateji oyunudur.</div>
    <h2>Sık sorulanlar</h2>
    <p><strong>Çevrimiçi oyun nasıl başlar?</strong><br />Ana ekrandan “Çevrimiçi rakip ara”yı seçin. Bir rakiple eşleştiğinizde iki oyuncu da “Oyuna başla” düğmesine dokunur.</p>
    <p><strong>Profilim ve ilerlemem nerede?</strong><br />Kullanıcı adı, avatar, kupa, XP ve çevrimiçi maç sonuçları eşleşme sunucusunda saklanır. Ayrıntılar için <a href="/privacy">Gizlilik Politikası</a> sayfasını okuyun.</p>
    <p><strong>Hesabımı nasıl silerim?</strong><br />Uygulamada profilini açın, sayfanın altındaki “Hesabımı sil” seçeneğine dokunun. Kullanıcı adı, avatar, erişim anahtarları ve hesabınızla ilişkili çevrimiçi maç kayıtları silinir.</p>
    <h2>Yardım iste</h2>
    <p>Bir hata bildirimi veya destek isteği için <a href="https://github.com/xoxon/dot-claim/issues">Dot Claim destek sayfasını</a> kullanın. Lütfen uygulama sürümünü, cihaz modelini ve sorunu yeniden oluşturma adımlarını ekleyin.</p>
    <p class="muted">Son güncelleme: 4 Eylül 2026</p>
  `);
}

function privacyPage(response) {
  return sendHtml(response, 200, 'Gizlilik Politikası', `
    <div class="brand">DOT CLAIM</div>
    <h1>Gizlilik Politikası</h1>
    <p>Bu politika, Dot Claim uygulamasının çevrimiçi eşleşme ve profil özellikleri için hangi verileri işlediğini açıklar.</p>
    <h2>İşlenen veriler</h2>
    <ul>
      <li><strong>Uygulama içi kimlik:</strong> Her yükleme için rastgele oluşturulan uygulama kimliği ve oturum anahtarı.</li>
      <li><strong>Profil verileri:</strong> Seçtiğiniz kullanıcı adı ve isteğe bağlı avatar fotoğrafı.</li>
      <li><strong>Oyun verileri:</strong> Çevrimiçi eşleşmeler, hamle sonuçları, skorlar, kupa, altın, XP ve maç geçmişi.</li>
    </ul>
    <h2>Neden işliyoruz?</h2>
    <p>Bu veriler yalnızca kullanıcı profilini sağlamak, iki oyuncuyu eşleştirmek, oyunun sonucunu doğrulamak, sıralamayı göstermek ve hileyi önlemek için kullanılır. Reklam gösterilmez, reklam kimliği kullanılmaz, uygulama içi davranışınız başka uygulama veya sitelerde takip edilmez ve veriler satılmaz.</p>
    <h2>Kimler görebilir?</h2>
    <p>Çevrimiçi oynadığınız rakipler ve liderlik tablosunu görüntüleyen diğer oyuncular, kullanıcı adınızı, avatarınızı, liginizi ve oyunla ilgili genel istatistiklerinizi görebilir. Avatarınız yalnızca siz yüklemeyi seçerseniz işlenir.</p>
    <h2>Saklama ve silme</h2>
    <p>Profil ve oyun verileri hesabınız etkin olduğu sürece saklanır. Uygulamada <strong>Profil → Hesabımı sil</strong> yolunu izleyerek hesabınızı kalıcı olarak silebilirsiniz. Bu işlem kullanıcı adı, avatar, oturum anahtarları ve hesabınızla ilişkili çevrimiçi maç kayıtlarını sunucudan kaldırır. Silme işlemi geri alınamaz.</p>
    <h2>Çocukların gizliliği</h2>
    <p>Uygulama özel nitelikli bilgi, konum, kişi listesi veya ödeme bilgisi istemez. Kullanıcılar yalnızca oyun için uygun bir kullanıcı adı ve isteğe bağlı avatar paylaşmalıdır.</p>
    <h2>İletişim</h2>
    <p>Gizlilikle ilgili talepler ve sorular için <a href="https://github.com/xoxon/dot-claim/issues">Dot Claim destek sayfasını</a> kullanın.</p>
    <p class="muted">Yürürlük tarihi: 4 Eylül 2026</p>
  `);
}

function sendError(request, response, status, message) {
  sendJson(request, response, status, { error: message });
}

async function readJson(request, limit = 1_200_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function requireAuthenticatedUser(request, response) {
  const user = getUserFromToken(tokenFromRequest(request));
  if (!user) {
    sendError(request, response, 401, 'Oturum geçersiz. Uygulamayı yeniden açın.');
    return null;
  }
  return user;
}

function rateLimit(request, response, bucket, maxRequests, windowMs = 60_000) {
  const ip = request.socket.remoteAddress ?? 'unknown';
  const key = `${bucket}:${ip}`;
  const current = rateBuckets.get(key) ?? { count: 0, resetAt: Date.now() + windowMs };
  if (current.resetAt <= Date.now()) {
    current.count = 0;
    current.resetAt = Date.now() + windowMs;
  }
  current.count += 1;
  rateBuckets.set(key, current);
  if (current.count <= maxRequests) return true;
  sendError(request, response, 429, 'Çok fazla istek gönderildi. Lütfen biraz bekleyin.');
  return false;
}

function avatarFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extension: 'jpg', contentType: 'image/jpeg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: 'png', contentType: 'image/png' };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { extension: 'webp', contentType: 'image/webp' };
  return null;
}

function serveAvatar(request, response, pathname) {
  const match = pathname.match(/^\/uploads\/avatars\/([0-9a-f-]{36})\.(jpg|png|webp)$/i);
  if (!match) return sendError(request, response, 404, 'Görsel bulunamadı.');
  const path = join(AVATAR_DIRECTORY, `${match[1]}.${match[2].toLowerCase()}`);
  if (!existsSync(path)) return sendError(request, response, 404, 'Görsel bulunamadı.');
  applyCors(request, response);
  const contentType = match[2].toLowerCase() === 'png' ? 'image/png' : match[2].toLowerCase() === 'webp' ? 'image/webp' : 'image/jpeg';
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=604800, immutable' });
  response.end(readFileSync(path));
}

function historyFor(userId, limit) {
  const rows = database.prepare(`
    SELECT matches.*, blue.display_name AS blue_name, blue.avatar_path AS blue_avatar_path, blue.avatar_version AS blue_avatar_version,
      red.display_name AS red_name, red.avatar_path AS red_avatar_path, red.avatar_version AS red_avatar_version
    FROM matches
    INNER JOIN users blue ON blue.id = matches.blue_user_id
    INNER JOIN users red ON red.id = matches.red_user_id
    WHERE matches.blue_user_id = ? OR matches.red_user_id = ?
    ORDER BY matches.ended_at DESC LIMIT ?
  `).all(userId, userId, limit);
  return rows.map((row) => {
    const isBlue = row.blue_user_id === userId;
    const opponent = isBlue
      ? { displayName: row.red_name, avatarUrl: row.red_avatar_path ? `${PUBLIC_BASE_URL}${row.red_avatar_path}?v=${row.red_avatar_version}` : null }
      : { displayName: row.blue_name, avatarUrl: row.blue_avatar_path ? `${PUBLIC_BASE_URL}${row.blue_avatar_path}?v=${row.blue_avatar_version}` : null };
    const outcome = row.winner === 'draw' ? 'draw' : row.winner === (isBlue ? 'blue' : 'red') ? 'win' : 'loss';
    const rewards = JSON.parse(row.rewards_json)[isBlue ? 'blue' : 'red'];
    return {
      id: row.id,
      difficulty: row.difficulty,
      score: { you: isBlue ? row.blue_score : row.red_score, opponent: isBlue ? row.red_score : row.blue_score },
      outcome,
      reason: row.reason,
      opponent,
      rewards,
      endedAt: row.ended_at,
    };
  });
}

async function handleHttp(request, response) {
  if (request.method === 'OPTIONS') {
    applyCors(request, response);
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/support') return supportPage(response);
  if (request.method === 'GET' && url.pathname === '/privacy') return privacyPage(response);
  if (request.method === 'GET' && url.pathname.startsWith('/uploads/avatars/')) return serveAvatar(request, response, url.pathname);
  if (request.method === 'GET' && url.pathname === '/health') return sendJson(request, response, 200, { ok: true, database: 'ready' });

  if (request.method === 'POST' && url.pathname === '/v1/auth/guest') {
    if (!rateLimit(request, response, 'guest', 12)) return;
    const body = await readJson(request, 8_000);
    if (typeof body.deviceId !== 'string' || !/^[0-9a-f-]{20,80}$/i.test(body.deviceId)) return sendError(request, response, 400, 'Geçersiz cihaz kimliği.');
    let user = database.prepare('SELECT * FROM users WHERE device_id = ?').get(body.deviceId);
    if (!user) {
      const time = now();
      user = { id: randomUUID(), device_id: body.deviceId, display_name: createAvailableDisplayName() };
      database.prepare('INSERT INTO users (id, device_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(user.id, user.device_id, user.display_name, time, time);
      user = getUserById(user.id);
    }
    const token = makeToken();
    database.prepare('INSERT OR REPLACE INTO auth_tokens (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)').run(hashToken(token), user.id, now(), now());
    return sendJson(request, response, 201, { token, profile: publicUser(user) });
  }

  if (request.method === 'GET' && url.pathname === '/v1/me') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    return sendJson(request, response, 200, { profile: publicUser(user) });
  }

  if (request.method === 'PATCH' && url.pathname === '/v1/me') {
    if (!rateLimit(request, response, 'profile', 20)) return;
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    if (user.display_name_locked) return sendError(request, response, 403, 'Kullanıcı adı bir kez ayarlanabilir ve artık sabitlenmiş.');
    const body = await readJson(request, 8_000);
    const displayName = normalizeDisplayName(body.displayName);
    if (!displayName) return sendError(request, response, 400, 'Kullanıcı adı 3-18 karakter olmalı; sadece harf, rakam, boşluk, nokta ve tire kullanın.');
    if (database.prepare('SELECT id FROM users WHERE display_name = ? AND id != ?').get(displayName, user.id)) return sendError(request, response, 409, 'Bu kullanıcı adı alınmış.');
    database.prepare('UPDATE users SET display_name = ?, display_name_locked = 1, updated_at = ? WHERE id = ?').run(displayName, now(), user.id);
    return sendJson(request, response, 200, { profile: publicUser(getUserById(user.id)) });
  }

  if (request.method === 'POST' && url.pathname === '/v1/me/avatar') {
    if (!rateLimit(request, response, 'avatar', 6)) return;
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const body = await readJson(request, Math.ceil(MAX_AVATAR_BYTES * 1.5));
    if (typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) return sendError(request, response, 400, 'Geçerli bir görsel gönderilemedi.');
    const image = Buffer.from(body.base64, 'base64');
    const format = image.length <= MAX_AVATAR_BYTES ? avatarFormat(image) : null;
    if (!format) return sendError(request, response, 400, 'Avatar JPG, PNG veya WebP olmalı ve 900 KB altında kalmalı.');
    for (const extension of ['jpg', 'png', 'webp']) {
      const oldPath = join(AVATAR_DIRECTORY, `${user.id}.${extension}`);
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }
    const target = join(AVATAR_DIRECTORY, `${user.id}.${format.extension}`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, image, { mode: 0o600 });
    renameSync(temporary, target);
    database.prepare('UPDATE users SET avatar_path = ?, avatar_version = avatar_version + 1, updated_at = ? WHERE id = ?').run(`/uploads/avatars/${user.id}.${format.extension}`, now(), user.id);
    return sendJson(request, response, 200, { profile: publicUser(getUserById(user.id)) });
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/me') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const inActiveMatch = [...rooms.values()].some((room) => !room.isComplete && Object.values(room.players).some((player) => player.userId === user.id));
    if (inActiveMatch) return sendError(request, response, 409, 'Çevrim içi maç bittiğinde hesabını silebilirsin.');
    database.transaction(() => {
      database.prepare('DELETE FROM matches WHERE blue_user_id = ? OR red_user_id = ?').run(user.id, user.id);
      database.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    })();
    for (const extension of ['jpg', 'png', 'webp']) {
      const avatar = join(AVATAR_DIRECTORY, `${user.id}.${extension}`);
      if (existsSync(avatar)) unlinkSync(avatar);
    }
    applyCors(request, response);
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/v1/leaderboard') {
    const requested = Number(url.searchParams.get('limit') ?? 25);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 50) : 25;
    const users = database.prepare('SELECT * FROM users ORDER BY trophies DESC, xp DESC, wins DESC, created_at ASC LIMIT ?').all(limit);
    return sendJson(request, response, 200, { leaderboard: users.map((user, index) => ({ rank: index + 1, ...publicUser(user) })) });
  }

  if (request.method === 'GET' && url.pathname === '/v1/me/matches') {
    const user = requireAuthenticatedUser(request, response);
    if (!user) return;
    const requested = Number(url.searchParams.get('limit') ?? 8);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 30) : 8;
    return sendJson(request, response, 200, { matches: historyFor(user.id, limit) });
  }

  return sendError(request, response, 404, 'İstenen kaynak bulunamadı.');
}

const httpServer = createServer((request, response) => {
  void handleHttp(request, response).catch((error) => {
    console.error('HTTP request failed', error);
    if (!response.headersSent) sendError(request, response, error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, error.message === 'PAYLOAD_TOO_LARGE' ? 'Dosya çok büyük.' : 'İstek işlenemedi.');
    else response.end();
  });
});

const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

io.use((socket, next) => {
  const user = getUserFromToken(socket.handshake.auth?.token);
  if (!user) return next(new Error('AUTHENTICATION_REQUIRED'));
  socket.data.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  socket.on('find_match', ({ difficulty } = {}) => {
    const selectedDifficulty = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
    leaveWaiting(socket.id);
    const queue = waiting.get(selectedDifficulty) ?? [];
    const opponentId = queue.find((id) => id !== socket.id && io.sockets.sockets.has(id));
    if (!opponentId) {
      waiting.set(selectedDifficulty, [...queue, socket.id]);
      socket.emit('queue_status', { state: 'waiting', difficulty: selectedDifficulty });
      return;
    }
    waiting.set(selectedDifficulty, queue.filter((id) => id !== opponentId));
    const opponent = io.sockets.sockets.get(opponentId);
    if (!opponent) return socket.emit('queue_status', { state: 'waiting', difficulty: selectedDifficulty });
    const room = createMatch(selectedDifficulty, opponent, socket);
    rooms.set(room.id, room);
    socketRoom.set(opponentId, room.id);
    socketRoom.set(socket.id, room.id);
    opponent.join(room.id);
    socket.join(room.id);
    opponent.emit('match_found', { roomId: room.id, color: 'blue', state: publicState(room) });
    socket.emit('match_found', { roomId: room.id, color: 'red', state: publicState(room) });
  });

  socket.on('start_match', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    const role = room ? roleFor(room, socket.id) : null;
    if (!room || !role || socketRoom.get(socket.id) !== roomId || room.finalized) {
      return socket.emit('move_rejected', { message: 'Eşleşme bulunamadı. Lütfen yeniden eşleşin.' });
    }
    if (room.started) return;
    room.ready[role] = true;
    io.to(room.id).emit('match_ready', { roomId: room.id, ready: room.ready });
    if (!room.ready.blue || !room.ready.red) return;
    room.started = true;
    io.to(room.id).emit('game_started', { state: publicState(room) });
  });

  socket.on('play_move', ({ roomId, a, b } = {}) => {
    const room = rooms.get(roomId);
    const role = room ? roleFor(room, socket.id) : null;
    if (!room || !role || socketRoom.get(socket.id) !== roomId || room.finalized) return socket.emit('move_rejected', { message: 'Eşleşme bulunamadı. Lütfen yeniden eşleşin.' });
    if (!room.started) return socket.emit('move_rejected', { message: 'Her iki oyuncu da Oyuna başla düğmesine dokunmalı.' });
    if (room.turn !== role) return socket.emit('move_rejected', { message: 'Şimdi rakibinizin sırası.' });
    if (!canConnect(room, a, b)) return socket.emit('move_rejected', { message: 'Bu bağlantı kullanılamaz.' });
    makeMove(room, a, b, role);
    io.to(room.id).emit('game_state', publicState(room));
    if (room.isComplete) finishRoom(room);
  });

  socket.on('leave_match', () => {
    leaveWaiting(socket.id);
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.finalized) return;
    if (!room.started) return cancelUnstartedRoom(room);
    const role = roleFor(room, socket.id);
    if (role) finishRoom(room, { reason: 'forfeit', winnerOverride: role === 'blue' ? 'red' : 'blue' });
  });

  socket.on('disconnect', () => {
    leaveWaiting(socket.id);
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room || room.finalized) return;
    if (!room.started) return cancelUnstartedRoom(room);
    const role = roleFor(room, socket.id);
    if (role) finishRoom(room, { reason: 'forfeit', winnerOverride: role === 'blue' ? 'red' : 'blue' });
  });
});

httpServer.listen(PORT, () => {
  console.log(`Dot Claim match server is listening on port ${PORT}`);
  console.log(`Database: ${DATABASE_PATH}`);
});

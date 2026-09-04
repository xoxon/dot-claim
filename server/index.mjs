import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT ?? 3001);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? ['*'];
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

const waiting = new Map();
const rooms = new Map();
const socketRoom = new Map();
const DOT_COLORS = ['#FF5D73', '#FFC857', '#3DD6B8', '#59B7FF', '#B27BFF', '#FF8C5A', '#F273D4'];
const LAYOUTS = [
  [[16, 20], [50, 12], [84, 23], [26, 50], [65, 48], [16, 80], [50, 86], [85, 75]],
  [[14, 25], [40, 12], [72, 15], [88, 42], [62, 53], [34, 46], [14, 72], [42, 86], [78, 80]],
  [[12, 18], [45, 12], [80, 18], [24, 39], [58, 38], [88, 48], [14, 74], [48, 86], [76, 78]],
];

function edgeKey(a, b) {
  return [a, b].sort().join('--');
}

function triangleKey(ids) {
  return [...ids].sort().join('--');
}

function makeDots(seed) {
  const layout = LAYOUTS[seed % LAYOUTS.length];
  return layout.map(([x, y], index) => ({
    id: `dot-${index}`,
    x,
    y,
    color: DOT_COLORS[(index + seed) % DOT_COLORS.length],
  }));
}

function createMatch(difficulty) {
  const seed = Math.floor(Math.random() * 1_000_000);
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
    isComplete: false,
    players: { blue: null, red: null },
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
    const dotProduct = (dot.x - a.x) * (dot.x - b.x) + (dot.y - a.y) * (dot.y - b.y);
    return dotProduct < 0;
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
        if (edgeIds.has(edgeKey(ids[0], ids[1])) && edgeIds.has(edgeKey(ids[0], ids[2])) && edgeIds.has(edgeKey(ids[1], ids[2]))) {
          additions.push({ id, dots: ids, owner });
        }
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
    isComplete: room.isComplete,
  };
}

function roleFor(room, socketId) {
  if (room.players.blue === socketId) return 'blue';
  if (room.players.red === socketId) return 'red';
  return null;
}

function leaveWaiting(socketId) {
  for (const [difficulty, queue] of waiting) {
    const next = queue.filter((id) => id !== socketId);
    if (next.length) waiting.set(difficulty, next);
    else waiting.delete(difficulty);
  }
}

function finishRoom(room, reason = 'completed') {
  const result = {
    roomId: room.id,
    scores: room.scores,
    winner: room.scores.blue === room.scores.red ? 'draw' : room.scores.blue > room.scores.red ? 'blue' : 'red',
    reason,
  };
  io.to(room.id).emit('match_complete', result);
}

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
    const room = createMatch(selectedDifficulty);
    room.players.blue = opponentId;
    room.players.red = socket.id;
    rooms.set(room.id, room);
    socketRoom.set(opponentId, room.id);
    socketRoom.set(socket.id, room.id);
    const opponent = io.sockets.sockets.get(opponentId);
    opponent?.join(room.id);
    socket.join(room.id);
    opponent?.emit('match_found', { roomId: room.id, color: 'blue', state: publicState(room) });
    socket.emit('match_found', { roomId: room.id, color: 'red', state: publicState(room) });
  });

  socket.on('play_move', ({ roomId, a, b } = {}) => {
    const room = rooms.get(roomId);
    const role = room ? roleFor(room, socket.id) : null;
    if (!room || !role || socketRoom.get(socket.id) !== roomId) {
      socket.emit('move_rejected', { message: 'Eşleşme bulunamadı. Lütfen yeniden eşleşin.' });
      return;
    }
    if (room.turn !== role) {
      socket.emit('move_rejected', { message: 'Şimdi rakibinizin sırası.' });
      return;
    }
    if (!canConnect(room, a, b)) {
      socket.emit('move_rejected', { message: 'Bu bağlantı kullanılamaz.' });
      return;
    }
    makeMove(room, a, b, role);
    io.to(room.id).emit('game_state', publicState(room));
    if (room.isComplete) finishRoom(room);
  });

  socket.on('leave_match', () => {
    leaveWaiting(socket.id);
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;
    const role = roleFor(room, socket.id);
    if (!role) return;
    const opponentRole = role === 'blue' ? 'red' : 'blue';
    const opponentId = room.players[opponentRole];
    if (opponentId) io.to(opponentId).emit('opponent_left');
    rooms.delete(room.id);
    socketRoom.delete(socket.id);
    if (opponentId) socketRoom.delete(opponentId);
  });

  socket.on('disconnect', () => {
    leaveWaiting(socket.id);
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;
    const role = roleFor(room, socket.id);
    if (!role) return;
    const opponentId = room.players[role === 'blue' ? 'red' : 'blue'];
    if (opponentId) io.to(opponentId).emit('opponent_left');
    rooms.delete(room.id);
    socketRoom.delete(socket.id);
    if (opponentId) socketRoom.delete(opponentId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Dot Claim match server is listening on port ${PORT}`);
});

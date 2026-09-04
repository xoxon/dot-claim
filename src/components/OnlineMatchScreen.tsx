import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { io, type Socket } from 'socket.io-client';

import { useGameSounds } from '../audio';
import { canConnect } from '../game/engine';
import type { Difficulty, GameState } from '../game/types';
import { MATCH_SERVER_URL } from '../profile/api';
import type { PlayerProfile } from '../profile/types';
import type { MatchColor, OnlineMatchResult, OnlineMatchState } from '../online/types';
import { GameBoard } from './GameBoard';
import { Avatar } from './ProfileScreen';

const SERVER_URL = MATCH_SERVER_URL;

type ConnectionState = 'connecting' | 'waiting' | 'matched' | 'playing' | 'opponent_left' | 'error';

export function OnlineMatchScreen({ difficulty, profile, token, soundEnabled, hapticsEnabled, onBack, onProfileUpdated }: {
  difficulty: Difficulty;
  profile: PlayerProfile | null;
  token: string | null;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  onBack: () => void;
  onProfileUpdated: (profile: PlayerProfile) => void;
}) {
  const { width } = useWindowDimensions();
  const socketRef = useRef<Socket | null>(null);
  const completeRef = useRef(false);
  const colorRef = useRef<MatchColor | null>(null);
  const lastMoveRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [match, setMatch] = useState<OnlineMatchState | null>(null);
  const [color, setColor] = useState<MatchColor | null>(null);
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const [result, setResult] = useState<OnlineMatchResult | null>(null);
  const playSound = useGameSounds(soundEnabled);
  const boardSize = Math.min(Math.max(width - 32, 260), 500);

  const haptic = useCallback((style: Haptics.ImpactFeedbackStyle) => {
    if (hapticsEnabled && Platform.OS !== 'web') void Haptics.impactAsync(style).catch(() => undefined);
  }, [hapticsEnabled]);

  useEffect(() => {
    if (!SERVER_URL || !token || !profile) {
      setConnection('error');
      return undefined;
    }
    const socket = io(SERVER_URL, { auth: { token }, transports: ['websocket'], timeout: 9000, reconnection: true, reconnectionAttempts: 3 });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnection('waiting');
      socket.emit('find_match', { difficulty });
    });
    socket.on('queue_status', () => setConnection('waiting'));
    socket.on('match_found', ({ color: assignedColor, state }: { color: MatchColor; state: OnlineMatchState }) => {
      setColor(assignedColor);
      colorRef.current = assignedColor;
      setMatch(state);
      setConnection('matched');
      lastMoveRef.current = 0;
    });
    socket.on('match_ready', ({ roomId, ready }: { roomId: string; ready: Record<MatchColor, boolean> }) => {
      setMatch((current) => current?.roomId === roomId ? { ...current, ready } : current);
    });
    socket.on('game_started', ({ state }: { state: OnlineMatchState }) => {
      setMatch(state);
      setConnection('playing');
      lastMoveRef.current = 0;
    });
    socket.on('game_state', (state: OnlineMatchState) => {
      setPendingMove(false);
      setSelectedDotId(null);
      setMatch(state);
    });
    socket.on('match_complete', (nextResult: OnlineMatchResult) => {
      if (completeRef.current) return;
      completeRef.current = true;
      setPendingMove(false);
      setSelectedDotId(null);
      const assignedColor = colorRef.current;
      const outcome = !assignedColor || nextResult.winner === 'draw' ? 'draw' : nextResult.winner === assignedColor ? 'win' : 'loss';
      const nextProfile = assignedColor ? nextResult.players[assignedColor] : null;
      if (nextProfile) onProfileUpdated(nextProfile);
      setResult(nextResult);
      playSound(outcome === 'win' ? 'victory' : 'defeat');
      haptic(outcome === 'win' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
      setResultVisible(true);
    });
    socket.on('move_rejected', ({ message }: { message: string }) => {
      setPendingMove(false);
      haptic(Haptics.ImpactFeedbackStyle.Rigid);
      playSound('invalid');
      Alert.alert('Hamle kabul edilmedi', message);
    });
    socket.on('opponent_left', () => {
      setPendingMove(false);
      setConnection('opponent_left');
    });
    socket.on('connect_error', () => setConnection('error'));
    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') setConnection('error');
    });
    return () => {
      socket.emit('leave_match');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [difficulty, haptic, onProfileUpdated, playSound, profile, token]);

  const localGame = useMemo<GameState | null>(() => {
    if (!match || !color) return null;
    const opponentColor: MatchColor = color === 'blue' ? 'red' : 'blue';
    return {
      level: 1,
      difficulty: match.difficulty,
      dots: match.dots,
      edges: match.edges.map((edge) => ({ ...edge, owner: edge.owner === color ? 'player' : 'rival' })),
      triangles: match.triangles.map((triangle) => ({ ...triangle, owner: triangle.owner === color ? 'player' : 'rival' })),
      turn: match.turn === color ? 'player' : 'rival',
      selectedDotId,
      playerScore: match.scores[color],
      rivalScore: match.scores[opponentColor],
      moveNumber: match.moveNumber,
      maxMoves: match.maxMoves,
      isComplete: match.isComplete,
      isDaily: false,
    };
  }, [color, match, selectedDotId]);

  useEffect(() => {
    if (!localGame || !color) return;
    if (localGame.moveNumber > lastMoveRef.current) {
      const claimed = localGame.triangles.length > 0 && localGame.moveNumber > 2 && (localGame.playerScore + localGame.rivalScore) > 0;
      if (!localGame.isComplete) playSound(claimed ? 'claim' : localGame.turn === 'player' ? 'rival' : 'connect');
      lastMoveRef.current = localGame.moveNumber;
    }
  }, [color, localGame, playSound]);

  const onDotPress = (id: string) => {
    if (!localGame || !match || !color || connection !== 'playing' || localGame.turn !== 'player' || pendingMove || localGame.isComplete) return;
    if (!selectedDotId) {
      setSelectedDotId(id);
      haptic(Haptics.ImpactFeedbackStyle.Light);
      playSound('select');
      return;
    }
    if (selectedDotId === id) {
      setSelectedDotId(null);
      return;
    }
    if (!canConnect(localGame, selectedDotId, id)) {
      haptic(Haptics.ImpactFeedbackStyle.Rigid);
      playSound('invalid');
      Alert.alert('Bu çizgi kullanılamaz', 'Nokta zaten bağlı veya çizgi başka bir noktanın üzerinden geçiyor.');
      return;
    }
    setPendingMove(true);
    setSelectedDotId(null);
    socketRef.current?.emit('play_move', { roomId: match.roomId, a: selectedDotId, b: id });
  };

  const startMatch = () => {
    if (!match || !color || match.ready[color]) return;
    setMatch((current) => current ? { ...current, ready: { ...current.ready, [color]: true } } : current);
    socketRef.current?.emit('start_match', { roomId: match.roomId });
  };

  const title = connection === 'connecting' ? 'Sunucuya bağlanılıyor…'
      : connection === 'waiting' ? 'Rakip aranıyor…'
      : connection === 'matched' ? 'Rakibin bulundu!'
      : connection === 'opponent_left' ? 'Rakip ayrıldı.'
        : connection === 'error' ? 'Bağlantı kurulamadı.'
          : localGame?.isComplete ? 'Eşleşme tamamlandı.'
            : localGame?.turn === 'player' ? (selectedDotId ? 'İkinci noktayı seç.' : 'Senin sıran.') : 'Rakibin hamlesi bekleniyor…';

  const player = color && match ? match.players[color] : profile;
  const opponent = color && match ? match.players[color === 'blue' ? 'red' : 'blue'] : null;
  const didWin = color && result ? result.winner === color : false;
  const didDraw = result?.winner === 'draw';
  const ownReward = color && result ? result.rewards[color] : null;
  const resultTitle = didWin ? 'Eşleşmeyi kazandın!' : didDraw ? 'Eşleşme berabere.' : 'Rövanş vakti.';
  return (
    <View style={styles.screen}>
      <View style={styles.topRow}>
        <OnlineIconButton label="Çevrimiçi eşleşmeden çık" symbol="‹" onPress={onBack} />
        <View><Text style={styles.kicker}>ÇEVRİMİÇİ EŞLEŞME</Text><Text style={styles.subtitle}>{difficulty === 'easy' ? 'Rahat' : difficulty === 'hard' ? 'Usta' : 'Dengeli'}</Text></View>
        <View style={[styles.connection, { backgroundColor: connection === 'playing' ? '#38D5AA' : connection === 'error' || connection === 'opponent_left' ? '#FF6680' : '#FFC857' }]} />
      </View>

      {connection === 'matched' && color && match ? (
        <MatchLobby match={match} color={color} onStart={startMatch} />
      ) : localGame ? (
        <>
          <View style={styles.scoreCard}>
            <OnlineScore label="SEN" name={player?.displayName ?? 'Sen'} profile={player} score={localGame.playerScore} color="#58C7FF" active={localGame.turn === 'player' && !localGame.isComplete} />
            <View style={styles.moves}><Text style={styles.moveValue}>{localGame.moveNumber}/{localGame.maxMoves}</Text><Text style={styles.moveLabel}>HAMLE</Text></View>
            <OnlineScore label="RAKİP" name={opponent?.displayName ?? 'Rakip'} profile={opponent} score={localGame.rivalScore} color="#FF6680" active={localGame.turn === 'rival' && !localGame.isComplete} />
          </View>
          <View style={styles.status}><View style={[styles.statusLight, { backgroundColor: localGame.turn === 'player' ? '#58C7FF' : '#FF6680' }]} /><Text style={styles.statusText}>{title}</Text></View>
          <GameBoard dots={localGame.dots} edges={localGame.edges} triangles={localGame.triangles} selectedDotId={selectedDotId} disabled={localGame.turn !== 'player' || pendingMove || localGame.isComplete || connection !== 'playing'} size={boardSize} onDotPress={onDotPress} />
          <Text style={styles.rule}>Hamleler sunucuda doğrulanır; iki oyuncu da aynı tahtayı anlık görür.</Text>
        </>
      ) : (
        <View style={styles.waitingCard}>
          <Text style={styles.waitingSymbol}>{connection === 'error' ? '!' : '◌'}</Text>
          <Text style={styles.waitingTitle}>{title}</Text>
          <Text style={styles.waitingText}>{connection === 'waiting' || connection === 'connecting' ? 'Başka bir oyuncu eşleşmeye katıldığında oyun otomatik başlar.' : SERVER_URL ? `Sunucu adresini kontrol edin: ${SERVER_URL}` : 'Çevrimiçi sunucu adresi bu sürüme henüz tanımlanmadı.'}</Text>
          {(connection === 'error' || connection === 'opponent_left') && <OnlineButton label="Ana sayfaya dön" onPress={onBack} />}
        </View>
      )}

      <Modal transparent animationType="fade" visible={resultVisible} onRequestClose={() => setResultVisible(false)}>
        <View style={styles.scrim}>
          <View style={styles.resultCard}>
            <Text style={styles.resultIcon}>{didWin ? '✦' : didDraw ? '≈' : '◌'}</Text>
            <Text style={styles.resultTitle}>{resultTitle}</Text>
            <Text style={styles.resultOpponent}>{opponent ? `${opponent.displayName} ile oynadın` : 'Maç sonucu sunucuda kaydedildi'}</Text>
            <Text style={styles.resultScore}>{localGame?.playerScore} : {localGame?.rivalScore}</Text>
            {ownReward && <View style={styles.rewards}>
              <Reward label="KUPA" value={ownReward.trophyDelta} symbol="🏆" color="#FFC857" />
              <Reward label="ALTIN" value={ownReward.coinDelta} symbol="✦" color="#F6C84E" />
              <Reward label="XP" value={ownReward.xpDelta} symbol="+" color="#58C7FF" />
            </View>}
            {ownReward?.streakBonus ? <Text style={styles.streakBonus}>3 maçlık seri bonusu: +{ownReward.streakBonus} altın</Text> : null}
            {result?.reason === 'forfeit' && didWin ? <Text style={styles.forfeit}>Rakip ayrıldığı için galibiyet senin.</Text> : null}
            <OnlineButton label="Ana sayfa" onPress={onBack} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MatchLobby({ match, color, onStart }: { match: OnlineMatchState; color: MatchColor; onStart: () => void }) {
  const opponentColor: MatchColor = color === 'blue' ? 'red' : 'blue';
  const youReady = match.ready[color];
  const opponentReady = match.ready[opponentColor];
  return <View style={styles.lobbyCard}>
    <Text style={styles.lobbyEyebrow}>EŞLEŞME BULUNDU</Text>
    <Text style={styles.lobbyTitle}>Hazır mısınız?</Text>
    <Text style={styles.lobbyText}>Tahta, iki oyuncu da oyuna hazır olduğunda açılır.</Text>
    <View style={styles.lobbyPlayers}>
      <LobbyPlayer label="SEN" profile={match.players[color]} ready={youReady} color="#58C7FF" />
      <Text style={styles.vs}>VS</Text>
      <LobbyPlayer label="RAKİP" profile={match.players[opponentColor]} ready={opponentReady} color="#FF6680" />
    </View>
    <View style={[styles.readyHint, opponentReady && styles.readyHintActive]}>
      <View style={[styles.readyLight, { backgroundColor: opponentReady ? '#3DD6B8' : '#FFC857' }]} />
      <Text style={styles.readyHintText}>{opponentReady ? 'Rakibin hazır. Senin onayın bekleniyor.' : 'Rakibinin hazır olmasını bekliyorsun.'}</Text>
    </View>
    <OnlineButton label={youReady ? 'Hazırsın · Rakip bekleniyor' : 'Oyuna başla'} onPress={onStart} disabled={youReady} />
  </View>;
}

function LobbyPlayer({ label, profile, ready, color }: { label: string; profile: PlayerProfile; ready: boolean; color: string }) {
  return <View style={styles.lobbyPlayer}>
    <View style={[styles.lobbyAvatarRing, { borderColor: color }]}><Avatar profile={profile} size={58} /></View>
    <Text style={styles.lobbyPlayerLabel}>{label}</Text>
    <Text numberOfLines={1} style={styles.lobbyPlayerName}>{profile.displayName}</Text>
    <View style={[styles.playerReady, ready && styles.playerReadyActive]}><Text style={[styles.playerReadyText, ready && styles.playerReadyTextActive]}>{ready ? 'Hazır' : 'Bekliyor'}</Text></View>
  </View>;
}

function OnlineIconButton({ label, symbol, onPress }: { label: string; symbol: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}><Text style={styles.iconText}>{symbol}</Text></Pressable>;
}

function OnlineScore({ label, name, profile, score, color, active }: { label: string; name: string; profile: PlayerProfile | null; score: number; color: string; active: boolean }) {
  return <View style={styles.score}>
    <View style={styles.scoreIdentity}>{profile ? <Avatar profile={profile} size={21} /> : <View style={[styles.scoreDot, { backgroundColor: color }]} />}<Text numberOfLines={1} style={styles.scoreName}>{name}</Text></View>
    <Text style={styles.scoreLabel}>{label}</Text><Text style={styles.scoreValue}>{score}</Text>
  </View>;
}

function Reward({ label, value, symbol, color }: { label: string; value: number; symbol: string; color: string }) {
  return <View style={styles.reward}><Text style={[styles.rewardValue, { color }]}>{symbol} {value > 0 ? '+' : ''}{value}</Text><Text style={styles.rewardLabel}>{label}</Text></View>;
}

function OnlineButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.buttonDisabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, paddingBottom: 20, backgroundColor: '#07111F', gap: 16 },
  topRow: { paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#13263B', borderWidth: 1, borderColor: '#25425C' },
  iconText: { color: '#F7FBFF', fontSize: 27, marginTop: -3 },
  kicker: { color: '#8FA8BD', fontSize: 10, fontWeight: '800', textAlign: 'center', letterSpacing: 1.2 },
  subtitle: { color: '#F7FBFF', fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  connection: { width: 12, height: 12, borderRadius: 6 },
  scoreCard: { minHeight: 94, borderRadius: 20, paddingHorizontal: 18, backgroundColor: '#0E2035', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#1B354E' },
  score: { minWidth: 60, alignItems: 'center' },
  scoreIdentity: { maxWidth: 76, flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  scoreName: { color: '#C8D9E7', flexShrink: 1, fontSize: 10, fontWeight: '700' },
  scoreDot: { width: 9, height: 9, borderRadius: 5, marginBottom: 5 },
  scoreDotActive: { transform: [{ scale: 1.5 }] },
  scoreLabel: { color: '#91A5B9', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  scoreValue: { color: '#F7FBFF', fontSize: 28, fontWeight: '800', marginTop: -1 },
  moves: { alignItems: 'center', paddingHorizontal: 18, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#294159' },
  moveValue: { color: '#D5E1EB', fontSize: 16, fontWeight: '800' },
  moveLabel: { color: '#71879B', fontSize: 9, fontWeight: '800', letterSpacing: 0.9, marginTop: 2 },
  status: { minHeight: 44, paddingHorizontal: 15, borderRadius: 14, backgroundColor: '#0B1C2E', borderWidth: 1, borderColor: '#1B354E', flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusLight: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#D8E5EF', fontSize: 13, fontWeight: '600', flex: 1 },
  rule: { color: '#9AB0C2', fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 18 },
  waitingCard: { flex: 1, maxHeight: 320, justifyContent: 'center', alignItems: 'center', padding: 28, borderRadius: 28, backgroundColor: '#0E2035', borderWidth: 1, borderColor: '#1B354E', marginTop: 80 },
  waitingSymbol: { color: '#58C7FF', fontSize: 42, fontWeight: '800' },
  waitingTitle: { color: '#F7FBFF', fontSize: 22, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  waitingText: { color: '#9AB0C2', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  lobbyCard: { flex: 1, maxHeight: 450, justifyContent: 'center', alignItems: 'center', padding: 26, borderRadius: 28, backgroundColor: '#0E2035', borderWidth: 1, borderColor: '#285473', marginTop: 48 },
  lobbyEyebrow: { color: '#58C7FF', fontSize: 11, letterSpacing: 1.3, fontWeight: '900' },
  lobbyTitle: { color: '#F7FBFF', fontSize: 26, fontWeight: '900', marginTop: 8 },
  lobbyText: { color: '#9AB0C2', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  lobbyPlayers: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26 },
  lobbyPlayer: { width: '39%', alignItems: 'center' },
  lobbyAvatarRing: { padding: 3, borderRadius: 35, borderWidth: 2 },
  lobbyPlayerLabel: { color: '#91A5B9', fontSize: 10, letterSpacing: 1, fontWeight: '900', marginTop: 8 },
  lobbyPlayerName: { color: '#F0F7FC', fontSize: 14, fontWeight: '800', marginTop: 3, maxWidth: '100%' },
  vs: { color: '#7591A6', fontSize: 16, fontWeight: '900' },
  playerReady: { marginTop: 8, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: '#1D2E40' },
  playerReadyActive: { backgroundColor: '#143D39' },
  playerReadyText: { color: '#91A5B9', fontSize: 10, fontWeight: '800' },
  playerReadyTextActive: { color: '#5CE4BC' },
  readyHint: { width: '100%', minHeight: 44, marginTop: 24, paddingHorizontal: 13, borderRadius: 13, backgroundColor: '#0B1C2E', flexDirection: 'row', alignItems: 'center', gap: 8 },
  readyHintActive: { backgroundColor: '#0C2C2E' },
  readyLight: { width: 8, height: 8, borderRadius: 4 },
  readyHintText: { color: '#C1D2DF', fontSize: 12, fontWeight: '700', flex: 1 },
  button: { marginTop: 22, minHeight: 48, borderRadius: 15, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7FBFF' },
  buttonText: { color: '#0B253A', fontSize: 16, fontWeight: '800' },
  buttonDisabled: { backgroundColor: '#71879B' },
  scrim: { flex: 1, backgroundColor: 'rgba(1, 8, 16, 0.76)', padding: 24, justifyContent: 'center' },
  resultCard: { borderRadius: 28, padding: 27, backgroundColor: '#10263D', borderWidth: 1, borderColor: '#35607E', alignItems: 'center' },
  resultIcon: { color: '#FFC857', fontSize: 42 },
  resultTitle: { color: '#F7FBFF', fontSize: 24, fontWeight: '800', marginTop: 8 },
  resultOpponent: { color: '#ACC1D1', fontSize: 14, marginTop: 6, textAlign: 'center' },
  resultScore: { color: '#F7FBFF', fontSize: 42, fontWeight: '800', marginTop: 16 },
  rewards: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 18 },
  reward: { flex: 1, minHeight: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1C2E', borderWidth: 1, borderColor: '#24435C' },
  rewardValue: { fontSize: 15, fontWeight: '900' },
  rewardLabel: { color: '#8FA8BD', fontSize: 9, letterSpacing: 0.8, fontWeight: '800', marginTop: 3 },
  streakBonus: { color: '#F6CF68', fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 12 },
  forfeit: { color: '#B8CCDA', fontSize: 12, textAlign: 'center', marginTop: 12 },
});

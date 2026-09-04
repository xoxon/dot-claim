import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { io, type Socket } from 'socket.io-client';

import { useGameSounds } from '../audio';
import { canConnect } from '../game/engine';
import type { Difficulty, GameState } from '../game/types';
import type { MatchColor, OnlineMatchState } from '../online/types';
import { GameBoard } from './GameBoard';

const SERVER_URL = process.env.EXPO_PUBLIC_MATCH_SERVER_URL ?? (__DEV__ ? 'http://127.0.0.1:3001' : '');

type ConnectionState = 'connecting' | 'waiting' | 'playing' | 'opponent_left' | 'error';

export function OnlineMatchScreen({ difficulty, soundEnabled, hapticsEnabled, onBack, onComplete }: {
  difficulty: Difficulty;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  onBack: () => void;
  onComplete: (result: 'win' | 'loss' | 'draw') => void;
}) {
  const { width } = useWindowDimensions();
  const socketRef = useRef<Socket | null>(null);
  const completeRef = useRef(false);
  const lastMoveRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [match, setMatch] = useState<OnlineMatchState | null>(null);
  const [color, setColor] = useState<MatchColor | null>(null);
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const playSound = useGameSounds(soundEnabled);
  const boardSize = Math.min(Math.max(width - 32, 260), 500);

  const haptic = useCallback((style: Haptics.ImpactFeedbackStyle) => {
    if (hapticsEnabled && Platform.OS !== 'web') void Haptics.impactAsync(style).catch(() => undefined);
  }, [hapticsEnabled]);

  useEffect(() => {
    if (!SERVER_URL) {
      setConnection('error');
      return undefined;
    }
    const socket = io(SERVER_URL, { transports: ['websocket'], timeout: 9000, reconnection: true, reconnectionAttempts: 3 });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnection('waiting');
      socket.emit('find_match', { difficulty });
    });
    socket.on('queue_status', () => setConnection('waiting'));
    socket.on('match_found', ({ color: assignedColor, state }: { color: MatchColor; state: OnlineMatchState }) => {
      setColor(assignedColor);
      setMatch(state);
      setConnection('playing');
      lastMoveRef.current = 0;
    });
    socket.on('game_state', (state: OnlineMatchState) => {
      setPendingMove(false);
      setSelectedDotId(null);
      setMatch(state);
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
  }, [difficulty, haptic, playSound]);

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
    if (localGame.isComplete && !completeRef.current) {
      completeRef.current = true;
      const result = localGame.playerScore === localGame.rivalScore ? 'draw' : localGame.playerScore > localGame.rivalScore ? 'win' : 'loss';
      playSound(result === 'win' ? 'victory' : 'defeat');
      haptic(result === 'win' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
      onComplete(result);
      setResultVisible(true);
    }
  }, [color, haptic, localGame, onComplete, playSound]);

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

  const title = connection === 'connecting' ? 'Sunucuya bağlanılıyor…'
    : connection === 'waiting' ? 'Rakip aranıyor…'
      : connection === 'opponent_left' ? 'Rakip ayrıldı.'
        : connection === 'error' ? 'Bağlantı kurulamadı.'
          : localGame?.isComplete ? 'Eşleşme tamamlandı.'
            : localGame?.turn === 'player' ? (selectedDotId ? 'İkinci noktayı seç.' : 'Senin sıran.') : 'Rakibin hamlesi bekleniyor…';

  const resultTitle = localGame && localGame.playerScore > localGame.rivalScore ? 'Eşleşmeyi kazandın!' : localGame?.playerScore === localGame?.rivalScore ? 'Eşleşme berabere.' : 'Bu tur rakibin.';
  return (
    <View style={styles.screen}>
      <View style={styles.topRow}>
        <OnlineIconButton label="Çevrimiçi eşleşmeden çık" symbol="‹" onPress={onBack} />
        <View><Text style={styles.kicker}>ÇEVRİMİÇİ EŞLEŞME</Text><Text style={styles.subtitle}>{difficulty === 'easy' ? 'Rahat' : difficulty === 'hard' ? 'Usta' : 'Dengeli'}</Text></View>
        <View style={[styles.connection, { backgroundColor: connection === 'playing' ? '#38D5AA' : connection === 'error' || connection === 'opponent_left' ? '#FF6680' : '#FFC857' }]} />
      </View>

      {localGame ? (
        <>
          <View style={styles.scoreCard}>
            <OnlineScore label="SEN" score={localGame.playerScore} color="#58C7FF" active={localGame.turn === 'player' && !localGame.isComplete} />
            <View style={styles.moves}><Text style={styles.moveValue}>{localGame.moveNumber}/{localGame.maxMoves}</Text><Text style={styles.moveLabel}>HAMLE</Text></View>
            <OnlineScore label="RAKİP" score={localGame.rivalScore} color="#FF6680" active={localGame.turn === 'rival' && !localGame.isComplete} />
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
        <View style={styles.scrim}><View style={styles.resultCard}><Text style={styles.resultIcon}>{localGame && localGame.playerScore > localGame.rivalScore ? '✦' : '≈'}</Text><Text style={styles.resultTitle}>{resultTitle}</Text><Text style={styles.resultScore}>{localGame?.playerScore} : {localGame?.rivalScore}</Text><OnlineButton label="Ana sayfa" onPress={onBack} /></View></View>
      </Modal>
    </View>
  );
}

function OnlineIconButton({ label, symbol, onPress }: { label: string; symbol: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}><Text style={styles.iconText}>{symbol}</Text></Pressable>;
}

function OnlineScore({ label, score, color, active }: { label: string; score: number; color: string; active: boolean }) {
  return <View style={styles.score}><View style={[styles.scoreDot, { backgroundColor: color }, active && styles.scoreDotActive]} /><Text style={styles.scoreLabel}>{label}</Text><Text style={styles.scoreValue}>{score}</Text></View>;
}

function OnlineButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, paddingBottom: 20, backgroundColor: '#07111F', gap: 16 },
  topRow: { paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#13263B', borderWidth: 1, borderColor: '#25425C' },
  iconText: { color: '#F7FBFF', fontSize: 27, marginTop: -3 },
  kicker: { color: '#8FA8BD', fontSize: 10, fontWeight: '800', textAlign: 'center', letterSpacing: 1.2 },
  subtitle: { color: '#F7FBFF', fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  connection: { width: 12, height: 12, borderRadius: 6 },
  scoreCard: { minHeight: 84, borderRadius: 20, paddingHorizontal: 24, backgroundColor: '#0E2035', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#1B354E' },
  score: { minWidth: 60, alignItems: 'center' },
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
  button: { marginTop: 22, minHeight: 48, borderRadius: 15, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7FBFF' },
  buttonText: { color: '#0B253A', fontSize: 16, fontWeight: '800' },
  scrim: { flex: 1, backgroundColor: 'rgba(1, 8, 16, 0.76)', padding: 24, justifyContent: 'center' },
  resultCard: { borderRadius: 28, padding: 27, backgroundColor: '#10263D', borderWidth: 1, borderColor: '#35607E', alignItems: 'center' },
  resultIcon: { color: '#FFC857', fontSize: 42 },
  resultTitle: { color: '#F7FBFF', fontSize: 24, fontWeight: '800', marginTop: 8 },
  resultScore: { color: '#F7FBFF', fontSize: 42, fontWeight: '800', marginTop: 16 },
});

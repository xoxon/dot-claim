import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { io, type Socket } from 'socket.io-client';

import { useGameSounds } from '../audio';
import { GameBannerAd } from '../ads/GameBannerAd';
import { canConnect } from '../game/engine';
import type { Difficulty, GameState } from '../game/types';
import { MATCH_SERVER_URL } from '../profile/api';
import type { PlayerProfile } from '../profile/types';
import type { MatchColor, OnlineMatchResult, OnlineMatchState, OnlineMode } from '../online/types';
import { GameBoard } from './GameBoard';
import { Avatar } from './ProfileScreen';

const SERVER_URL = MATCH_SERVER_URL;

type ConnectionState = 'connecting' | 'waiting' | 'matched' | 'playing' | 'opponent_left' | 'error';

export function OnlineMatchScreen({ mode, difficulty, profile, token, soundEnabled, hapticsEnabled, onBack, onPlayAgain, onProfileUpdated, onMatchCompleted, hideBanner }: {
  mode: OnlineMode;
  difficulty: Difficulty;
  profile: PlayerProfile | null;
  token: string | null;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  onBack: () => void;
  onPlayAgain: () => void;
  onProfileUpdated: (profile: PlayerProfile) => void;
  onMatchCompleted: () => void;
  hideBanner: boolean;
}) {
  const { width } = useWindowDimensions();
  const socketRef = useRef<Socket | null>(null);
  const completeRef = useRef(false);
  const resultActionRef = useRef(false);
  const colorRef = useRef<MatchColor | null>(null);
  const lastMoveRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [match, setMatch] = useState<OnlineMatchState | null>(null);
  const [color, setColor] = useState<MatchColor | null>(null);
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState(false);
  const [rollingDice, setRollingDice] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const [result, setResult] = useState<OnlineMatchResult | null>(null);
  const [inspectedProfile, setInspectedProfile] = useState<PlayerProfile | null>(null);
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
      socket.emit('find_match', { difficulty, mode });
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
      setRollingDice(false);
      setSelectedDotId(null);
      setMatch(state);
    });
    socket.on('match_complete', (nextResult: OnlineMatchResult) => {
      if (completeRef.current) return;
      completeRef.current = true;
      resultActionRef.current = false;
      setPendingMove(false);
      setRollingDice(false);
      setSelectedDotId(null);
      setMatch((current) => current?.roomId === nextResult.roomId ? {
        ...current,
        scores: nextResult.scores,
        players: nextResult.players,
        isComplete: true,
      } : current);
      const assignedColor = colorRef.current;
      const outcome = !assignedColor || nextResult.winner === 'draw' ? 'draw' : nextResult.winner === assignedColor ? 'win' : 'loss';
      const nextProfile = Object.values(nextResult.players).find((candidate) => candidate.id === profile?.id) ?? (assignedColor ? nextResult.players[assignedColor] : null);
      if (nextProfile) onProfileUpdated(nextProfile);
      setResult(nextResult);
      playSound(outcome === 'win' ? 'victory' : 'defeat');
      haptic(outcome === 'win' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
      setResultVisible(true);
    });
    socket.on('move_rejected', ({ message }: { message: string }) => {
      setPendingMove(false);
      setRollingDice(false);
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
  }, [difficulty, haptic, mode, onMatchCompleted, onProfileUpdated, playSound, profile, token]);

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
    const diceTurnReady = match?.mode !== 'dice' || (match.diceValue !== null && match.movesRemaining > 0);
    if (!localGame || !match || !color || connection !== 'playing' || localGame.turn !== 'player' || pendingMove || localGame.isComplete || !diceTurnReady) return;
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

  const rollDice = () => {
    if (!match || !color || match.mode !== 'dice' || connection !== 'playing' || match.turn !== color || match.diceValue !== null || match.movesRemaining > 0 || rollingDice) return;
    setRollingDice(true);
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    socketRef.current?.emit('roll_dice', { roomId: match.roomId });
  };

  // The result card must stay interactive. Showing the rewarded-ad modal while
  // it is open places two native modals on top of each other and traps touches.
  // Queue the ad only after the player chooses where to continue.
  const continueAfterResult = useCallback((next: () => void) => {
    if (resultActionRef.current) return;
    resultActionRef.current = true;
    setResultVisible(false);
    onMatchCompleted();
    next();
  }, [onMatchCompleted]);

  const isDiceMatch = match?.mode === 'dice';
  const title = connection === 'connecting' ? 'Sunucuya bağlanılıyor…'
      : connection === 'waiting' ? 'Rakip aranıyor…'
      : connection === 'matched' ? 'Rakibin bulundu!'
      : connection === 'opponent_left' ? 'Rakip ayrıldı.'
        : connection === 'error' ? 'Bağlantı kurulamadı.'
          : localGame?.isComplete ? 'Eşleşme tamamlandı.'
            : isDiceMatch && localGame ? localGame.turn === 'player'
              ? match?.diceValue === null ? (rollingDice ? 'Zar atılıyor…' : 'Sıran. Önce zarı at.') : `Zarın ${match.diceValue}. ${match.movesRemaining} çizgi hakkın kaldı.`
              : match?.diceValue === null ? 'Rakibin zar atması bekleniyor…' : `Rakibin zarı ${match.diceValue}. ${match.movesRemaining} çizgi hakkı var.`
            : localGame?.turn === 'player' ? (selectedDotId ? 'İkinci noktayı seç.' : 'Senin sıran.') : 'Rakibin hamlesi bekleniyor…';

  const player = color && match ? match.players[color] : profile;
  const opponent = color && match ? match.players[color === 'blue' ? 'red' : 'blue'] : null;
  const resultColor: MatchColor | null = result && profile
    ? result.players.blue.id === profile.id ? 'blue' : result.players.red.id === profile.id ? 'red' : color
    : color;
  const didWin = Boolean(result && resultColor && result.winner === resultColor);
  const didDraw = result?.winner === 'draw';
  const ownReward = result && resultColor ? result.rewards[resultColor] : null;
  const resultOpponent = result && resultColor ? result.players[resultColor === 'blue' ? 'red' : 'blue'] : opponent;
  const finalPlayerScore = result && resultColor ? result.scores[resultColor] : localGame?.playerScore;
  const finalOpponentScore = result && resultColor ? result.scores[resultColor === 'blue' ? 'red' : 'blue'] : localGame?.rivalScore;
  const resultTitle = didWin ? 'Eşleşmeyi kazandın!' : didDraw ? 'Eşleşme berabere.' : 'Rövanş vakti.';
  return (
    <View style={styles.screen}>
      <View style={styles.topRow}>
        <OnlineIconButton label="Çevrimiçi eşleşmeden çık" symbol="‹" onPress={onBack} />
        <View><Text style={styles.kicker}>{mode === 'dice' ? 'ZARLI DÜELLO' : 'ÇEVRİMİÇİ EŞLEŞME'}</Text><Text style={styles.subtitle}>{difficulty === 'easy' ? 'Rahat' : difficulty === 'hard' ? 'Usta' : 'Dengeli'}</Text></View>
        <View style={[styles.connection, { backgroundColor: connection === 'playing' ? '#38D5AA' : connection === 'error' || connection === 'opponent_left' ? '#FF6680' : '#FFC857' }]} />
      </View>

      {connection === 'matched' && color && match ? (
        <MatchLobby match={match} color={color} onStart={startMatch} onInspectProfile={setInspectedProfile} />
      ) : localGame ? (
        <>
          <View style={styles.scoreCard}>
            <OnlineScore label="SEN" name={player?.displayName ?? 'Sen'} profile={player} score={localGame.playerScore} color="#58C7FF" active={localGame.turn === 'player' && !localGame.isComplete} onInspectProfile={setInspectedProfile} />
            <View style={styles.moves}><Text style={styles.moveValue}>{localGame.moveNumber}/{localGame.maxMoves}</Text><Text style={styles.moveLabel}>HAMLE</Text></View>
            <OnlineScore label="RAKİP" name={opponent?.displayName ?? 'Rakip'} profile={opponent} score={localGame.rivalScore} color="#FF6680" active={localGame.turn === 'rival' && !localGame.isComplete} onInspectProfile={setInspectedProfile} />
          </View>
          <View style={styles.status}><View style={[styles.statusLight, { backgroundColor: localGame.turn === 'player' ? '#58C7FF' : '#FF6680' }]} /><Text style={styles.statusText}>{title}</Text></View>
          {isDiceMatch ? <DiceTurnCard diceValue={match.diceValue} movesRemaining={match.movesRemaining} isYourTurn={match.turn === color} rolling={rollingDice} onRoll={rollDice} /> : null}
          <GameBoard dots={localGame.dots} edges={localGame.edges} triangles={localGame.triangles} selectedDotId={selectedDotId} disabled={localGame.turn !== 'player' || pendingMove || localGame.isComplete || connection !== 'playing' || (isDiceMatch && (match.diceValue === null || match.movesRemaining <= 0))} size={boardSize} onDotPress={onDotPress} />
          <Text style={styles.rule}>Hamleler sunucuda doğrulanır; iki oyuncu da aynı tahtayı anlık görür.</Text>
          <GameBannerAd hidden={hideBanner || resultVisible || inspectedProfile !== null || connection !== 'playing'} />
        </>
      ) : (
        <View style={styles.waitingCard}>
          <Text style={styles.waitingSymbol}>{connection === 'error' ? '!' : '◌'}</Text>
          <Text style={styles.waitingTitle}>{title}</Text>
          <Text style={styles.waitingText}>{connection === 'waiting' || connection === 'connecting' ? 'Başka bir oyuncu eşleşmeye katıldığında oyun otomatik başlar.' : SERVER_URL ? `Sunucu adresini kontrol edin: ${SERVER_URL}` : 'Çevrimiçi sunucu adresi bu sürüme henüz tanımlanmadı.'}</Text>
          {(connection === 'error' || connection === 'opponent_left') && <OnlineButton label="Ana sayfaya dön" onPress={onBack} />}
        </View>
      )}

      <Modal transparent animationType="fade" visible={resultVisible} onRequestClose={() => continueAfterResult(onBack)}>
        <View style={styles.scrim}>
          <View style={styles.resultCard}>
            <Text style={styles.resultIcon}>{didWin ? '✦' : didDraw ? '≈' : '◌'}</Text>
            <Text style={styles.resultTitle}>{resultTitle}</Text>
            <Text style={styles.resultOpponent}>{resultOpponent ? `${resultOpponent.displayName} ile oynadın` : 'Maç sonucu sunucuda kaydedildi'}</Text>
            <Text style={styles.resultScore}>{finalPlayerScore ?? 0} : {finalOpponentScore ?? 0}</Text>
            {ownReward && <View style={styles.rewards}>
              <Reward label="KUPA" value={ownReward.trophyDelta} symbol="🏆" color="#FFC857" />
              <Reward label="ALTIN" value={ownReward.coinDelta} symbol="✦" color="#F6C84E" />
              <Reward label="XP" value={ownReward.xpDelta} symbol="+" color="#58C7FF" />
            </View>}
            {ownReward?.streakBonus ? <Text style={styles.streakBonus}>3 maçlık seri bonusu: +{ownReward.streakBonus} altın</Text> : null}
            {result?.reason === 'forfeit' && didWin ? <Text style={styles.forfeit}>Rakip ayrıldığı için galibiyet senin.</Text> : null}
            <View style={styles.resultActions}>
              <OnlineButton label="Tekrar oyna" onPress={() => continueAfterResult(onPlayAgain)} compact />
              <OnlineButton label="Ana sayfa" onPress={() => continueAfterResult(onBack)} compact />
            </View>
          </View>
        </View>
      </Modal>

      <PlayerProfileModal profile={inspectedProfile} onClose={() => setInspectedProfile(null)} />
    </View>
  );
}

function DiceTurnCard({ diceValue, movesRemaining, isYourTurn, rolling, onRoll }: { diceValue: number | null; movesRemaining: number; isYourTurn: boolean; rolling: boolean; onRoll: () => void }) {
  const canRoll = isYourTurn && diceValue === null && !rolling;
  const label = diceValue === null
    ? isYourTurn ? (rolling ? 'Zar atılıyor…' : 'Bu tur için zarı at') : 'Rakibin zar atmasını bekle'
    : isYourTurn ? `${movesRemaining} çizgi hakkın kaldı` : `Rakibin ${movesRemaining} çizgi hakkı kaldı`;
  return <View style={[styles.diceTurnCard, isYourTurn && styles.diceTurnCardActive]}>
    <View style={styles.diceFace}><Text style={styles.diceFaceText}>{diceValue ? diceFace(diceValue) : '⚄'}</Text></View>
    <View style={styles.diceCopy}><Text style={styles.diceKicker}>{diceValue ? `ZAR ${diceValue}` : 'ZAR TURU'}</Text><Text style={styles.diceText}>{label}</Text></View>
    {canRoll ? <Pressable accessibilityRole="button" accessibilityLabel="Zarı at" onPress={onRoll} style={({ pressed }) => [styles.rollButton, pressed && styles.pressed]}><Text style={styles.rollButtonText}>Zarı at</Text></Pressable> : null}
  </View>;
}

function diceFace(value: number) {
  return ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][value - 1] ?? '⚄';
}

function MatchLobby({ match, color, onStart, onInspectProfile }: { match: OnlineMatchState; color: MatchColor; onStart: () => void; onInspectProfile: (profile: PlayerProfile) => void }) {
  const opponentColor: MatchColor = color === 'blue' ? 'red' : 'blue';
  const youReady = match.ready[color];
  const opponentReady = match.ready[opponentColor];
  return <View style={styles.lobbyCard}>
    <Text style={styles.lobbyEyebrow}>EŞLEŞME BULUNDU</Text>
    <Text style={styles.lobbyTitle}>Hazır mısınız?</Text>
    <Text style={styles.lobbyText}>{match.mode === 'dice' ? 'Her tur zarı atıp gelen sayı kadar çizgi çizeceksiniz.' : 'Tahta, iki oyuncu da oyuna hazır olduğunda açılır.'}</Text>
    <View style={styles.lobbyPlayers}>
      <LobbyPlayer label="SEN" profile={match.players[color]} ready={youReady} color="#58C7FF" onInspectProfile={onInspectProfile} />
      <Text style={styles.vs}>VS</Text>
      <LobbyPlayer label="RAKİP" profile={match.players[opponentColor]} ready={opponentReady} color="#FF6680" onInspectProfile={onInspectProfile} />
    </View>
    <View style={[styles.readyHint, opponentReady && styles.readyHintActive]}>
      <View style={[styles.readyLight, { backgroundColor: opponentReady ? '#3DD6B8' : '#FFC857' }]} />
      <Text style={styles.readyHintText}>{opponentReady ? 'Rakibin hazır. Senin onayın bekleniyor.' : 'Rakibinin hazır olmasını bekliyorsun.'}</Text>
    </View>
    <OnlineButton label={youReady ? 'Hazırsın · Rakip bekleniyor' : 'Oyuna başla'} onPress={onStart} disabled={youReady} />
  </View>;
}

function LobbyPlayer({ label, profile, ready, color, onInspectProfile }: { label: string; profile: PlayerProfile; ready: boolean; color: string; onInspectProfile: (profile: PlayerProfile) => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${profile.displayName} profilini aç`} onPress={() => onInspectProfile(profile)} style={styles.lobbyPlayer}>
    <View style={[styles.lobbyAvatarRing, { borderColor: color }]}><Avatar profile={profile} size={72} /></View>
    <Text style={styles.lobbyPlayerLabel}>{label}</Text>
    <Text numberOfLines={1} style={styles.lobbyPlayerName}>{profile.displayName}</Text>
    <View style={[styles.playerReady, ready && styles.playerReadyActive]}><Text style={[styles.playerReadyText, ready && styles.playerReadyTextActive]}>{ready ? 'Hazır' : 'Bekliyor'}</Text></View>
  </Pressable>;
}

function OnlineIconButton({ label, symbol, onPress }: { label: string; symbol: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}><Text style={styles.iconText}>{symbol}</Text></Pressable>;
}

function OnlineScore({ label, name, profile, score, color, active, onInspectProfile }: { label: string; name: string; profile: PlayerProfile | null; score: number; color: string; active: boolean; onInspectProfile: (profile: PlayerProfile) => void }) {
  return <Pressable accessibilityRole={profile ? 'button' : undefined} accessibilityLabel={profile ? `${name} profilini aç` : undefined} disabled={!profile} onPress={() => profile && onInspectProfile(profile)} style={[styles.score, active && styles.scoreActive]}>
    {profile ? <View style={[styles.scoreAvatarRing, { borderColor: color }]}><Avatar profile={profile} size={46} /></View> : <View style={[styles.scoreDot, { backgroundColor: color }]} />}
    <Text numberOfLines={1} style={styles.scoreName}>{name}</Text>
    <Text style={styles.scoreLabel}>{label}</Text><Text style={styles.scoreValue}>{score}</Text>
  </Pressable>;
}

function PlayerProfileModal({ profile, onClose }: { profile: PlayerProfile | null; onClose: () => void }) {
  if (!profile) return null;
  const achievements = [
    { icon: '✦', title: 'İlk adım', detail: 'İlk çevrimiçi maçı tamamla.', unlocked: profile.gamesPlayed >= 1 },
    { icon: '⚡', title: 'Seri ustası', detail: '3 maçlık galibiyet serisine ulaş.', unlocked: profile.bestWinStreak >= 3 },
    { icon: '♛', title: 'Yükselen yıldız', detail: 'Gümüş lige yüksel.', unlocked: profile.trophies >= 300 },
  ];
  return <Modal transparent animationType="fade" visible onRequestClose={onClose}>
    <View style={styles.profileScrim}>
      <View style={styles.profileModal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Profili kapat" onPress={onClose} style={styles.profileClose}><Text style={styles.profileCloseText}>×</Text></Pressable>
        <View style={[styles.modalAvatarRing, { borderColor: profile.league.color }]}><Avatar profile={profile} size={96} /></View>
        <Text style={styles.modalName}>{profile.displayName}</Text>
        <Text style={[styles.modalLeague, { color: profile.league.color }]}>{profile.league.name.toUpperCase()} LİGİ · SEVİYE {profile.level}</Text>
        <View style={styles.modalTrophies}><Text style={styles.modalTrophyValue}>🏆 {profile.trophies}</Text><Text style={styles.modalTrophyLabel}>KUPA</Text></View>
        <View style={styles.profileStats}>
          <ProfileMetric value={profile.gamesPlayed} label="Maç" />
          <ProfileMetric value={profile.wins} label="Galibiyet" color="#3DD6B8" />
          <ProfileMetric value={profile.losses} label="Mağlubiyet" color="#FF6680" />
          <ProfileMetric value={profile.bestWinStreak} label="En iyi seri" color="#B27BFF" />
        </View>
        <Text style={styles.achievementsTitle}>Başarılar</Text>
        <View style={styles.achievementList}>{achievements.map((achievement) => <AchievementRow key={achievement.title} {...achievement} />)}</View>
        <OnlineButton label="Maça dön" onPress={onClose} />
      </View>
    </View>
  </Modal>;
}

function ProfileMetric({ value, label, color = '#F7FBFF' }: { value: number; label: string; color?: string }) {
  return <View style={styles.profileMetric}><Text style={[styles.profileMetricValue, { color }]}>{value}</Text><Text style={styles.profileMetricLabel}>{label}</Text></View>;
}

function AchievementRow({ icon, title, detail, unlocked }: { icon: string; title: string; detail: string; unlocked: boolean }) {
  return <View style={[styles.achievementRow, !unlocked && styles.achievementLocked]}><Text style={styles.achievementIcon}>{unlocked ? icon : '🔒'}</Text><View style={styles.achievementCopy}><Text style={styles.achievementName}>{title}</Text><Text style={styles.achievementDetail}>{detail}</Text></View><Text style={[styles.achievementState, unlocked && styles.achievementStateUnlocked]}>{unlocked ? 'Açık' : 'Kilitli'}</Text></View>;
}

function Reward({ label, value, symbol, color }: { label: string; value: number; symbol: string; color: string }) {
  return <View style={styles.reward}><Text style={[styles.rewardValue, { color }]}>{symbol} {value > 0 ? '+' : ''}{value}</Text><Text style={styles.rewardLabel}>{label}</Text></View>;
}

function OnlineButton({ label, onPress, disabled = false, compact = false }: { label: string; onPress: () => void; disabled?: boolean; compact?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.button, compact && styles.compactButton, disabled && styles.buttonDisabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, paddingBottom: 20, backgroundColor: '#07111F', gap: 16 },
  topRow: { paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#13263B', borderWidth: 1, borderColor: '#25425C' },
  iconText: { color: '#F7FBFF', fontSize: 27, marginTop: -3 },
  kicker: { color: '#8FA8BD', fontSize: 10, fontWeight: '800', textAlign: 'center', letterSpacing: 1.2 },
  subtitle: { color: '#F7FBFF', fontSize: 16, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  connection: { width: 12, height: 12, borderRadius: 6 },
  scoreCard: { minHeight: 130, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#0E2035', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#1B354E' },
  score: { flex: 1, minWidth: 0, alignItems: 'center', borderRadius: 14, paddingVertical: 2 },
  scoreActive: { backgroundColor: '#123047' },
  scoreAvatarRing: { padding: 2, borderRadius: 27, borderWidth: 2 },
  scoreName: { maxWidth: '100%', color: '#C8D9E7', fontSize: 10, fontWeight: '800', marginTop: 4 },
  scoreDot: { width: 18, height: 18, borderRadius: 9, marginBottom: 4 },
  scoreLabel: { color: '#91A5B9', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  scoreValue: { color: '#F7FBFF', fontSize: 28, fontWeight: '800', marginTop: -1 },
  moves: { minWidth: 70, alignItems: 'center', paddingHorizontal: 11, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#294159' },
  moveValue: { color: '#D5E1EB', fontSize: 16, fontWeight: '800' },
  moveLabel: { color: '#71879B', fontSize: 9, fontWeight: '800', letterSpacing: 0.9, marginTop: 2 },
  status: { minHeight: 44, paddingHorizontal: 15, borderRadius: 14, backgroundColor: '#0B1C2E', borderWidth: 1, borderColor: '#1B354E', flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusLight: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#D8E5EF', fontSize: 13, fontWeight: '600', flex: 1 },
  diceTurnCard: { minHeight: 68, padding: 10, borderRadius: 17, backgroundColor: '#171D3D', borderWidth: 1, borderColor: '#383D78', flexDirection: 'row', alignItems: 'center', gap: 10 },
  diceTurnCardActive: { backgroundColor: '#24204C', borderColor: '#7666CD' },
  diceFace: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#E8E2FF', alignItems: 'center', justifyContent: 'center' },
  diceFaceText: { color: '#322369', fontSize: 29, lineHeight: 33 },
  diceCopy: { flex: 1, minWidth: 0 },
  diceKicker: { color: '#BBAFFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  diceText: { color: '#E9E8F8', fontSize: 12, fontWeight: '700', marginTop: 3 },
  rollButton: { minHeight: 38, borderRadius: 12, paddingHorizontal: 13, backgroundColor: '#E7E1FF', alignItems: 'center', justifyContent: 'center' },
  rollButtonText: { color: '#35256F', fontSize: 12, fontWeight: '900' },
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
  lobbyAvatarRing: { padding: 3, borderRadius: 42, borderWidth: 2 },
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
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  scrim: { flex: 1, backgroundColor: 'rgba(1, 8, 16, 0.76)', padding: 24, justifyContent: 'center' },
  profileScrim: { flex: 1, backgroundColor: 'rgba(1, 8, 16, 0.82)', padding: 20, justifyContent: 'center' },
  profileModal: { maxWidth: 460, alignSelf: 'center', width: '100%', borderRadius: 28, padding: 22, backgroundColor: '#10263D', borderWidth: 1, borderColor: '#35607E', alignItems: 'center' },
  profileClose: { position: 'absolute', top: 13, right: 13, zIndex: 1, width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18354D' },
  profileCloseText: { color: '#EAF4FA', fontSize: 27, lineHeight: 29, fontWeight: '400', marginTop: -3 },
  modalAvatarRing: { padding: 4, borderRadius: 54, borderWidth: 3 },
  modalName: { color: '#F7FBFF', fontSize: 23, fontWeight: '900', marginTop: 10 },
  modalLeague: { fontSize: 10, letterSpacing: 1.1, fontWeight: '900', marginTop: 4 },
  modalTrophies: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 12 },
  modalTrophyValue: { color: '#FFD36F', fontSize: 20, fontWeight: '900' },
  modalTrophyLabel: { color: '#9CB5C9', fontSize: 10, letterSpacing: 0.8, fontWeight: '900' },
  profileStats: { width: '100%', flexDirection: 'row', gap: 7, marginTop: 16 },
  profileMetric: { flex: 1, minHeight: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1C2E' },
  profileMetricValue: { fontSize: 17, fontWeight: '900' },
  profileMetricLabel: { color: '#8FA8BD', fontSize: 8, fontWeight: '800', marginTop: 2, textAlign: 'center' },
  achievementsTitle: { width: '100%', color: '#F1F7FB', fontSize: 16, fontWeight: '900', marginTop: 19, marginBottom: 8 },
  achievementList: { width: '100%', gap: 7 },
  achievementRow: { minHeight: 51, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#12382F', flexDirection: 'row', alignItems: 'center', gap: 8 },
  achievementLocked: { backgroundColor: '#17293A', opacity: 0.72 },
  achievementIcon: { width: 22, textAlign: 'center', fontSize: 16 },
  achievementCopy: { flex: 1 },
  achievementName: { color: '#EEF7FC', fontSize: 12, fontWeight: '900' },
  achievementDetail: { color: '#A4BBCA', fontSize: 10, marginTop: 2 },
  achievementState: { color: '#91A5B9', fontSize: 10, fontWeight: '900' },
  achievementStateUnlocked: { color: '#58E0B8' },
  resultCard: { borderRadius: 28, padding: 27, backgroundColor: '#10263D', borderWidth: 1, borderColor: '#35607E', alignItems: 'center' },
  resultIcon: { color: '#FFC857', fontSize: 42 },
  resultTitle: { color: '#F7FBFF', fontSize: 24, fontWeight: '800', marginTop: 8 },
  resultOpponent: { color: '#ACC1D1', fontSize: 14, marginTop: 6, textAlign: 'center' },
  resultScore: { color: '#F7FBFF', fontSize: 42, fontWeight: '800', marginTop: 16 },
  resultActions: { width: '100%', flexDirection: 'row', gap: 10, marginTop: 22 },
  compactButton: { flex: 1, marginTop: 0, paddingHorizontal: 10 },
  rewards: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 18 },
  reward: { flex: 1, minHeight: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B1C2E', borderWidth: 1, borderColor: '#24435C' },
  rewardValue: { fontSize: 15, fontWeight: '900' },
  rewardLabel: { color: '#8FA8BD', fontSize: 9, letterSpacing: 0.8, fontWeight: '800', marginTop: 3 },
  streakBonus: { color: '#F6CF68', fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 12 },
  forfeit: { color: '#B8CCDA', fontSize: 12, textAlign: 'center', marginTop: 12 },
});

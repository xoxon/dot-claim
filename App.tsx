import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { useGameSounds } from './src/audio';
import { GameBoard } from './src/components/GameBoard';
import { OnlineMatchScreen } from './src/components/OnlineMatchScreen';
import { ProfileScreen } from './src/components/ProfileScreen';
import { GameBannerAd } from './src/ads/GameBannerAd';
import { isUsingTestAds, prepareGoogleMobileAds, RewardedAdOffer, type RewardOffer, type RewardOfferTrigger } from './src/ads/RewardedAdOffer';
import { PLAYER_COLOR, RIVAL_COLOR, canConnect, createGame, pickRivalMove, playMove } from './src/game/engine';
import { getLevelLabel } from './src/game/levels';
import { loadStats, saveStats } from './src/storage';
import { DEFAULT_STATS, type Difficulty, type GameState, type PlayerStats } from './src/game/types';
import { loadAuthenticatedProfile } from './src/profile/api';
import type { PlayerProfile } from './src/profile/types';
import type { OnlineMode } from './src/online/types';

type Screen = 'home' | 'game' | 'online' | 'profile';

const DIFFICULTY_COPY: Record<Difficulty, { title: string; subtitle: string }> = {
  easy: { title: 'Rahat', subtitle: 'Daha geniş hamle hakkı' },
  normal: { title: 'Dengeli', subtitle: 'Akıllı rakip' },
  hard: { title: 'Usta', subtitle: 'Az hamle, keskin rakip' },
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [stats, setStats] = useState<PlayerStats>(DEFAULT_STATS);
  const statsRef = useRef<PlayerStats>(DEFAULT_STATS);
  const [ready, setReady] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [gameConfig, setGameConfig] = useState<{ level: number; isDaily: boolean }>({ level: 1, isDaily: false });
  const [onlineSession, setOnlineSession] = useState(0);
  const [onlineMode, setOnlineMode] = useState<OnlineMode>('classic');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [account, setAccount] = useState<{ token: string; profile: PlayerProfile } | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [rewardOffer, setRewardOffer] = useState<RewardOffer | null>(null);

  useEffect(() => {
    loadStats().then((stored) => {
      statsRef.current = stored;
      setStats(stored);
      setReady(true);
    });
  }, []);

  const connectProfile = useCallback(async () => {
    setProfileError(null);
    try {
      const nextAccount = await loadAuthenticatedProfile();
      setAccount(nextAccount);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bilinmeyen bağlantı hatası.';
      console.warn('Profil bağlantısı kurulamadı:', message);
      setProfileError(message);
    }
  }, []);

  useEffect(() => {
    void connectProfile();
  }, [connectProfile]);

  useEffect(() => {
    if (!ready) return;
    void prepareGoogleMobileAds().catch((error) => {
      console.warn('Reklam servisi başlatılamadı:', error);
    });
  }, [ready]);

  const updateStats = useCallback((updater: (current: PlayerStats) => PlayerStats) => {
    setStats((current) => {
      const next = updater(current);
      statsRef.current = next;
      void saveStats(next);
      return next;
    });
  }, []);

  const startGame = useCallback((level: number, isDaily = false) => {
    setGameConfig({ level, isDaily });
    setScreen('game');
  }, []);

  const startOnlineMatch = useCallback((mode: OnlineMode = 'classic') => {
    setOnlineMode(mode);
    setOnlineSession((current) => current + 1);
    setScreen('online');
  }, []);

  const showRewardOffer = useCallback((trigger: RewardOfferTrigger) => {
    setRewardOffer((current) => current ?? { id: `${trigger}-${Date.now()}`, trigger });
  }, []);

  const onGameCompleted = useCallback((game: GameState) => {
    const won = game.playerScore > game.rivalScore;
    const tied = game.playerScore === game.rivalScore;
    const today = localDate();
    const current = statsRef.current;
    const levelStars = won ? (game.playerScore - game.rivalScore >= 2 ? 3 : 2) : tied ? 1 : 0;
    const completedNewLevel = won && !game.isDaily && !current.completedLevels.includes(game.level);
    const completedLevels = completedNewLevel ? [...current.completedLevels, game.level] : current.completedLevels;
    const previousStars = current.starsByLevel[String(game.level)] ?? 0;
    const lastDaily = current.lastDailyDate;
    const isNewDaily = game.isDaily && lastDaily !== today;
    const yesterday = localDate(-1);
    // A reward opportunity is earned after every two completed regular games.
    // This deliberately includes retries and losses; level-unlock progress above
    // remains win-only, but ad cadence must reflect actual games played.
    const gameProgress = !game.isDaily
      ? current.completedLevelsSinceRewardOffer + 1
      : current.completedLevelsSinceRewardOffer;
    const levelOfferDue = gameProgress >= 2;
    // Every completed daily challenge gets one offer after its result screen.
    // This is intentionally separate from the daily streak: replaying today's
    // board should still show the one ad opportunity for that completed run.
    const dailyOfferDue = game.isDaily;
    const next: PlayerStats = {
      ...current,
      completedLevels,
      starsByLevel: !game.isDaily ? { ...current.starsByLevel, [String(game.level)]: Math.max(previousStars, levelStars) } : current.starsByLevel,
      wins: current.wins + (won ? 1 : 0),
      losses: current.losses + (!won && !tied ? 1 : 0),
      dailyStreak: isNewDaily ? (lastDaily === yesterday ? current.dailyStreak + 1 : 1) : current.dailyStreak,
      lastDailyDate: game.isDaily ? today : current.lastDailyDate,
      completedLevelsSinceRewardOffer: levelOfferDue ? 0 : gameProgress,
      lastDailyRewardOfferDate: dailyOfferDue ? today : current.lastDailyRewardOfferDate,
    };
    updateStats(() => next);
    if (levelOfferDue) showRewardOffer('levels');
    if (dailyOfferDue) showRewardOffer('daily');
  }, [showRewardOffer, updateStats]);

  const onProfileUpdated = useCallback((profile: PlayerProfile) => {
    setAccount((current) => current ? { ...current, profile } : current);
  }, []);

  if (!ready) {
    return <SafeAreaProvider><LoadingScreen /></SafeAreaProvider>;
  }

  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar barStyle="light-content" />
          {screen === 'home' ? (
          <HomeScreen
            stats={stats}
            profile={account?.profile ?? null}
            difficulty={difficulty}
              onDifficultyChange={setDifficulty}
              onStart={startGame}
            onStartOnline={startOnlineMatch}
            onOpenProfile={() => setScreen('profile')}
              onOpenSettings={() => setSettingsVisible(true)}
            />
          ) : screen === 'game' ? (
            <GameScreen
              key={`${gameConfig.level}-${gameConfig.isDaily}-${difficulty}`}
              config={gameConfig}
              difficulty={difficulty}
              hapticsEnabled={stats.hapticsEnabled}
              soundEnabled={stats.soundEnabled}
              onBack={() => setScreen('home')}
              onComplete={onGameCompleted}
              onPlayAgain={() => startGame(gameConfig.level, gameConfig.isDaily)}
              hideBanner={Boolean(rewardOffer)}
            />
          ) : screen === 'online' ? (
            <OnlineMatchScreen
              key={onlineSession}
              mode={onlineMode}
              difficulty={difficulty}
              profile={account?.profile ?? null}
              token={account?.token ?? null}
              hapticsEnabled={stats.hapticsEnabled}
              soundEnabled={stats.soundEnabled}
              onBack={() => setScreen('home')}
              onPlayAgain={() => startOnlineMatch(onlineMode)}
              onProfileUpdated={onProfileUpdated}
              hideBanner={Boolean(rewardOffer)}
            />
          ) : account ? (
          <ProfileScreen
            profile={account.profile}
            token={account.token}
            onBack={() => setScreen('home')}
            onProfileUpdated={onProfileUpdated}
            onAccountDeleted={() => {
              setAccount(null);
              setScreen('home');
            }}
          />
        ) : (
          <View style={styles.accountLoading}>
            <Text style={styles.loadingText}>{profileError ? 'Profil bağlantısı kurulamadı.' : 'Profil sunucuya bağlanıyor…'}</Text>
            {profileError ? <Text style={styles.accountError}>{profileError}</Text> : null}
            <PrimaryButton label="Tekrar dene" onPress={() => void connectProfile()} />
            <SecondaryButton label="Ana sayfa" onPress={() => setScreen('home')} />
          </View>
        )}
          <SettingsModal
            visible={settingsVisible}
            stats={stats}
            onClose={() => setSettingsVisible(false)}
            onToggleHaptics={() => updateStats((current) => ({ ...current, hapticsEnabled: !current.hapticsEnabled }))}
            onToggleSound={() => updateStats((current) => ({ ...current, soundEnabled: !current.soundEnabled }))}
            onOpenTestAd={() => {
              setSettingsVisible(false);
              showRewardOffer('manual');
            }}
          />
        </SafeAreaView>
        <RewardedAdOffer
          offer={rewardOffer}
          onDismiss={() => setRewardOffer(null)}
          onRewardEarned={(offer, reward) => {
            Alert.alert('Test ödülü alındı', `${offer.trigger === 'manual' ? 'Test reklamı' : 'Ödüllü reklam'} tamamlandı: ${reward.amount} ${reward.type}. Gerçek oyun ödülünü sunucu doğrulamasına bağlamadan hesabına eklemeyeceğiz.`);
          }}
        />
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

function HomeScreen({ stats, profile, difficulty, onDifficultyChange, onStart, onStartOnline, onOpenProfile, onOpenSettings }: {
  stats: PlayerStats;
  profile: PlayerProfile | null;
  difficulty: Difficulty;
  onDifficultyChange: (difficulty: Difficulty) => void;
  onStart: (level: number, isDaily?: boolean) => void;
  onStartOnline: (mode: OnlineMode) => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
}) {
  const nextLevel = Math.max(1, ...(stats.completedLevels.length ? stats.completedLevels.map((level) => level + 1) : [1]));
  const visibleLevels = Array.from({ length: Math.max(12, nextLevel + 3) }, (_, index) => index + 1);
  return (
    <ScrollView contentContainerStyle={styles.homeScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.eyebrow}>DOT CLAIM</Text>
          <Text style={styles.homeTitle}>Noktaları bağla.{`\n`}Alanı sahiplen.</Text>
        </View>
        <View style={styles.homeActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Profilini aç" onPress={onOpenProfile} style={styles.profileButton}><Text style={styles.profileButtonText}>{profile ? profile.displayName.slice(0, 1).toLocaleUpperCase('tr-TR') : '●'}</Text></Pressable>
          <IconButton label="Ayarlar" symbol="⚙" onPress={onOpenSettings} />
        </View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroOrbOne} />
        <View style={styles.heroOrbTwo} />
        <Text style={styles.heroKicker}>SIRADAKİ HAMLE</Text>
        <Text style={styles.heroTitle}>Seviye {nextLevel}</Text>
        <Text style={styles.heroDescription}>Üç kenarı kapat, üçgeni sen al. Rakibin çizgilerini iyi oku.</Text>
        <PrimaryButton label="Oyuna başla" onPress={() => onStart(nextLevel)} />
      </View>

      <View style={styles.statsRow}>
        <StatCard value={`${stats.wins}`} label="Galibiyet" color={PLAYER_COLOR} />
        <StatCard value={`${stats.dailyStreak}`} label="Gün serisi" color="#FFC857" />
        <StatCard value={`${stats.completedLevels.length}`} label="Tamamlandı" color="#B27BFF" />
      </View>

      <Text style={styles.sectionTitle}>Zorluk</Text>
      <View style={styles.difficultyRow} accessibilityRole="radiogroup" accessibilityLabel="Zorluk seçimi">
        {(Object.keys(DIFFICULTY_COPY) as Difficulty[]).map((option) => {
          const active = difficulty === option;
          return (
            <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => onDifficultyChange(option)} style={[styles.difficultyButton, active && styles.difficultyButtonActive]}>
              <Text style={[styles.difficultyTitle, active && styles.difficultyTextActive]}>{DIFFICULTY_COPY[option].title}</Text>
              <Text style={[styles.difficultySubtitle, active && styles.difficultyTextActive]}>{DIFFICULTY_COPY[option].subtitle}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Günlük meydan okumayı başlat" onPress={() => onStart(1, true)} style={styles.dailyCard}>
        <View style={styles.dailyIcon}><Text style={styles.dailyIconText}>✦</Text></View>
        <View style={styles.grow}>
          <Text style={styles.dailyTitle}>Günlük meydan okuma</Text>
          <Text style={styles.dailySubtitle}>Bugünün tahtasını herkesten önce çöz.</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <Pressable accessibilityRole="button" accessibilityLabel="Klasik çevrimiçi rakip ara" onPress={() => onStartOnline('classic')} style={styles.onlineCard}>
        <View style={styles.onlineIcon}><Text style={styles.onlineIconText}>⌁</Text></View>
        <View style={styles.grow}>
          <Text style={styles.dailyTitle}>Klasik çevrimiçi</Text>
          <Text style={styles.dailySubtitle}>Her çizgide sıra değişen canlı düello.</Text>
        </View>
        <View style={styles.onlinePill}><Text style={styles.onlinePillText}>CANLI</Text></View>
      </Pressable>

      <Pressable accessibilityRole="button" accessibilityLabel="Zarlı düelloda rakip ara" onPress={() => onStartOnline('dice')} style={styles.diceOnlineCard}>
        <View style={styles.diceOnlineIcon}><Text style={styles.diceOnlineIconText}>⚄</Text></View>
        <View style={styles.grow}>
          <Text style={styles.dailyTitle}>Zarlı düello</Text>
          <Text style={styles.diceOnlineSubtitle}>Zarı at; gelen sayı kadar çizgi çiz.</Text>
        </View>
        <View style={styles.diceOnlinePill}><Text style={styles.diceOnlinePillText}>YENİ</Text></View>
      </Pressable>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Seviyeler</Text>
        <Text style={styles.sectionHint}>En iyi skorun kaydolur</Text>
      </View>
      <View style={styles.levelGrid}>
        {visibleLevels.map((level) => {
          const unlocked = level <= nextLevel;
          const stars = stats.starsByLevel[String(level)] ?? 0;
          return (
            <Pressable
              key={level}
              disabled={!unlocked}
              accessibilityRole="button"
              accessibilityLabel={`Seviye ${level}${unlocked ? '' : ', kilitli'}`}
              onPress={() => onStart(level)}
              style={[styles.levelButton, !unlocked && styles.levelButtonLocked, level === nextLevel && styles.levelButtonNext]}
            >
              <Text style={[styles.levelNumber, !unlocked && styles.levelNumberLocked]}>{unlocked ? level : '🔒'}</Text>
              <Text style={[styles.levelStars, !unlocked && styles.levelStarsLocked]}>{unlocked ? '★'.repeat(stars) || '—' : ''}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.footer}>Bağlantı çizgileri noktaların üzerinden geçemez.</Text>
    </ScrollView>
  );
}

function GameScreen({ config, difficulty, hapticsEnabled, soundEnabled, onBack, onComplete, onPlayAgain, hideBanner }: {
  config: { level: number; isDaily: boolean };
  difficulty: Difficulty;
  hapticsEnabled: boolean;
  soundEnabled: boolean;
  onBack: () => void;
  onComplete: (game: GameState) => void;
  onPlayAgain: () => void;
  hideBanner: boolean;
}) {
  const { width } = useWindowDimensions();
  const [game, setGame] = useState(() => createGame(config.level, difficulty, config.isDaily));
  const [resultVisible, setResultVisible] = useState(false);
  const completedRef = useRef(false);
  const boardSize = Math.min(Math.max(width - 32, 260), 500);
  const playSound = useGameSounds(soundEnabled);

  const haptic = useCallback((style: Haptics.ImpactFeedbackStyle) => {
    if (hapticsEnabled && Platform.OS !== 'web') void Haptics.impactAsync(style).catch(() => undefined);
  }, [hapticsEnabled]);

  useEffect(() => {
    if (game.turn !== 'rival' || game.isComplete) return undefined;
    const timer = setTimeout(() => {
      setGame((current) => {
        if (current.turn !== 'rival' || current.isComplete) return current;
        const move = pickRivalMove(current);
        if (!move) return { ...current, isComplete: true };
        const next = playMove(current, move[0], move[1], 'rival');
        playSound(next.rivalScore > current.rivalScore ? 'claim' : 'rival');
        return next;
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [game.turn, game.isComplete, playSound]);

  useEffect(() => {
    if (!game.isComplete || completedRef.current) return;
    completedRef.current = true;
    onComplete(game);
    setResultVisible(true);
    haptic(game.playerScore > game.rivalScore ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
    playSound(game.playerScore > game.rivalScore ? 'victory' : 'defeat');
  }, [game, haptic, onComplete, playSound]);

  const status = useMemo(() => {
    if (game.isComplete) return game.playerScore > game.rivalScore ? 'Tahtayı sen aldın!' : game.playerScore === game.rivalScore ? 'Berabere kaldınız.' : 'Rakip bu turu aldı.';
    if (game.turn === 'rival') return 'Rakip hamlesini düşünüyor…';
    return game.selectedDotId ? 'Bağlamak istediğin ikinci noktayı seç.' : 'Bir nokta seç ve çizgiyi başlat.';
  }, [game.isComplete, game.playerScore, game.rivalScore, game.selectedDotId, game.turn]);

  const onDotPress = (id: string) => {
    if (game.turn !== 'player' || game.isComplete) return;
    if (!game.selectedDotId) {
      setGame((current) => ({ ...current, selectedDotId: id }));
      haptic(Haptics.ImpactFeedbackStyle.Light);
      playSound('select');
      return;
    }
    if (game.selectedDotId === id) {
      setGame((current) => ({ ...current, selectedDotId: null }));
      return;
    }
    if (!canConnect(game, game.selectedDotId, id)) {
      haptic(Haptics.ImpactFeedbackStyle.Rigid);
      playSound('invalid');
      Alert.alert('Bu çizgi kullanılamaz', 'Nokta zaten bağlı veya çizgi başka bir noktanın üzerinden geçiyor.');
      return;
    }
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    const next = playMove(game, game.selectedDotId, id, 'player');
    playSound(next.playerScore > game.playerScore ? 'claim' : 'connect');
    setGame((current) => current.selectedDotId ? playMove(current, current.selectedDotId, id, 'player') : current);
  };

  const restart = () => {
    completedRef.current = false;
    setResultVisible(false);
    setGame(createGame(config.level, difficulty, config.isDaily));
  };

  return (
    <View style={styles.gameScreen}>
      <View style={styles.gameTopRow}>
        <IconButton label="Ana sayfaya dön" symbol="‹" onPress={onBack} />
        <View style={styles.gameTitleWrap}>
          <Text style={styles.gameKicker}>{getLevelLabel(config.level, config.isDaily).toUpperCase()}</Text>
          <Text style={styles.gameTitle}>{DIFFICULTY_COPY[difficulty].title}</Text>
        </View>
        <IconButton label="Tahtayı yeniden başlat" symbol="↻" onPress={restart} />
      </View>

      <View style={styles.scoreCard}>
        <ScoreSide color={PLAYER_COLOR} label="SEN" score={game.playerScore} active={game.turn === 'player' && !game.isComplete} />
        <View style={styles.moveBox}><Text style={styles.moveValue}>{game.moveNumber}/{game.maxMoves}</Text><Text style={styles.moveLabel}>HAMLE</Text></View>
        <ScoreSide color={RIVAL_COLOR} label="RAKİP" score={game.rivalScore} active={game.turn === 'rival' && !game.isComplete} />
      </View>

      <View style={styles.statusPill} accessibilityLiveRegion="polite"><View style={[styles.statusDot, { backgroundColor: game.turn === 'player' ? PLAYER_COLOR : RIVAL_COLOR }]} /><Text style={styles.statusText}>{status}</Text></View>
      <GameBoard dots={game.dots} edges={game.edges} triangles={game.triangles} selectedDotId={game.selectedDotId} disabled={game.turn !== 'player' || game.isComplete} size={boardSize} onDotPress={onDotPress} />
      <Text style={styles.ruleText}>Bir üçgeni kapatan çizgi, o alanı sahibine yazar. En yüksek puan kazanır.</Text>
      <View style={styles.legendRow}><Legend color={PLAYER_COLOR} label="Senin çizgilerin" /><Legend color={RIVAL_COLOR} label="Rakibin çizgileri" /></View>
      <GameBannerAd hidden={hideBanner || resultVisible} />

      <Modal transparent animationType="fade" visible={resultVisible} onRequestClose={() => setResultVisible(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.resultCard}>
            <Text style={styles.resultEmoji}>{game.playerScore > game.rivalScore ? '✦' : game.playerScore === game.rivalScore ? '≈' : '◌'}</Text>
            <Text style={styles.resultTitle}>{game.playerScore > game.rivalScore ? 'Harika hamle!' : game.playerScore === game.rivalScore ? 'Dengeli oyun!' : 'Rövanş vakti.'}</Text>
            <Text style={styles.resultText}>{status}</Text>
            <View style={styles.finalScore}><Text style={styles.finalScoreValue}>{game.playerScore}</Text><Text style={styles.finalScoreDivider}>:</Text><Text style={styles.finalScoreValue}>{game.rivalScore}</Text></View>
            <View style={styles.resultActions}>
              <ResultActionButton label="Tekrar oyna" onPress={restart} />
              <ResultActionButton label="Ana sayfa" onPress={onBack} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SettingsModal({ visible, stats, onClose, onToggleHaptics, onToggleSound, onOpenTestAd }: {
  visible: boolean;
  stats: PlayerStats;
  onClose: () => void;
  onToggleHaptics: () => void;
  onToggleSound: () => void;
  onOpenTestAd: () => void;
}) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalScrim}>
        <View style={styles.settingsCard}>
          <View style={styles.settingsHeader}><Text style={styles.settingsTitle}>Ayarlar</Text><IconButton label="Ayarları kapat" symbol="×" onPress={onClose} /></View>
          <SettingRow title="Dokunsal geri bildirim" subtitle="Hamlelerde titreşim" value={stats.hapticsEnabled} onChange={onToggleHaptics} />
          <SettingRow title="Ses efektleri" subtitle="Oyun hamleleri ve sonuçları" value={stats.soundEnabled} onChange={onToggleSound} />
          {isUsingTestAds ? <Pressable accessibilityRole="button" accessibilityLabel="Ödüllü test reklamını aç" onPress={onOpenTestAd} style={({ pressed }) => [styles.testAdButton, pressed && styles.pressed]}><Text style={styles.testAdTitle}>Ödüllü test reklamı</Text><Text style={styles.testAdText}>Google test reklamını şimdi kontrol et</Text></Pressable> : null}
          <Text style={styles.settingsFootnote}>Çevrimiçi profilin, avatarın ve maç ilerlemen eşleşme sunucusunda saklanır. Avatarını istediğin zaman değiştirebilirsin.</Text>
        </View>
      </View>
    </Modal>
  );
}

function AppErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundaryContent>{children}</ErrorBoundaryContent>;
}

class ErrorBoundaryContent extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <View style={styles.fatalScreen}><Text style={styles.fatalTitle}>Bir şey ters gitti.</Text><Text style={styles.fatalText}>Uygulamayı yeniden açmayı deneyin.</Text></View>;
    }
    return this.props.children;
  }
}

function LoadingScreen() {
  return <SafeAreaView style={styles.loadingScreen}><ActivityIndicator color={PLAYER_COLOR} size="large" /><Text style={styles.loadingText}>Tahta hazırlanıyor…</Text></SafeAreaView>;
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryButtonText}>{label}</Text></Pressable>;
}

function ResultActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.resultActionButton, pressed && styles.pressed]}><Text style={styles.resultActionButtonText}>{label}</Text></Pressable>;
}

function IconButton({ label, symbol, onPress }: { label: string; symbol: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={10} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><Text style={styles.iconButtonText}>{symbol}</Text></Pressable>;
}

function ScoreSide({ color, label, score, active }: { color: string; label: string; score: number; active: boolean }) {
  return <View style={styles.scoreSide}><View style={[styles.scoreDot, { backgroundColor: color }, active && styles.scoreDotActive]} /><Text style={styles.scoreLabel}>{label}</Text><Text style={styles.scoreValue}>{score}</Text></View>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <View style={styles.legend}><View style={[styles.legendLine, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

function StatCard({ value, label, color }: { value: string; label: string; color: string }) {
  return <View style={styles.statCard}><Text style={[styles.statValue, { color }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function SettingRow({ title, subtitle, value, onChange, disabled = false }: { title: string; subtitle: string; value: boolean; onChange: () => void; disabled?: boolean }) {
  return <View style={[styles.settingRow, disabled && styles.settingDisabled]}><View style={styles.grow}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingSubtitle}>{subtitle}</Text></View><Switch accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ false: '#314256', true: '#2676A2' }} thumbColor={value ? '#F7FBFF' : '#91A0B1'} /></View>;
}

function localDate(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#07111F' },
  loadingScreen: { flex: 1, backgroundColor: '#07111F', alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: '#B5C5D5', fontSize: 15, fontWeight: '600' },
  homeScroll: { padding: 20, paddingBottom: 42, gap: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  homeActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  profileButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#123A55', borderWidth: 1, borderColor: '#285E7E' },
  profileButtonText: { color: '#C9EBFA', fontSize: 16, fontWeight: '900' },
  eyebrow: { color: '#58C7FF', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  homeTitle: { color: '#F7FBFF', fontSize: 31, lineHeight: 37, fontWeight: '800', marginTop: 6, letterSpacing: -0.8 },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#13263B', borderWidth: 1, borderColor: '#25425C' },
  iconButtonText: { color: '#F7FBFF', fontSize: 25, fontWeight: '500', marginTop: -2 },
  heroCard: { borderRadius: 28, padding: 24, overflow: 'hidden', backgroundColor: '#144466', borderWidth: 1, borderColor: '#276E97' },
  heroOrbOne: { position: 'absolute', width: 230, height: 230, borderRadius: 115, backgroundColor: 'rgba(84,207,255,0.20)', top: -115, right: -70 },
  heroOrbTwo: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(178,123,255,0.20)', bottom: -80, left: -35 },
  heroKicker: { color: '#B5ECFF', fontSize: 11, fontWeight: '800', letterSpacing: 1.7 },
  heroTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', marginTop: 7 },
  heroDescription: { color: '#D4ECF8', fontSize: 15, lineHeight: 21, maxWidth: '82%', marginTop: 9, marginBottom: 22 },
  primaryButton: { alignSelf: 'flex-start', minHeight: 48, backgroundColor: '#F7FBFF', borderRadius: 15, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#0B253A', fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderRadius: 18, backgroundColor: '#0E2035', paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: '#1B354E' },
  statValue: { fontSize: 23, fontWeight: '800' },
  statLabel: { color: '#AABACB', fontSize: 11, fontWeight: '700', marginTop: 4 },
  sectionTitle: { color: '#F4F8FC', fontSize: 19, fontWeight: '800' },
  difficultyRow: { flexDirection: 'row', gap: 8 },
  difficultyButton: { flex: 1, minHeight: 76, padding: 11, justifyContent: 'center', borderRadius: 16, backgroundColor: '#0E2035', borderWidth: 1, borderColor: '#1B354E' },
  difficultyButtonActive: { backgroundColor: '#15415F', borderColor: '#58C7FF' },
  difficultyTitle: { color: '#D1DDE8', fontWeight: '800', fontSize: 14 },
  difficultySubtitle: { color: '#8196AA', fontSize: 10, lineHeight: 13, marginTop: 4 },
  difficultyTextActive: { color: '#F7FBFF' },
  dailyCard: { minHeight: 76, borderRadius: 20, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#211B43', borderWidth: 1, borderColor: '#43367A' },
  dailyIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#A782FF', alignItems: 'center', justifyContent: 'center' },
  dailyIconText: { color: '#FFFFFF', fontSize: 22 },
  grow: { flex: 1 },
  dailyTitle: { color: '#F7FBFF', fontSize: 16, fontWeight: '800' },
  dailySubtitle: { color: '#C2B5E8', fontSize: 12, marginTop: 3 },
  onlineCard: { minHeight: 76, borderRadius: 20, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#123B38', borderWidth: 1, borderColor: '#277C71' },
  onlineIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#37D3A8', alignItems: 'center', justifyContent: 'center' },
  onlineIconText: { color: '#05221E', fontSize: 25, fontWeight: '800' },
  onlinePill: { borderRadius: 10, backgroundColor: '#1B695B', paddingHorizontal: 8, paddingVertical: 5 },
  onlinePillText: { color: '#BFF5E8', fontSize: 9, letterSpacing: 0.8, fontWeight: '800' },
  diceOnlineCard: { minHeight: 76, borderRadius: 20, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#2A234B', borderWidth: 1, borderColor: '#6550AF' },
  diceOnlineIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#D9CBFF', alignItems: 'center', justifyContent: 'center' },
  diceOnlineIconText: { color: '#2D2160', fontSize: 28, fontWeight: '900', marginTop: -2 },
  diceOnlineSubtitle: { color: '#D3C8F5', fontSize: 12, marginTop: 3 },
  diceOnlinePill: { borderRadius: 10, backgroundColor: '#50418E', paddingHorizontal: 8, paddingVertical: 5 },
  diceOnlinePillText: { color: '#EEE9FF', fontSize: 9, letterSpacing: 0.8, fontWeight: '900' },
  chevron: { color: '#E4D9FF', fontSize: 32, fontWeight: '300' },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionHint: { color: '#8296AA', fontSize: 11 },
  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  levelButton: { width: '22.5%', aspectRatio: 1, borderRadius: 17, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: '#123350', borderWidth: 1, borderColor: '#27698F' },
  levelButtonNext: { backgroundColor: '#1D6E96', borderColor: '#82DDFF' },
  levelButtonLocked: { backgroundColor: '#0B1A2B', borderColor: '#162C42' },
  levelNumber: { color: '#F7FBFF', fontSize: 18, fontWeight: '800' },
  levelNumberLocked: { color: '#52677B', fontSize: 15 },
  levelStars: { color: '#FFC857', fontSize: 10, minHeight: 12 },
  levelStarsLocked: { color: '#52677B' },
  footer: { color: '#6F8599', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 2 },
  gameScreen: { flex: 1, paddingHorizontal: 16, paddingBottom: 20, backgroundColor: '#07111F', gap: 16 },
  gameTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 },
  gameTitleWrap: { alignItems: 'center' },
  gameKicker: { color: '#8FA8BD', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  gameTitle: { color: '#F7FBFF', fontSize: 16, fontWeight: '800', marginTop: 2 },
  scoreCard: { minHeight: 84, borderRadius: 20, paddingHorizontal: 24, backgroundColor: '#0E2035', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#1B354E' },
  scoreSide: { alignItems: 'center', minWidth: 60 },
  scoreDot: { width: 9, height: 9, borderRadius: 5, marginBottom: 5 },
  scoreDotActive: { transform: [{ scale: 1.5 }], shadowColor: '#FFFFFF', shadowOpacity: 0.8, shadowRadius: 5 },
  scoreLabel: { color: '#91A5B9', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  scoreValue: { color: '#F7FBFF', fontSize: 28, fontWeight: '800', marginTop: -1 },
  moveBox: { alignItems: 'center', paddingHorizontal: 18, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#294159' },
  moveValue: { color: '#D5E1EB', fontSize: 16, fontWeight: '800' },
  moveLabel: { color: '#71879B', fontSize: 9, fontWeight: '800', letterSpacing: 0.9, marginTop: 2 },
  statusPill: { minHeight: 44, paddingHorizontal: 15, borderRadius: 14, backgroundColor: '#0B1C2E', borderWidth: 1, borderColor: '#1B354E', flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#D8E5EF', fontSize: 13, fontWeight: '600', flex: 1 },
  ruleText: { color: '#9AB0C2', fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 14 },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 20 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 17, height: 4, borderRadius: 2 },
  legendText: { color: '#849AAE', fontSize: 11 },
  modalScrim: { flex: 1, backgroundColor: 'rgba(1, 8, 16, 0.76)', padding: 24, justifyContent: 'center' },
  resultCard: { borderRadius: 28, padding: 27, backgroundColor: '#10263D', borderWidth: 1, borderColor: '#35607E', alignItems: 'center' },
  resultEmoji: { fontSize: 42, color: '#FFC857' },
  resultTitle: { color: '#F7FBFF', fontSize: 26, fontWeight: '800', marginTop: 8 },
  resultText: { color: '#B6C9D9', fontSize: 15, marginTop: 7, textAlign: 'center' },
  finalScore: { flexDirection: 'row', alignItems: 'center', gap: 16, marginVertical: 24 },
  finalScoreValue: { color: '#F7FBFF', fontSize: 44, fontWeight: '800' },
  finalScoreDivider: { color: '#547086', fontSize: 35 },
  resultActions: { width: '100%', flexDirection: 'row', gap: 10 },
  resultActionButton: { flex: 1, minHeight: 48, borderRadius: 15, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7FBFF' },
  resultActionButtonText: { color: '#0B253A', fontSize: 14, fontWeight: '800' },
  secondaryButton: { minHeight: 44, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 12 },
  secondaryButtonText: { color: '#A8C9DE', fontSize: 15, fontWeight: '700' },
  settingsCard: { borderRadius: 28, padding: 22, backgroundColor: '#10263D', borderWidth: 1, borderColor: '#35607E' },
  settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  settingsTitle: { color: '#F7FBFF', fontSize: 25, fontWeight: '800' },
  settingRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderColor: '#27435D' },
  settingDisabled: { opacity: 0.55 },
  settingTitle: { color: '#E8F0F6', fontSize: 15, fontWeight: '700' },
  settingSubtitle: { color: '#8EA4B7', fontSize: 12, marginTop: 3 },
  testAdButton: { minHeight: 64, marginTop: 10, borderRadius: 15, paddingHorizontal: 15, justifyContent: 'center', backgroundColor: '#153A57', borderWidth: 1, borderColor: '#2C6E95' },
  testAdTitle: { color: '#E3F5FF', fontSize: 14, fontWeight: '800' },
  testAdText: { color: '#9DC9E1', fontSize: 12, marginTop: 3 },
  settingsFootnote: { color: '#7C94A9', fontSize: 12, lineHeight: 17, borderTopWidth: 1, borderColor: '#27435D', paddingTop: 16, marginTop: 1 },
  fatalScreen: { flex: 1, backgroundColor: '#07111F', alignItems: 'center', justifyContent: 'center', padding: 28 },
  fatalTitle: { color: '#F7FBFF', fontSize: 23, fontWeight: '800' },
  fatalText: { color: '#AABCCB', fontSize: 15, marginTop: 8 },
  accountLoading: { flex: 1, backgroundColor: '#07111F', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 },
  accountError: { color: '#FF9AAC', fontSize: 13, lineHeight: 19, textAlign: 'center' },
});

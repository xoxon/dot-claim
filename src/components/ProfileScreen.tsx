import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { deleteAccount, fetchLeaderboard, fetchMatchHistory, resolveAvatarUrl, updateDisplayName, uploadAvatar } from '../profile/api';
import type { LeaderboardEntry, MatchHistoryItem, PlayerProfile } from '../profile/types';

export function ProfileScreen({ profile, token, onBack, onProfileUpdated, onAccountDeleted }: {
  profile: PlayerProfile;
  token: string;
  onBack: () => void;
  onProfileUpdated: (profile: PlayerProfile) => void;
  onAccountDeleted: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<MatchHistoryItem[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const canChangeDisplayName = profile.canChangeDisplayName !== false;

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [nextLeaderboard, nextHistory] = await Promise.all([fetchLeaderboard(), fetchMatchHistory(token)]);
      setLeaderboard(nextLeaderboard);
      setHistory(nextHistory);
    } catch {
      // The editable profile remains usable if a non-critical list request fails.
    } finally {
      setLoadingData(false);
    }
  }, [token]);

  useEffect(() => {
    setDisplayName(profile.displayName);
  }, [profile.displayName]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const saveName = async () => {
    if (!canChangeDisplayName || savingName || displayName.trim() === profile.displayName) return;
    setSavingName(true);
    try {
      const updated = await updateDisplayName(token, displayName);
      onProfileUpdated(updated);
      setDisplayName(updated.displayName);
    } catch (error) {
      Alert.alert('Kullanıcı adı değişmedi', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    } finally {
      setSavingName(false);
    }
  };

  const confirmSaveName = () => {
    if (!canChangeDisplayName || savingName || displayName.trim() === profile.displayName) return;
    Alert.alert(
      'Kullanıcı adını sabitle',
      `“${displayName.trim()}” kullanıcı adı yalnızca bir kez ayarlanabilir. Onayladıktan sonra değiştirilemez.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Onayla ve sabitle', onPress: () => void saveName() },
      ],
    );
  };

  const pickAvatar = async () => {
    if (uploading) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Fotoğraf izni gerekli', 'Avatar seçebilmek için fotoğraf arşivi iznine izin verin.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      selectionLimit: 1,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset) return;
    const context = ImageManipulator.manipulate(asset.uri);
    context.resize({ width: 512, height: 512 });
    const image = await context.renderAsync();
    const compressed = await image.saveAsync({ base64: true, compress: 0.72, format: SaveFormat.JPEG });
    const base64 = compressed.base64;
    if (!base64) {
      Alert.alert('Görsel hazırlanamadı', 'Lütfen farklı bir fotoğraf seçin.');
      return;
    }
    setUploading(true);
    try {
      const updated = await uploadAvatar(token, base64);
      onProfileUpdated(updated);
    } catch (error) {
      Alert.alert('Avatar yüklenemedi', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    } finally {
      setUploading(false);
    }
  };

  const removeAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      await deleteAccount(token);
      onAccountDeleted();
      Alert.alert('Hesap silindi', 'Profilin, avatarın ve çevrimiçi maç verilerin kalıcı olarak silindi.');
    } catch (error) {
      Alert.alert('Hesap silinemedi', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    } finally {
      setDeletingAccount(false);
    }
  };

  const confirmRemoveAccount = () => {
    if (deletingAccount) return;
    Alert.alert(
      'Hesabı kalıcı olarak sil',
      'Kullanıcı adın, avatarın, çevrimiçi profilin ve maç geçmişin silinecek. Bu işlem geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Hesabımı sil', style: 'destructive', onPress: () => void removeAccount() },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.topRow}>
        <RoundButton label="Ana sayfaya dön" symbol="‹" onPress={onBack} />
        <Text style={styles.title}>Profil</Text>
        <RoundButton label="Verileri yenile" symbol="↻" onPress={() => void loadData()} />
      </View>

      <View style={styles.profileCard}>
        <Pressable accessibilityRole="button" accessibilityLabel="Avatar seç" onPress={() => void pickAvatar()} style={styles.avatarButton}>
          <Avatar profile={profile} size={88} />
          <View style={styles.avatarEdit}><Text style={styles.avatarEditText}>{uploading ? '…' : '✎'}</Text></View>
        </Pressable>
        <View style={styles.profileHeading}>
          <Text style={[styles.league, { color: profile.league.color }]}>{profile.league.name.toUpperCase()} LİGİ</Text>
          <Text style={styles.level}>Seviye {profile.level}</Text>
        </View>
        <Text style={styles.avatarHint}>Fotoğrafa dokunarak avatarını değiştir.</Text>
        {canChangeDisplayName ? <>
          <View style={styles.nameRow}>
            <TextInput accessibilityLabel="Kullanıcı adı" value={displayName} maxLength={18} onChangeText={setDisplayName} style={styles.nameInput} placeholderTextColor="#667F93" />
            <Pressable accessibilityRole="button" accessibilityLabel="Kullanıcı adını kaydet ve sabitle" onPress={confirmSaveName} style={[styles.saveButton, (savingName || displayName.trim() === profile.displayName) && styles.buttonDisabled]}>
              <Text style={styles.saveButtonText}>{savingName ? '…' : 'Kaydet'}</Text>
            </Pressable>
          </View>
          <Text style={styles.nameHint}>3–18 karakter: harf, rakam, boşluk, nokta veya tire. Bir kez ayarlanır.</Text>
        </> : <>
          <View style={styles.lockedNameRow}><Text style={styles.lockedName}>{profile.displayName}</Text><View style={styles.lockedBadge}><Text style={styles.lockedBadgeText}>✓ SABİTLENDİ</Text></View></View>
          <Text style={styles.nameHint}>Kullanıcı adı bir kez ayarlandı ve artık değiştirilemez.</Text>
        </>}
      </View>

      <View style={styles.wallet}>
        <Metric value={profile.trophies} label="Kupa" color="#FFC857" />
        <Metric value={profile.coins} label="Altın" color="#F6C84E" />
        <Metric value={profile.xp} label="XP" color="#58C7FF" />
      </View>
      <View style={styles.wallet}>
        <Metric value={profile.wins} label="Galibiyet" color="#3DD6B8" />
        <Metric value={profile.losses} label="Mağlubiyet" color="#FF6680" />
        <Metric value={profile.bestWinStreak} label="En iyi seri" color="#B27BFF" />
      </View>

      <SectionTitle title="Sezon sıralaması" subtitle={loadingData ? 'Yükleniyor…' : 'En yüksek kupa önde'} />
      <View style={styles.listCard}>
        {leaderboard.length ? leaderboard.map((entry) => <LeaderboardRow key={entry.id} entry={entry} isYou={entry.id === profile.id} />) : <EmptyList text="Henüz sıralamada oyuncu yok." />}
      </View>

      <SectionTitle title="Son maçlar" subtitle={loadingData ? 'Yükleniyor…' : 'Ödüller ve sonuçlar'} />
      <View style={styles.listCard}>
        {history.length ? history.map((match) => <HistoryRow key={match.id} match={match} />) : <EmptyList text="İlk çevrimiçi maçın burada görünecek." />}
      </View>

      <View style={styles.deleteCard}>
        <Text style={styles.deleteTitle}>Hesabımı sil</Text>
        <Text style={styles.deleteText}>Kullanıcı adın, avatarın ve çevrimiçi maç verilerin kalıcı olarak silinir. Bu işlem geri alınamaz.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Hesabımı kalıcı olarak sil" onPress={confirmRemoveAccount} disabled={deletingAccount} style={[styles.deleteButton, deletingAccount && styles.buttonDisabled]}>
          <Text style={styles.deleteButtonText}>{deletingAccount ? 'Siliniyor…' : 'Hesabımı sil'}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

export function Avatar({ profile, size = 40 }: { profile: Pick<PlayerProfile, 'displayName' | 'avatarUrl'>; size?: number }) {
  const url = resolveAvatarUrl(profile.avatarUrl);
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#17334D' }} />;
  return <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}><Text style={[styles.avatarInitial, { fontSize: size * 0.42 }]}>{profile.displayName.slice(0, 1).toLocaleUpperCase('tr-TR')}</Text></View>;
}

function Metric({ value, label, color }: { value: number; label: string; color: string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View>;
}

function LeaderboardRow({ entry, isYou }: { entry: LeaderboardEntry; isYou: boolean }) {
  return <View style={[styles.leaderRow, isYou && styles.youRow]}>
    <Text style={styles.rank}>#{entry.rank}</Text>
    <Avatar profile={entry} size={36} />
    <View style={styles.rowGrow}><Text numberOfLines={1} style={styles.rowName}>{entry.displayName}{isYou ? ' (sen)' : ''}</Text><Text style={[styles.rowLeague, { color: entry.league.color }]}>{entry.league.name}</Text></View>
    <Text style={styles.rowTrophy}>🏆 {entry.trophies}</Text>
  </View>;
}

function HistoryRow({ match }: { match: MatchHistoryItem }) {
  const won = match.outcome === 'win';
  const color = won ? '#3DD6B8' : match.outcome === 'draw' ? '#FFC857' : '#FF6680';
  const label = won ? 'Kazandın' : match.outcome === 'draw' ? 'Berabere' : 'Kaybettin';
  return <View style={styles.historyRow}>
    <Avatar profile={match.opponent} size={36} />
    <View style={styles.rowGrow}><Text numberOfLines={1} style={styles.rowName}>{match.opponent.displayName}</Text><Text style={styles.historyMeta}>{match.mode === 'dice' ? 'Zarlı' : 'Klasik'} · {match.score.you} : {match.score.opponent} · {match.reason === 'forfeit' ? 'Rakip ayrıldı' : 'Tamamlandı'}</Text></View>
    <View style={styles.historyResult}><Text style={[styles.outcome, { color }]}>{label}</Text><Text style={styles.historyReward}>{match.rewards ? `🏆 ${match.rewards.trophyDelta > 0 ? '+' : ''}${match.rewards.trophyDelta}` : '—'}</Text></View>
  </View>;
}

function EmptyList({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function RoundButton({ label, symbol, onPress }: { label: string; symbol: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.roundButton}><Text style={styles.roundButtonText}>{symbol}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#07111F' },
  content: { padding: 20, paddingBottom: 42, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  title: { color: '#F7FBFF', fontSize: 22, fontWeight: '800' },
  roundButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#13263B', borderWidth: 1, borderColor: '#25425C', alignItems: 'center', justifyContent: 'center' },
  roundButtonText: { color: '#F7FBFF', fontSize: 25, marginTop: -2 },
  profileCard: { padding: 20, borderRadius: 26, alignItems: 'center', backgroundColor: '#102B43', borderWidth: 1, borderColor: '#285473' },
  avatarButton: { position: 'relative' },
  avatarEdit: { position: 'absolute', width: 28, height: 28, borderRadius: 14, right: -4, bottom: -3, backgroundColor: '#58C7FF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#102B43' },
  avatarEditText: { color: '#08223A', fontWeight: '900', fontSize: 17 },
  profileHeading: { marginTop: 11, alignItems: 'center' },
  league: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  level: { color: '#F7FBFF', fontSize: 16, fontWeight: '800', marginTop: 3 },
  avatarHint: { color: '#9CB5C9', fontSize: 12, marginTop: 8 },
  nameRow: { width: '100%', flexDirection: 'row', gap: 9, marginTop: 18 },
  nameInput: { flex: 1, minHeight: 46, borderRadius: 14, paddingHorizontal: 14, color: '#F7FBFF', fontSize: 16, fontWeight: '700', backgroundColor: '#0B1D2E', borderWidth: 1, borderColor: '#315771' },
  saveButton: { minWidth: 78, minHeight: 46, borderRadius: 14, backgroundColor: '#F7FBFF', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  saveButtonText: { color: '#0A2439', fontSize: 13, fontWeight: '900' },
  buttonDisabled: { opacity: 0.45 },
  lockedNameRow: { width: '100%', minHeight: 52, marginTop: 18, paddingHorizontal: 15, borderRadius: 14, backgroundColor: '#0B1D2E', borderWidth: 1, borderColor: '#315771', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  lockedName: { color: '#F7FBFF', fontSize: 16, fontWeight: '800', flex: 1 },
  lockedBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#123D37' },
  lockedBadgeText: { color: '#58E0B8', fontSize: 9, letterSpacing: 0.5, fontWeight: '900' },
  nameHint: { color: '#7F9CB3', fontSize: 11, alignSelf: 'flex-start', marginTop: 8 },
  wallet: { flexDirection: 'row', gap: 10 },
  metric: { flex: 1, minHeight: 76, borderRadius: 17, backgroundColor: '#0E2035', borderWidth: 1, borderColor: '#1B354E', alignItems: 'center', justifyContent: 'center' },
  metricValue: { fontSize: 22, fontWeight: '900' },
  metricLabel: { color: '#9CB0C3', fontSize: 10, fontWeight: '800', marginTop: 3 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 },
  sectionTitle: { color: '#F7FBFF', fontSize: 18, fontWeight: '800' },
  sectionSubtitle: { color: '#8099AE', fontSize: 11 },
  listCard: { overflow: 'hidden', borderRadius: 20, backgroundColor: '#0E2035', borderWidth: 1, borderColor: '#1B354E' },
  leaderRow: { minHeight: 60, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: '#1B354E' },
  youRow: { backgroundColor: '#123A55' },
  rank: { color: '#90A9BE', width: 28, fontWeight: '900', fontSize: 12 },
  rowGrow: { flex: 1, minWidth: 0 },
  rowName: { color: '#EAF3FA', fontSize: 14, fontWeight: '800' },
  rowLeague: { fontSize: 10, fontWeight: '800', marginTop: 2 },
  rowTrophy: { color: '#FFD36F', fontSize: 12, fontWeight: '800' },
  historyRow: { minHeight: 65, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: '#1B354E' },
  historyMeta: { color: '#849BAE', fontSize: 11, marginTop: 3 },
  historyResult: { alignItems: 'flex-end' },
  outcome: { fontSize: 12, fontWeight: '900' },
  historyReward: { color: '#B9CDDC', fontSize: 11, marginTop: 4 },
  empty: { color: '#8DA6BA', fontSize: 13, textAlign: 'center', padding: 22 },
  deleteCard: { marginTop: 12, padding: 18, borderRadius: 20, backgroundColor: '#281927', borderWidth: 1, borderColor: '#63314B' },
  deleteTitle: { color: '#FFD8E0', fontSize: 16, fontWeight: '900' },
  deleteText: { color: '#D4AAB7', fontSize: 12, lineHeight: 18, marginTop: 7 },
  deleteButton: { alignSelf: 'flex-start', minHeight: 42, paddingHorizontal: 15, marginTop: 14, borderRadius: 13, borderWidth: 1, borderColor: '#F07890', alignItems: 'center', justifyContent: 'center' },
  deleteButtonText: { color: '#FFB9C6', fontSize: 13, fontWeight: '900' },
  avatarFallback: { backgroundColor: '#1C5575', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#EAF7FF', fontWeight: '900' },
});

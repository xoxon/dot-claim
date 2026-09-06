import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { io, type Socket } from 'socket.io-client';

import { acceptFriendInvite, createFriendInvite, fetchDirectMessages, fetchFriends, MATCH_SERVER_URL, respondToFriendRequest, searchPlayers, sendDirectMessage, sendFriendRequest } from '../profile/api';
import type { DirectMessage, FriendEntry, FriendInvite, FriendsPayload, PlayerProfile } from '../profile/types';
import { Avatar } from './ProfileScreen';

const EMPTY_FRIENDS: FriendsPayload = { friends: [], incomingRequests: [], outgoingRequests: [], invites: [] };

export function FriendsScreen({ profile, token, onBack, onStartInvite }: {
  profile: PlayerProfile;
  token: string;
  onBack: () => void;
  onStartInvite: (invite: FriendInvite) => void;
}) {
  const [data, setData] = useState<FriendsPayload>(EMPTY_FRIENDS);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeChat, setActiveChat] = useState<FriendEntry | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchFriends(token));
    } catch (error) {
      if (loading) Alert.alert('Arkadaşlar yüklenemedi', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  }, [loading, token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 8_000);
    return () => clearInterval(timer);
  }, [load]);

  const search = async () => {
    const value = query.trim();
    if (value.length < 2 || searching) return;
    setSearching(true);
    try {
      setResults(await searchPlayers(token, value));
    } catch (error) {
      Alert.alert('Arama yapılamadı', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    } finally {
      setSearching(false);
    }
  };

  const addFriend = async (candidate: PlayerProfile) => {
    try {
      const result = await sendFriendRequest(token, candidate.id);
      Alert.alert(result.state === 'accepted' ? 'Arkadaş oldunuz' : 'İstek gönderildi', result.state === 'accepted' ? `${candidate.displayName} artık arkadaş listende.` : `${candidate.displayName} isteğini kabul ettiğinde burada görünecek.`);
      setResults((current) => current.filter((item) => item.id !== candidate.id));
      void load();
    } catch (error) {
      Alert.alert('İstek gönderilemedi', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    }
  };

  const respond = async (requesterId: string, action: 'accept' | 'decline') => {
    try {
      await respondToFriendRequest(token, requesterId, action);
      void load();
    } catch (error) {
      Alert.alert('İşlem tamamlanamadı', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    }
  };

  const invite = (friend: FriendEntry) => {
    const send = async (mode: FriendInvite['mode']) => {
      try {
        const nextInvite = await createFriendInvite(token, friend.profile.id, mode, 'normal');
        onStartInvite(nextInvite);
      } catch (error) {
        Alert.alert('Davet gönderilemedi', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
      }
    };
    Alert.alert('Oyuna çağır', `${friend.profile.displayName} ile hangi modda oynayacaksın?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Klasik', onPress: () => void send('classic') },
      { text: 'Zarlı', onPress: () => void send('dice') },
    ]);
  };

  const acceptInvite = async (inviteToAccept: FriendInvite) => {
    try {
      const accepted = await acceptFriendInvite(token, inviteToAccept.id);
      onStartInvite(accepted);
    } catch (error) {
      Alert.alert('Davet kabul edilemedi', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    }
  };

  return <View style={styles.screen}>
    <View style={styles.header}>
      <RoundButton label="Ana sayfaya dön" symbol="‹" onPress={onBack} />
      <View><Text style={styles.title}>Arkadaşlar</Text><Text style={styles.subtitle}>Davet et, sohbet et, birlikte oyna</Text></View>
      <RoundButton label="Listeyi yenile" symbol="↻" onPress={() => void load()} />
    </View>

    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.searchCard}>
        <Text style={styles.searchTitle}>Arkadaş bul</Text>
        <Text style={styles.searchHint}>Kullanıcı adını yazarak istek gönder.</Text>
        <View style={styles.searchRow}>
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="Kullanıcı adı" placeholderTextColor="#6E879B" autoCapitalize="none" style={styles.searchInput} maxLength={18} />
          <Pressable accessibilityRole="button" accessibilityLabel="Oyuncu ara" disabled={searching || query.trim().length < 2} onPress={() => void search()} style={[styles.searchButton, (searching || query.trim().length < 2) && styles.disabled]}><Text style={styles.searchButtonText}>{searching ? '…' : 'Ara'}</Text></Pressable>
        </View>
        {results.map((candidate) => <SearchRow key={candidate.id} profile={candidate} onAdd={() => void addFriend(candidate)} />)}
      </View>

      {data.incomingRequests.length > 0 ? <Section title="Arkadaşlık istekleri" subtitle={`${data.incomingRequests.length} yeni istek`}>
        {data.incomingRequests.map((request) => <RequestRow key={request.id} profile={request.profile} onAccept={() => void respond(request.profile.id, 'accept')} onDecline={() => void respond(request.profile.id, 'decline')} />)}
      </Section> : null}

      {data.invites.filter((inviteItem) => inviteItem.direction === 'incoming').length > 0 ? <Section title="Oyun davetleri" subtitle="Arkadaşın seni bekliyor">
        {data.invites.filter((inviteItem) => inviteItem.direction === 'incoming').map((inviteItem) => <InviteRow key={inviteItem.id} invite={inviteItem} onAccept={() => void acceptInvite(inviteItem)} />)}
      </Section> : null}

      <Section title="Arkadaş listen" subtitle={loading ? 'Yükleniyor…' : `${data.friends.length} arkadaş`}>
        {data.friends.length ? data.friends.map((friend) => <FriendRow key={friend.friendshipId} friend={friend} onChat={() => setActiveChat(friend)} onInvite={() => invite(friend)} />) : <Text style={styles.empty}>Henüz arkadaşın yok. Kullanıcı adıyla arayıp ilk isteğini gönder.</Text>}
      </Section>

      {data.outgoingRequests.length > 0 ? <Section title="Gönderilen istekler" subtitle="Kabul bekleniyor">
        {data.outgoingRequests.map((request) => <View key={request.id} style={styles.waitingRow}><Avatar profile={request.profile} size={38} /><Text style={styles.waitingName}>{request.profile.displayName}</Text><Text style={styles.waitingState}>Bekliyor</Text></View>)}
      </Section> : null}

      {data.invites.filter((inviteItem) => inviteItem.direction === 'outgoing').length > 0 ? <Section title="Gönderilen oyun davetleri" subtitle="Arkadaşın kabul ettiğinde oyun açılır">
        {data.invites.filter((inviteItem) => inviteItem.direction === 'outgoing').map((inviteItem) => <View key={inviteItem.id} style={styles.waitingRow}><Avatar profile={inviteItem.friend} size={38} /><Text style={styles.waitingName}>{inviteItem.friend.displayName}</Text><Text style={styles.waitingState}>{inviteItem.mode === 'dice' ? 'Zarlı' : 'Klasik'} bekliyor</Text></View>)}
      </Section> : null}
    </ScrollView>

    <ChatModal visible={activeChat !== null} friend={activeChat?.profile ?? null} selfId={profile.id} token={token} onClose={() => setActiveChat(null)} />
  </View>;
}

function ChatModal({ visible, friend, selfId, token, onClose }: { visible: boolean; friend: PlayerProfile | null; selfId: string; token: string; onClose: () => void }) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [friendOnline, setFriendOnline] = useState(false);
  const [friendTyping, setFriendTyping] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  const upsertMessage = useCallback((message: DirectMessage) => {
    setMessages((current) => {
      const index = current.findIndex((item) => item.id === message.id);
      if (index < 0) return [...current, message].sort((first, second) => first.sentAt.localeCompare(second.sentAt));
      const next = [...current];
      next[index] = { ...next[index], ...message };
      return next;
    });
    scrollToLatest();
  }, [scrollToLatest]);

  const loadMessages = useCallback(async () => {
    if (!friend) return;
    try {
      setMessages(await fetchDirectMessages(token, friend.id));
      scrollToLatest(false);
    } catch {
      // A transient network error should not close the conversation.
    }
  }, [friend, scrollToLatest, token]);

  useEffect(() => {
    if (!visible || !friend) return undefined;
    setMessages([]);
    setDraft('');
    setSocketConnected(false);
    setFriendOnline(false);
    setFriendTyping(false);
    void loadMessages();
    // Socket.IO delivers new messages immediately. The lightweight polling is
    // only a recovery path for a temporary mobile network interruption.
    const timer = setInterval(() => void loadMessages(), 12_000);
    const socket = io(MATCH_SERVER_URL, {
      auth: { token },
      transports: ['websocket'],
      timeout: 9_000,
      reconnection: true,
      reconnectionAttempts: 4,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('chat_join', { friendId: friend.id }, (reply: { ok?: boolean; friendOnline?: boolean }) => {
        if (reply?.ok) setFriendOnline(Boolean(reply.friendOnline));
      });
    });
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('connect_error', () => setSocketConnected(false));
    socket.on('chat_message', ({ friendId, message }: { friendId: string; message: DirectMessage }) => {
      if (friendId !== friend.id) return;
      upsertMessage(message);
      if (message.senderId !== selfId) socket.emit('chat_read', { friendId });
    });
    socket.on('chat_read', ({ friendId, readAt }: { friendId: string; readAt: string }) => {
      if (friendId !== friend.id) return;
      setMessages((current) => current.map((message) => message.senderId === selfId && !message.readAt ? { ...message, readAt } : message));
    });
    socket.on('chat_presence', ({ friendId, online }: { friendId: string; online: boolean }) => {
      if (friendId === friend.id) setFriendOnline(online);
    });
    socket.on('chat_typing', ({ friendId, isTyping }: { friendId: string; isTyping: boolean }) => {
      if (friendId !== friend.id) return;
      setFriendTyping(isTyping);
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
      if (isTyping) typingClearTimerRef.current = setTimeout(() => setFriendTyping(false), 3_000);
    });

    return () => {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
      socket.emit('chat_typing', { friendId: friend.id, isTyping: false });
      socket.disconnect();
      socketRef.current = null;
      clearInterval(timer);
    };
  }, [friend, loadMessages, selfId, token, upsertMessage, visible]);

  useEffect(() => {
    if (messages.length) scrollToLatest(false);
  }, [messages.length, scrollToLatest]);

  const onDraftChange = (value: string) => {
    setDraft(value);
    const socket = socketRef.current;
    if (!friend || !socket?.connected) return;
    socket.emit('chat_typing', { friendId: friend.id, isTyping: Boolean(value.trim()) });
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      socket.emit('chat_typing', { friendId: friend.id, isTyping: false });
    }, 1_600);
  };

  const send = async () => {
    const body = draft.trim();
    if (!friend || !body || sending) return;
    setSending(true);
    socketRef.current?.emit('chat_typing', { friendId: friend.id, isTyping: false });
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    try {
      const created = await sendDirectMessage(token, friend.id, body);
      upsertMessage(created);
      setDraft('');
    } catch (error) {
      Alert.alert('Mesaj gönderilemedi', error instanceof Error ? error.message : 'Lütfen tekrar deneyin.');
    } finally {
      setSending(false);
    }
  };

  const chatStatus = friendTyping ? 'yazıyor…' : friendOnline ? 'çevrimiçi' : socketConnected ? 'çevrimdışı' : 'bağlanıyor…';

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.chatScreen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.chatKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.chatHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Sohbetten geri dön" onPress={onClose} hitSlop={10} style={({ pressed }) => [styles.chatBackButton, pressed && styles.pressed]}><Text style={styles.chatBackIcon}>‹</Text><Text style={styles.chatBackLabel}>Geri</Text></Pressable>
          {friend ? <View style={styles.chatPerson}><Avatar profile={friend} size={42} /><View><Text style={styles.chatName}>{friend.displayName}</Text><Text style={[styles.chatStatus, friendTyping && styles.chatTyping]}>{chatStatus}</Text></View></View> : null}
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.messageList} onContentSizeChange={() => scrollToLatest(false)} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{messages.length ? messages.map((message) => {
          const own = message.senderId === selfId;
          return <View key={message.id} style={[styles.bubble, own ? styles.ownBubble : styles.friendBubble]}><Text style={styles.bubbleText}>{message.body}</Text><View style={styles.messageMeta}><Text style={styles.messageTime}>{new Date(message.sentAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</Text>{own ? <Text style={[styles.deliveryState, message.readAt && styles.deliveryRead]}>{message.readAt ? '✓✓' : '✓'}</Text> : null}</View></View>;
        }) : <Text style={styles.chatEmpty}>Henüz mesaj yok. İlk mesajı sen gönder.</Text>}{friendTyping ? <View style={[styles.bubble, styles.friendBubble, styles.typingBubble]}><Text style={styles.typingDots}>•••</Text></View> : null}</ScrollView>
        <View style={styles.composer}><TextInput value={draft} onChangeText={onDraftChange} maxLength={500} multiline placeholder="Mesaj yaz" placeholderTextColor="#6E879B" style={styles.composerInput} /><Pressable accessibilityRole="button" accessibilityLabel="Mesaj gönder" disabled={!draft.trim() || sending} onPress={() => void send()} style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}><Text style={styles.sendButtonText}>{sending ? '…' : '➤'}</Text></Pressable></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <View><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View><View style={styles.listCard}>{children}</View></View>;
}

function SearchRow({ profile, onAdd }: { profile: PlayerProfile; onAdd: () => void }) {
  return <View style={styles.searchResult}><Avatar profile={profile} size={40} /><View style={styles.grow}><Text style={styles.rowName}>{profile.displayName}</Text><Text style={[styles.rowLeague, { color: profile.league.color }]}>{profile.league.name} · Seviye {profile.level}</Text></View><SmallButton label="Ekle" onPress={onAdd} /></View>;
}

function RequestRow({ profile, onAccept, onDecline }: { profile: PlayerProfile; onAccept: () => void; onDecline: () => void }) {
  return <View style={styles.friendRow}><Avatar profile={profile} size={46} /><View style={styles.grow}><Text style={styles.rowName}>{profile.displayName}</Text><Text style={styles.rowMeta}>Arkadaş olmak istiyor</Text></View><View style={styles.actionPair}><SmallButton label="Kabul" onPress={onAccept} /><SmallButton label="×" onPress={onDecline} outline /></View></View>;
}

function InviteRow({ invite, onAccept }: { invite: FriendInvite; onAccept: () => void }) {
  return <View style={styles.friendRow}><Avatar profile={invite.friend} size={46} /><View style={styles.grow}><Text style={styles.rowName}>{invite.friend.displayName}</Text><Text style={styles.rowMeta}>{invite.mode === 'dice' ? 'Zarlı düello' : 'Klasik düello'} · {invite.difficulty === 'easy' ? 'Rahat' : invite.difficulty === 'hard' ? 'Usta' : 'Dengeli'}</Text></View><SmallButton label="Katıl" onPress={onAccept} /></View>;
}

function FriendRow({ friend, onChat, onInvite }: { friend: FriendEntry; onChat: () => void; onInvite: () => void }) {
  return <View style={styles.friendRow}><Avatar profile={friend.profile} size={48} /><View style={styles.grow}><Text style={styles.rowName}>{friend.profile.displayName}</Text><Text style={[styles.rowLeague, { color: friend.profile.league.color }]}>{friend.profile.league.name} · 🏆 {friend.profile.trophies}</Text></View><View style={styles.friendActions}><SmallButton label="Sohbet" onPress={onChat} outline /><SmallButton label="Davet" onPress={onInvite} /></View></View>;
}

function SmallButton({ label, onPress, outline = false }: { label: string; onPress: () => void; outline?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.smallButton, outline && styles.smallButtonOutline]}><Text style={[styles.smallButtonText, outline && styles.smallButtonOutlineText]}>{label}</Text></Pressable>;
}

function RoundButton({ label, symbol, onPress }: { label: string; symbol: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.roundButton}><Text style={styles.roundButtonText}>{symbol}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, backgroundColor: '#07111F' },
  header: { paddingTop: 8, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { color: '#F7FBFF', fontSize: 21, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: '#8EA8BE', fontSize: 11, marginTop: 2, textAlign: 'center' },
  content: { paddingBottom: 40, gap: 18 },
  roundButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#13263B', borderWidth: 1, borderColor: '#25425C', alignItems: 'center', justifyContent: 'center' },
  roundButtonText: { color: '#F7FBFF', fontSize: 26, fontWeight: '700', marginTop: -3 },
  searchCard: { padding: 16, borderRadius: 20, backgroundColor: '#102B43', borderWidth: 1, borderColor: '#285473' },
  searchTitle: { color: '#F7FBFF', fontSize: 16, fontWeight: '900' },
  searchHint: { color: '#9CB5C9', fontSize: 12, marginTop: 4 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 13 },
  searchInput: { flex: 1, minHeight: 44, paddingHorizontal: 13, borderRadius: 13, color: '#F7FBFF', backgroundColor: '#091A2A', borderWidth: 1, borderColor: '#315771' },
  searchButton: { minWidth: 64, minHeight: 44, borderRadius: 13, backgroundColor: '#F7FBFF', alignItems: 'center', justifyContent: 'center' },
  searchButtonText: { color: '#0A2439', fontWeight: '900', fontSize: 13 },
  disabled: { opacity: 0.45 },
  searchResult: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: '#28516B', flexDirection: 'row', gap: 10, alignItems: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { color: '#F7FBFF', fontSize: 17, fontWeight: '900' },
  sectionSubtitle: { color: '#819BB0', fontSize: 11 },
  listCard: { overflow: 'hidden', borderRadius: 18, backgroundColor: '#0E2035', borderWidth: 1, borderColor: '#1B354E' },
  friendRow: { minHeight: 70, paddingHorizontal: 12, paddingVertical: 10, gap: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#1B354E' },
  grow: { flex: 1, minWidth: 0 },
  rowName: { color: '#EAF3FA', fontSize: 14, fontWeight: '900' },
  rowLeague: { fontSize: 11, fontWeight: '800', marginTop: 3 },
  rowMeta: { color: '#8EA8BE', fontSize: 11, marginTop: 3 },
  friendActions: { gap: 6, alignItems: 'flex-end' },
  actionPair: { flexDirection: 'row', gap: 5 },
  smallButton: { minHeight: 30, minWidth: 50, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F7FBFF', alignItems: 'center', justifyContent: 'center' },
  smallButtonText: { color: '#09243A', fontSize: 11, fontWeight: '900' },
  smallButtonOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#4B86A8' },
  smallButtonOutlineText: { color: '#9DD5F4' },
  empty: { color: '#8DA6BA', fontSize: 13, textAlign: 'center', padding: 22 },
  waitingRow: { minHeight: 61, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: '#1B354E' },
  waitingName: { color: '#EAF3FA', fontSize: 14, fontWeight: '800', flex: 1 },
  waitingState: { color: '#FFC857', fontSize: 11, fontWeight: '800' },
  chatScreen: { flex: 1, backgroundColor: '#07111F' },
  chatKeyboard: { flex: 1 },
  chatHeader: { minHeight: 74, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#1B354E' },
  chatBackButton: { minWidth: 66, minHeight: 42, paddingHorizontal: 8, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#10273D', borderWidth: 1, borderColor: '#2C5370' },
  chatBackIcon: { color: '#EAF7FF', fontSize: 30, fontWeight: '500', lineHeight: 31, marginTop: -3 },
  chatBackLabel: { color: '#C7E8FA', fontSize: 13, fontWeight: '900', marginLeft: 1 },
  chatPerson: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  chatName: { color: '#F7FBFF', fontSize: 16, fontWeight: '900' },
  chatStatus: { color: '#90AABD', fontSize: 11, fontWeight: '700', marginTop: 2 },
  chatTyping: { color: '#59C8FF', fontWeight: '900' },
  headerSpacer: { width: 42 },
  messageList: { paddingHorizontal: 16, paddingVertical: 18, gap: 8, flexGrow: 1, justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15 },
  ownBubble: { alignSelf: 'flex-end', backgroundColor: '#1B5D82', borderBottomRightRadius: 4 },
  friendBubble: { alignSelf: 'flex-start', backgroundColor: '#142A3F', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#F7FBFF', fontSize: 14, lineHeight: 19 },
  messageMeta: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 4 },
  messageTime: { color: '#A5C0D1', fontSize: 9 },
  deliveryState: { color: '#A5C0D1', fontSize: 11, letterSpacing: -2 },
  deliveryRead: { color: '#72D7FF' },
  typingBubble: { minWidth: 56, alignItems: 'center' },
  typingDots: { color: '#7EDAFF', fontSize: 18, letterSpacing: 2, lineHeight: 16 },
  chatEmpty: { color: '#89A3B8', textAlign: 'center', fontSize: 13, marginBottom: 24 },
  composer: { padding: 12, gap: 8, borderTopWidth: 1, borderColor: '#1B354E', flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#0A1A2A' },
  composerInput: { flex: 1, maxHeight: 110, minHeight: 44, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, color: '#F7FBFF', backgroundColor: '#112840', borderWidth: 1, borderColor: '#315771', textAlignVertical: 'top' },
  sendButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: 14, backgroundColor: '#F7FBFF', alignItems: 'center', justifyContent: 'center' },
  sendButtonText: { color: '#09243A', fontSize: 12, fontWeight: '900' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});

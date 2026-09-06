import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export type RewardOfferTrigger = 'levels' | 'daily' | 'online' | 'manual';

export type RewardOffer = {
  id: string;
  trigger: RewardOfferTrigger;
};

export type GoogleMobileAds = typeof import('react-native-google-mobile-ads');

const LIVE_REWARDED_AD_UNIT_ID = 'ca-app-pub-6927228148817615/6183846492';
export const isUsingTestAds = process.env.EXPO_PUBLIC_ADMOB_USE_TEST_ADS !== 'false';
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';

let mobileAdsInitialization: Promise<GoogleMobileAds | null> | null = null;

const OFFER_COPY: Record<RewardOfferTrigger, { eyebrow: string; title: string; detail: string }> = {
  levels: {
    eyebrow: 'OYUN SERİSİ',
    title: '2 oyun tamamlandı!',
    detail: 'İstersen ödüllü test reklamını izleyip akışı kontrol edebilirsin.',
  },
  daily: {
    eyebrow: 'GÜNLÜK MEYDAN OKUMA',
    title: 'Günlük sonuç hazır',
    detail: 'İstersen bu tamamlanan oyun için ödüllü test reklamını izleyebilirsin.',
  },
  online: {
    eyebrow: 'ÇEVRİMİÇİ MAÇ',
    title: 'Maç tamamlandı',
    detail: 'İstersen ödüllü test reklamını izleyebilirsin.',
  },
  manual: {
    eyebrow: 'GELİŞTİRİCİ TESTİ',
    title: 'Ödüllü reklam testi',
    detail: 'Google’ın test reklamı açılır; gerçek reklam geliri veya oyun ödülü oluşturmaz.',
  },
};

export function getGoogleMobileAds(): GoogleMobileAds | null {
  if (IS_EXPO_GO || Platform.OS === 'web') return null;
  try {
    // Expo Go does not include the Google Mobile Ads native module. Requiring it only
    // inside a custom development or release build keeps the rest of the game usable.
    return require('react-native-google-mobile-ads') as GoogleMobileAds;
  } catch {
    return null;
  }
}

/**
 * Starts the UMP consent flow and Mobile Ads SDK once per app launch. Keeping
 * this separate from the result modal gives a rewarded request time to start
 * before the player reaches the end-of-game checkpoint.
 */
export function prepareGoogleMobileAds(): Promise<GoogleMobileAds | null> {
  const googleMobileAds = getGoogleMobileAds();
  if (!googleMobileAds) return Promise.resolve(null);
  if (mobileAdsInitialization) return mobileAdsInitialization;

  mobileAdsInitialization = (async () => {
    const { AdsConsent, default: mobileAds } = googleMobileAds;
    if (!isUsingTestAds) {
      try {
        await AdsConsent.gatherConsent();
      } catch {
        // The SDK may still have a valid consent choice from an earlier launch.
      }

      const consent = await AdsConsent.getConsentInfo();
      if (!consent.canRequestAds) {
        throw new Error('Reklam izni henüz tamamlanmadı.');
      }
    }

    // TestFlight test ads must not depend on a production UMP message being
    // configured in AdMob. Production builds still perform the consent gate.
    await mobileAds().initialize();
    return googleMobileAds;
  })().catch((error) => {
    mobileAdsInitialization = null;
    throw error;
  });

  return mobileAdsInitialization;
}

export function RewardedAdOffer({ offer, onDismiss, onRewardEarned }: {
  offer: RewardOffer | null;
  onDismiss: () => void;
  onRewardEarned: (offer: RewardOffer, reward: { amount: number; type: string }) => void;
}) {
  const googleMobileAds = getGoogleMobileAds();

  if (!offer) return null;

  if (!googleMobileAds) {
    return <OfferCard
      offer={offer}
      status="Bu ekran Expo Go’da açıldı. Gerçek test reklamını görmek için özel iOS geliştirme uygulamasını kuracağız."
      actionLabel="Tamam"
      onAction={onDismiss}
      onDismiss={onDismiss}
    />;
  }

  return <NativeRewardedAdOffer
    googleMobileAds={googleMobileAds}
    offer={offer}
    onDismiss={onDismiss}
    onRewardEarned={onRewardEarned}
  />;
}

function NativeRewardedAdOffer({ googleMobileAds, offer, onDismiss, onRewardEarned }: {
  googleMobileAds: GoogleMobileAds;
  offer: RewardOffer;
  onDismiss: () => void;
  onRewardEarned: (offer: RewardOffer, reward: { amount: number; type: string }) => void;
}) {
  const { AdEventType, RewardedAd, RewardedAdEventType, TestIds } = googleMobileAds;
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [adState, setAdState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [adError, setAdError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const handledRewardRef = useRef(false);
  const adRef = useRef<{ show: () => void } | null>(null);
  const onDismissRef = useRef(onDismiss);
  const onRewardEarnedRef = useRef(onRewardEarned);
  const adUnitId = isUsingTestAds ? TestIds.REWARDED : (process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID ?? LIVE_REWARDED_AD_UNIT_ID);

  useEffect(() => {
    onDismissRef.current = onDismiss;
    onRewardEarnedRef.current = onRewardEarned;
  }, [onDismiss, onRewardEarned]);

  useEffect(() => {
    let active = true;
    void prepareGoogleMobileAds()
      .then(() => {
        if (active) setSdkReady(true);
      })
      .catch((error) => {
        if (active) setSdkError(toErrorDetail(error) ?? 'Reklam servisi şu anda hazırlanamadı.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sdkReady) return;

    let active = true;
    handledRewardRef.current = false;
    setAdState('loading');
    setAdError(null);
    const rewardedAd = RewardedAd.createForAdRequest(adUnitId, { requestNonPersonalizedAdsOnly: true });
    adRef.current = rewardedAd;
    const unsubscribe = rewardedAd.addAdEventsListener(({ type, payload }) => {
      if (!active) return;

      if (type === RewardedAdEventType.LOADED) {
        setAdState('ready');
        return;
      }

      if (type === RewardedAdEventType.EARNED_REWARD) {
        if (handledRewardRef.current) return;
        handledRewardRef.current = true;
        const reward = payload as { amount?: number; type?: string };
        onRewardEarnedRef.current(offer, { amount: reward.amount ?? 0, type: reward.type ?? 'ödül' });
        return;
      }

      if (type === AdEventType.ERROR) {
        setAdState('error');
        setAdError(toErrorDetail(payload) ?? 'Bilinmeyen reklam hatası');
        return;
      }

      if (type === AdEventType.CLOSED) {
        adRef.current = null;
        onDismissRef.current();
      }
    });

    rewardedAd.load();
    return () => {
      active = false;
      unsubscribe();
      if (adRef.current === rewardedAd) adRef.current = null;
    };
  }, [AdEventType, RewardedAd, RewardedAdEventType, adUnitId, loadAttempt, offer]);

  const onAction = useCallback(() => {
    if (adState === 'ready' && adRef.current) {
      try {
        adRef.current.show();
      } catch (error) {
        setAdState('error');
        setAdError(toErrorDetail(error) ?? 'Reklam açılamadı');
      }
      return;
    }
    if (sdkReady) setLoadAttempt((attempt) => attempt + 1);
  }, [adState, sdkReady]);

  const status = sdkError ?? (adState === 'error'
    ? `Test reklamı yüklenemedi: ${adError ?? 'Bilinmeyen hata'}. Tekrar yükleyebilirsin.`
    : isUsingTestAds
      ? 'Google’ın güvenli test reklamı kullanılacak. Bu reklam gelir veya gerçek ödül üretmez.'
      : 'Reklam hazır olduğunda ödülünü alabilirsin.');
  const actionLabel = sdkError ? 'Kapat' : adState === 'error' ? 'Tekrar yükle' : adState === 'ready' ? (isUsingTestAds ? 'Test reklamını izle' : 'Reklamı izle, ödülü al') : 'Reklam hazırlanıyor…';

  return <OfferCard
    offer={offer}
    status={status}
    actionLabel={actionLabel}
    actionDisabled={!sdkError && adState === 'loading'}
    loading={!sdkError && adState === 'loading'}
    onAction={sdkError ? onDismiss : onAction}
    onDismiss={onDismiss}
  />;
}

function toErrorDetail(error: unknown): string | null {
  if (!error || typeof error !== 'object') return error instanceof Error ? error.message : null;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : null;
  const message = typeof candidate.message === 'string' ? candidate.message : null;
  return [code, message].filter(Boolean).join(': ') || null;
}

function OfferCard({ offer, status, actionLabel, actionDisabled = false, loading = false, onAction, onDismiss }: {
  offer: RewardOffer;
  status: string;
  actionLabel: string;
  actionDisabled?: boolean;
  loading?: boolean;
  onAction: () => void;
  onDismiss: () => void;
}) {
  const copy = OFFER_COPY[offer.trigger];
  return <Modal transparent animationType="fade" visible onRequestClose={onDismiss}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.safeOverlay} edges={['top', 'bottom', 'left', 'right']}>
    <View style={styles.scrim}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
        <Text style={styles.icon}>✦</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.detail}>{copy.detail}</Text>
        <View style={styles.notice}>
          {loading ? <ActivityIndicator color="#68D1FF" size="small" /> : <Text style={styles.noticeIcon}>ⓘ</Text>}
          <Text style={styles.noticeText}>{status}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} disabled={actionDisabled} onPress={onAction} style={({ pressed }) => [styles.primaryButton, actionDisabled && styles.buttonDisabled, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>{actionLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Şimdi değil" onPress={onDismiss} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>Şimdi değil</Text>
        </Pressable>
      </View>
    </View>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(1, 8, 16, 0.80)', padding: 24, justifyContent: 'center' },
  safeOverlay: { flex: 1, backgroundColor: 'rgba(1, 8, 16, 0.80)' },
  card: { borderRadius: 28, padding: 26, alignItems: 'center', backgroundColor: '#10263D', borderWidth: 1, borderColor: '#35607E' },
  eyebrow: { color: '#70D2FF', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  icon: { color: '#FFC857', fontSize: 44, marginTop: 9 },
  title: { color: '#F7FBFF', fontSize: 25, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  detail: { color: '#B6C9D9', fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  notice: { alignSelf: 'stretch', minHeight: 56, borderRadius: 15, marginTop: 20, paddingHorizontal: 14, paddingVertical: 10, gap: 9, backgroundColor: '#0B1C2E', borderWidth: 1, borderColor: '#23415C', flexDirection: 'row', alignItems: 'center' },
  noticeIcon: { color: '#68D1FF', fontSize: 18 },
  noticeText: { color: '#AFC1D0', fontSize: 12, lineHeight: 17, flex: 1 },
  primaryButton: { alignSelf: 'stretch', minHeight: 48, borderRadius: 15, marginTop: 16, backgroundColor: '#F7FBFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primaryButtonText: { color: '#0B253A', fontSize: 15, fontWeight: '800' },
  secondaryButton: { minHeight: 42, marginTop: 6, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#9DC5DC', fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});

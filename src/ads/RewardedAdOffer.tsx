import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

export type RewardOfferTrigger = 'levels' | 'daily' | 'online' | 'manual';

export type RewardOffer = {
  id: string;
  trigger: RewardOfferTrigger;
};

type GoogleMobileAds = typeof import('react-native-google-mobile-ads');

const LIVE_REWARDED_AD_UNIT_ID = 'ca-app-pub-6927228148817615/6183846492';
const USE_TEST_ADS = process.env.EXPO_PUBLIC_ADMOB_USE_TEST_ADS !== 'false';
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';

const OFFER_COPY: Record<RewardOfferTrigger, { eyebrow: string; title: string; detail: string }> = {
  levels: {
    eyebrow: 'BÖLÜM SERİSİ',
    title: '2 bölüm tamamlandı!',
    detail: 'İstersen ödüllü test reklamını izleyip akışı kontrol edebilirsin.',
  },
  daily: {
    eyebrow: 'GÜNLÜK MEYDAN OKUMA',
    title: 'Günlük sonuç hazır',
    detail: 'Bugünkü tek ödüllü reklam hakkın hazır.',
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

function getGoogleMobileAds(): GoogleMobileAds | null {
  if (IS_EXPO_GO || Platform.OS === 'web') return null;
  try {
    // Expo Go does not include the Google Mobile Ads native module. Requiring it only
    // inside a custom development or release build keeps the rest of the game usable.
    return require('react-native-google-mobile-ads') as GoogleMobileAds;
  } catch {
    return null;
  }
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
  const { AdsConsent, TestIds, default: mobileAds, useRewardedAd } = googleMobileAds;
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const handledRewardRef = useRef(false);
  const adUnitId = USE_TEST_ADS ? TestIds.REWARDED : (process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID ?? LIVE_REWARDED_AD_UNIT_ID);
  const requestOptions = useMemo(() => ({ requestNonPersonalizedAdsOnly: true }), []);
  const { error, isClosed, isEarnedReward, isLoaded, load, reward, show } = useRewardedAd(sdkReady ? adUnitId : null, requestOptions);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        await AdsConsent.gatherConsent();
        const consent = await AdsConsent.getConsentInfo();
        if (!consent.canRequestAds) {
          if (active) setSdkError('Reklam izinleri henüz tamamlanmadı. Daha sonra tekrar deneyebilirsin.');
          return;
        }
        await mobileAds().initialize();
        if (active) setSdkReady(true);
      } catch {
        // The UMP SDK can use the previous session's consent when the network is unavailable.
        try {
          await mobileAds().initialize();
          if (active) setSdkReady(true);
        } catch {
          if (active) setSdkError('Reklam servisi şu anda hazırlanamadı.');
        }
      }
    };
    void initialize();
    return () => { active = false; };
  }, [AdsConsent, mobileAds]);

  useEffect(() => {
    if (sdkReady) load();
  }, [load, sdkReady]);

  useEffect(() => {
    if (!isEarnedReward || handledRewardRef.current) return;
    handledRewardRef.current = true;
    onRewardEarned(offer, { amount: reward?.amount ?? 0, type: reward?.type ?? 'ödül' });
  }, [isEarnedReward, offer, onRewardEarned, reward?.amount, reward?.type]);

  useEffect(() => {
    if (!isClosed) return;
    handledRewardRef.current = false;
    onDismiss();
    load();
  }, [isClosed, load, onDismiss]);

  const onAction = useCallback(() => {
    if (isLoaded) {
      show();
      return;
    }
    if (sdkReady) load();
  }, [isLoaded, load, sdkReady, show]);

  const status = sdkError ?? (error
    ? 'Test reklamı yüklenemedi. Bağlantını kontrol edip tekrar deneyebilirsin.'
    : USE_TEST_ADS
      ? 'Google’ın güvenli test reklamı kullanılacak. Bu reklam gelir veya gerçek ödül üretmez.'
      : 'Reklam hazır olduğunda ödülünü alabilirsin.');
  const actionLabel = sdkError ? 'Kapat' : error ? 'Tekrar dene' : isLoaded ? (USE_TEST_ADS ? 'Test reklamını izle' : 'Reklamı izle, ödülü al') : 'Reklam hazırlanıyor…';

  return <OfferCard
    offer={offer}
    status={status}
    actionLabel={actionLabel}
    actionDisabled={!sdkError && !error && !isLoaded}
    loading={!sdkError && !error && !isLoaded}
    onAction={sdkError ? onDismiss : onAction}
    onDismiss={onDismiss}
  />;
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
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(1, 8, 16, 0.80)', padding: 24, justifyContent: 'center' },
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

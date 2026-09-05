import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { getGoogleMobileAds, isUsingTestAds, type GoogleMobileAds } from './RewardedAdOffer';

const LIVE_BANNER_AD_UNIT_ID = 'ca-app-pub-6927228148817615/3683630062';

export function GameBannerAd({ hidden = false }: { hidden?: boolean }) {
  const googleMobileAds = getGoogleMobileAds();

  if (hidden || !googleMobileAds) return null;

  return <NativeGameBannerAd googleMobileAds={googleMobileAds} />;
}

function NativeGameBannerAd({ googleMobileAds }: { googleMobileAds: GoogleMobileAds }) {
  const { AdsConsent, BannerAd, BannerAdSize, TestIds, default: mobileAds } = googleMobileAds;
  const { width } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const adUnitId = isUsingTestAds ? TestIds.ADAPTIVE_BANNER : (process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID ?? LIVE_BANNER_AD_UNIT_ID);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        await AdsConsent.gatherConsent();
        const consent = await AdsConsent.getConsentInfo();
        if (!consent.canRequestAds) return;
        await mobileAds().initialize();
        if (active) setReady(true);
      } catch {
        // A previously stored consent response can still permit a request when the network is unavailable.
        try {
          await mobileAds().initialize();
          if (active) setReady(true);
        } catch {
          // The game stays fully playable when advertising is unavailable.
        }
      }
    };
    void initialize();
    return () => { active = false; };
  }, [AdsConsent, mobileAds]);

  if (!ready) return null;

  return <View style={[styles.slot, loaded && styles.slotLoaded]}>
    <BannerAd
      unitId={adUnitId}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      width={Math.max(1, width - 32)}
      requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      onAdLoaded={() => setLoaded(true)}
      onAdFailedToLoad={() => setLoaded(false)}
    />
  </View>;
}

const styles = StyleSheet.create({
  slot: { alignItems: 'center', justifyContent: 'flex-end', marginTop: 'auto' },
  slotLoaded: { minHeight: 52, paddingTop: 8 },
});

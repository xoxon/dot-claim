import { useCallback, useEffect, useRef } from 'react';

import { getGoogleMobileAds, isUsingTestAds, prepareGoogleMobileAds, type GoogleMobileAds } from './RewardedAdOffer';

type Action = () => void;

type InterstitialInstance = {
  load: () => void;
  show: () => Promise<void>;
  addAdEventsListener: (listener: (event: { type: string; payload?: unknown }) => void) => () => void;
};

const FALLBACK_AFTER_MS = 8_000;

/**
 * Preloads an interstitial during an online match, then places it directly
 * between a completed match and the player's next action. We deliberately do
 * not use a React Native Modal here: native Google full-screen ads must not be
 * stacked on the result modal, otherwise iOS can swallow the button tap.
 */
export function useOnlineInterstitial() {
  const googleMobileAds = getGoogleMobileAds();
  const adRef = useRef<InterstitialInstance | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const loadedRef = useRef(false);
  const loadingRef = useRef(false);
  const pendingActionRef = useRef<Action | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const loadNextAdRef = useRef<() => void>(() => undefined);

  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  }, []);

  const runPendingAction = useCallback(() => {
    clearFallback();
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  }, [clearFallback]);

  const loadNextAd = useCallback(() => {
    if (!googleMobileAds || loadingRef.current || loadedRef.current || !mountedRef.current) return;

    const { AdEventType, InterstitialAd, TestIds } = googleMobileAds;
    const unitId = isUsingTestAds
      ? TestIds.INTERSTITIAL
      : process.env.EXPO_PUBLIC_ADMOB_ONLINE_INTERSTITIAL_UNIT_ID;

    // A production unit has not been supplied yet. Never attempt to request an
    // empty AdMob unit ID; the game should continue cleanly instead.
    if (!unitId) {
      runPendingAction();
      return;
    }

    loadingRef.current = true;
    const interstitial = InterstitialAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: true,
    }) as InterstitialInstance;
    adRef.current = interstitial;
    unsubscribeRef.current?.();
    unsubscribeRef.current = interstitial.addAdEventsListener(({ type }) => {
      if (!mountedRef.current) return;

      if (type === AdEventType.LOADED) {
        loadingRef.current = false;
        loadedRef.current = true;

        if (pendingActionRef.current) {
          loadedRef.current = false;
          void interstitial.show().catch(() => {
            loadingRef.current = false;
            runPendingAction();
            loadNextAdRef.current();
          });
        }
        return;
      }

      if (type === AdEventType.CLOSED) {
        loadingRef.current = false;
        loadedRef.current = false;
        adRef.current = null;
        runPendingAction();
        loadNextAdRef.current();
        return;
      }

      if (type === AdEventType.ERROR) {
        loadingRef.current = false;
        loadedRef.current = false;
        adRef.current = null;
        runPendingAction();
        loadNextAdRef.current();
      }
    });
    interstitial.load();
  }, [googleMobileAds, runPendingAction]);

  loadNextAdRef.current = loadNextAd;

  useEffect(() => {
    mountedRef.current = true;
    void prepareGoogleMobileAds()
      .then(() => loadNextAd())
      .catch(() => {
        // Advertising must never leave the result screen or replay flow stuck.
        runPendingAction();
      });

    return () => {
      mountedRef.current = false;
      clearFallback();
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      adRef.current = null;
    };
  }, [clearFallback, loadNextAd, runPendingAction]);

  return useCallback((afterAd: Action) => {
    if (!googleMobileAds) {
      afterAd();
      return;
    }

    pendingActionRef.current = afterAd;
    if (loadedRef.current && adRef.current) {
      loadedRef.current = false;
      void adRef.current.show().catch(() => {
        loadingRef.current = false;
        runPendingAction();
        loadNextAd();
      });
      return;
    }

    loadNextAd();
    // A no-fill/network failure should never make the replay button unresponsive.
    fallbackTimerRef.current = setTimeout(() => runPendingAction(), FALLBACK_AFTER_MS);
  }, [googleMobileAds, loadNextAd, runPendingAction]);
}

import { useCallback, useEffect } from 'react';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';

export type GameSound = 'select' | 'connect' | 'claim' | 'rival' | 'invalid' | 'victory' | 'defeat';

export function useGameSounds(enabled: boolean) {
  const select = useAudioPlayer(require('../assets/sounds/select.wav'));
  const connect = useAudioPlayer(require('../assets/sounds/connect.wav'));
  const claim = useAudioPlayer(require('../assets/sounds/claim.wav'));
  const rival = useAudioPlayer(require('../assets/sounds/rival.wav'));
  const invalid = useAudioPlayer(require('../assets/sounds/invalid.wav'));
  const victory = useAudioPlayer(require('../assets/sounds/victory.wav'));
  const defeat = useAudioPlayer(require('../assets/sounds/defeat.wav'));

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    }).catch(() => undefined);
  }, []);

  return useCallback((sound: GameSound) => {
    if (!enabled) return;
    const player = { select, connect, claim, rival, invalid, victory, defeat }[sound];
    player.pause();
    void player.seekTo(0).catch(() => undefined).finally(() => player.play());
  }, [claim, connect, defeat, enabled, invalid, rival, select, victory]);
}

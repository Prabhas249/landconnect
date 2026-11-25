import { useEffect } from 'react';
import { AppState } from 'react-native';

import { touchPresence } from '@/data/profiles';
import { useSession } from '@/stores/session';

/** Keeps `last_seen_at` fresh while the app is in the foreground. */
export function usePresenceHeartbeat() {
  const signedIn = useSession((s) => s.status === 'signedIn');

  useEffect(() => {
    if (!signedIn) return;
    touchPresence();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') touchPresence();
    }, 45_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') touchPresence();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [signedIn]);
}

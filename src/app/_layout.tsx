import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { forgetSession, queryClient, restoreSnapshot, startSnapshots } from '@/data/query-client';
import { CallHost } from '@/features/calls/call-host';
import { usePresenceHeartbeat } from '@/features/presence';
import { useSession } from '@/stores/session';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();
// A short fade from the forest splash into the canvas instead of a hard cut.
SplashScreen.setOptions({ duration: 220, fade: true });

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.userId);
  const init = useSession((s) => s.init);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  // Paint the first screen from the last session's cache: wait for it (it is read in parallel
  // with the session check, so this rarely adds time) before mounting the navigator.
  useEffect(() => {
    if (status === 'loading') return;
    let live = true;
    (status === 'signedIn' && userId ? restoreSnapshot(userId) : Promise.resolve()).finally(() => {
      if (live) setRestored(true);
    });
    return () => {
      live = false;
    };
  }, [status, userId]);

  useEffect(() => {
    if (status === 'signedIn' && userId) return startSnapshots(userId);
  }, [status, userId]);

  // Leaving an account drops its cached chats and listings, in memory and on disk.
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === 'signedIn' && status === 'signedOut') forgetSession();
    lastStatus.current = status;
  }, [status]);

  usePresenceHeartbeat();

  if (status === 'loading' || !restored) return null;
  const signedIn = status === 'signedIn';

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      // Hide the splash only once the first screen has laid out, and one frame later so that frame
      // is on the glass: no blank canvas between the splash and Welcome / Explore.
      onLayout={() => requestAnimationFrame(() => SplashScreen.hide())}>
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
            </Stack.Protected>
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(app)" options={{ animation: 'fade' }} />
            </Stack.Protected>
          </Stack>
          {/* Listens for incoming calls anywhere in the app and presents the ringing screen. */}
          {signedIn ? <CallHost /> : null}
        </KeyboardProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { prefetchSignedIn } from '@/data/query-client';
import { canManageListings, useSession } from '@/stores/session';
import { colors } from '@/theme/tokens';

/**
 * One transition language for every push: the iOS slide with parallax (`ios_from_right` is the
 * UIKit-style push on Android and resolves to the native push, with its edge swipe-back, on iOS).
 * The full-width iOS swipe is left at the platform default: forcing it on steals horizontal drags
 * from the photo pagers and maps. Editors and composers rise as sheets (iOS page sheet with its
 * native background scale and swipe-down; on Android the tabs behind recede via `SheetDepthView`);
 * calls fade over everything. Chat dismisses the keyboard
 * with the pop, in their route files.
 */
const push = { animation: 'ios_from_right', gestureEnabled: true } as const;

const sheet = { presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: true } as const;

export default function AppLayout() {
  const userId = useSession((s) => s.userId);
  // Role only: subscribing to the whole profile would re-render the stack on every profile edit.
  const manages = canManageListings(useSession((s) => s.profile?.role));

  // Warm what the other tabs open on, once per signed-in session.
  useEffect(() => {
    if (!userId) return;
    return prefetchSignedIn({ userId, profile: useSession.getState().profile, manages });
  }, [userId, manages]);

  return (
    <Stack
      // Screens two or more levels under the top stop rendering (React Activity); the one directly
      // underneath stays live so the swipe-back reveals it as it was.
      activityEnabled
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas }, ...push }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="listing/[id]" />
      <Stack.Screen name="listing/edit" options={sheet} />
      <Stack.Screen name="listing/pick-location" />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="room/new" options={sheet} />
      <Stack.Screen name="room/[id]" />
      <Stack.Screen name="user/[id]" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="private-details" />
      <Stack.Screen name="access" />
      <Stack.Screen name="blocked" />
      <Stack.Screen
        name="call/[id]"
        options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: colors.night } }}
      />
    </Stack>
  );
}

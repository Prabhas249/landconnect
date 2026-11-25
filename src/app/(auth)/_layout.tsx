import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

export const unstable_settings = { initialRouteName: 'welcome' };

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
        // Same iOS-style push as the signed-in stack, so the app has one transition language.
        animation: 'ios_from_right',
        gestureEnabled: true,
      }}>
      <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
      <Stack.Screen name="index" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}

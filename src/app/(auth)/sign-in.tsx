import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ChevronLeft, LockKeyhole, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardController } from 'react-native-keyboard-controller';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AuthHeader } from '@/features/auth/auth-header';
import { FieldCard, FocusIcon } from '@/features/auth/auth-surface';
import { BACKEND_MISSING_MESSAGE, BackendNotice } from '@/features/auth/backend-notice';
import { DEMO_PASSWORD, DemoAccounts, demoEmail } from '@/features/auth/demo-accounts';
import { PasswordField } from '@/features/auth/password-field';
import { isBackendConfigured } from '@/lib/supabase';
import type { UserRole } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { Enter } from '@/ui/enter';
import { Field } from '@/ui/field';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

const focusNext = () => KeyboardController.setFocusTo('next');

type Pending = 'form' | UserRole | null;
type Focus = 'email' | 'password' | null;

export default function SignIn() {
  const insets = useScreenInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [focus, setFocus] = useState<Focus>(null);

  const reduced = useReducedMotion();
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));

  // A short, damped head-shake: says "not quite" without alarm.
  const nudge = () => {
    if (reduced) return;
    shake.set(
      withSequence(
        withTiming(-6, { duration: 55 }),
        withTiming(5, { duration: 75 }),
        withTiming(-3, { duration: 75 }),
        withTiming(1.5, { duration: 65 }),
        withTiming(0, { duration: 65 }),
      ),
    );
  };

  const fail = (message: string, kind: Haptics.NotificationFeedbackType) => {
    setError(message);
    nudge();
    Haptics.notificationAsync(kind);
  };

  const signIn = async (address: string, secret: string, source: Exclude<Pending, null>) => {
    if (pending) return;
    if (!isBackendConfigured) return fail(BACKEND_MISSING_MESSAGE, Haptics.NotificationFeedbackType.Warning);
    if (!address.trim() || !secret)
      return fail('Enter your email and password.', Haptics.NotificationFeedbackType.Warning);
    setError(null);
    setPending(source);
    const message = await useSession.getState().signIn(address, secret);
    // On success the root layout swaps to the app.
    setPending(null);
    if (message) {
      fail(message, Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const signInAsDemo = (role: UserRole) => {
    const address = demoEmail(role);
    setEmail(address);
    setPassword(DEMO_PASSWORD);
    signIn(address, DEMO_PASSWORD, role);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}>
          <ChevronLeft size={22} color={colors.ink} strokeWidth={2.2} />
        </IconButton>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={space[6]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[4] }]}>
        <BackendNotice />

        <AuthHeader title="Welcome back" subtitle="Sign in to pick up your conversations, calls and saved land." />

        <Enter index={3} style={styles.form}>
          <Animated.View style={shakeStyle}>
            <FieldCard>
              <Field
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (error) setError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={focusNext}
                leading={<FocusIcon icon={Mail} focused={focus === 'email'} />}
                onFocus={() => setFocus('email')}
                onBlur={() => setFocus((f) => (f === 'email' ? null : f))}
              />
              <PasswordField
                label="Password"
                placeholder="Your password"
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (error) setError(null);
                }}
                returnKeyType="go"
                onSubmitEditing={() => signIn(email, password, 'form')}
                leading={<FocusIcon icon={LockKeyhole} focused={focus === 'password'} />}
                onFocus={() => setFocus('password')}
                onBlur={() => setFocus((f) => (f === 'password' ? null : f))}
              />
              {error ? (
                <Animated.View
                  entering={reduced ? undefined : FadeIn.duration(200)}
                  style={styles.error}
                  accessibilityRole="alert">
                  <Text variant="captionStrong" tone="danger">
                    {error}
                  </Text>
                </Animated.View>
              ) : null}
              <Button
                label="Sign in"
                variant="primary"
                loading={pending === 'form'}
                disabled={pending !== null && pending !== 'form'}
                onPress={() => signIn(email, password, 'form')}
              />
            </FieldCard>
          </Animated.View>
          <PressableScale haptic="selection" onPress={() => router.replace('/sign-up')} style={styles.link}>
            <Text variant="caption" tone="secondary">
              New to LandConnect?{' '}
              <Text variant="captionStrong" tone="accent">
                Create an account
              </Text>
            </Text>
          </PressableScale>
        </Enter>

        <Enter index={4}>
          <DemoAccounts pending={pending} onSelect={signInAsDemo} />
        </Enter>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  top: { paddingHorizontal: gutter, paddingBottom: space[2] },
  content: { paddingHorizontal: gutter, paddingTop: space[2], gap: space[5] },
  form: { gap: space[1] },
  error: {
    padding: space[3],
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.dangerSoft,
  },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});

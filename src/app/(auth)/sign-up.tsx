import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ArrowRight, ChevronLeft, LockKeyhole, Mail, ShieldCheck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardController,
  KeyboardStickyView,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  FadeIn,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type LayoutAnimation,
} from 'react-native-reanimated';

import { AccountMoment, onSessionStarted, type AccountMomentState } from '@/features/auth/account-moment';
import { AuthHeader } from '@/features/auth/auth-header';
import { AUTH_CARD, FieldCard, FocusIcon, ROLE_TINT, wash } from '@/features/auth/auth-surface';
import { BACKEND_MISSING_MESSAGE, BackendNotice } from '@/features/auth/backend-notice';
import { PasswordField, passwordStrength } from '@/features/auth/password-field';
import { RoleCard } from '@/features/auth/role-card';
import { RoleGlyph } from '@/features/auth/role-glyph';
import { withAlpha } from '@/features/auth/scene';
import { SegmentedProgress } from '@/features/auth/segmented-progress';
import { errorMessage, isBackendConfigured } from '@/lib/supabase';
import { ROLE_COPY, type UserRole } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space, spring } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { Chip } from '@/ui/chip';
import { Enter } from '@/ui/enter';
import { Field } from '@/ui/field';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { ProgressSegments } from '@/ui/progress-segments';
import { useScreenInsets } from '@/ui/screen';
import { Label, Text } from '@/ui/text';

type Step = 0 | 1 | 2;
type FieldKey = 'role' | 'name' | 'city' | 'phone' | 'email' | 'password';
type Focus = 'email' | 'password' | null;
type Errors = Partial<Record<FieldKey, string>>;

const STEPS = ['Role', 'About you', 'Account'] as const;
const ROLES: UserRole[] = ['buyer', 'seller', 'broker'];
const CITIES = ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const BUTTON_HEIGHT = 56;
/** Until the footer has been measured, assume button + padding. */
const FOOTER_ESTIMATE = BUTTON_HEIGHT + space[3] + space[6];
/** Shared-axis travel: far enough to read as direction, short enough to stay calm. */
const AXIS_SHIFT = space[8];

const focusNext = () => KeyboardController.setFocusTo('next');

const STRENGTH_COLOR = [colors.surfaceSunken, colors.highlight, colors.accentBright, colors.accent, colors.accent];
const CANVAS_CLEAR = withAlpha(colors.canvas, 0);

export default function SignUp() {
  const insets = useScreenInsets();
  const reduced = useReducedMotion();
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);

  const [step, setStep] = useState<Step>(0);
  const [navigated, setNavigated] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [moment, setMoment] = useState<AccountMomentState>('hidden');
  const [footerHeight, setFooterHeight] = useState(0);
  const [focus, setFocus] = useState<Focus>(null);

  // Read by the layout-animation worklets at the moment they run, so an outgoing step
  // always slides the way the user is travelling — even though it rendered before the change.
  const direction = useSharedValue<1 | -1>(1);
  const stepProgress = useSharedValue(0);

  useEffect(() => {
    stepProgress.set(reduced ? step + 1 : withSpring(step + 1, spring.gentle));
  }, [step, reduced, stepProgress]);

  const goTo = (next: Step) => {
    direction.set(next > step ? 1 : -1);
    setNavigated(true);
    setStep(next);
    setResult(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const back = () => {
    if (submitting) return;
    if (step > 0) goTo((step - 1) as Step);
    else if (router.canGoBack()) router.back();
    else router.replace('/welcome');
  };

  // Android back steps through the flow before leaving it, and is ignored while the account is being made.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (submitting) return true;
      if (step === 0) return false;
      direction.set(-1);
      setNavigated(true);
      setStep((step - 1) as Step);
      return true;
    });
    return () => sub.remove();
  }, [step, submitting, direction]);

  const clearError = (key: FieldKey) => {
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Errors = {};
    if (step === 0 && !role) next.role = 'Choose a role to continue.';
    if (step === 1) {
      if (name.trim().length < 2) next.name = 'Enter your full name.';
      if (city.trim().length < 2) next.city = 'Enter the city you are based in.';
      if (phone.length > 0 && phone.length !== 10) next.phone = 'Enter a 10-digit mobile number, or leave it empty.';
    }
    if (step === 2) {
      if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
      if (password.length < 8) next.password = 'Use at least 8 characters.';
    }
    setErrors(next);
    const ok = Object.keys(next).length === 0;
    if (!ok) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    return ok;
  };

  const submit = async () => {
    if (!role) return goTo(0);
    if (!isBackendConfigured) {
      setResult(BACKEND_MISSING_MESSAGE);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    KeyboardController.dismiss();
    setSubmitting(true);
    setResult(null);
    setMoment('working');
    // The seal lands as soon as a session exists; the store still decides when the app takes over.
    const stopWatching = onSessionStarted(() => {
      setMoment('done');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
    let error: string | null;
    try {
      error = await useSession.getState().signUp({
        email,
        password,
        displayName: name,
        role,
        city,
        phone: phone ? `+91${phone}` : undefined,
      });
    } catch (e) {
      error = errorMessage(e, 'Could not create your account.');
    } finally {
      stopWatching();
    }
    // On success the root layout swaps to the app. Land the seal here too, in case the auth event
    // arrived before the listener or under a different name — the overlay must never hang on "working".
    setSubmitting(false);
    if (!error) setMoment('done');
    if (error) {
      setMoment('hidden');
      setResult(error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const onPrimary = () => {
    if (!validate()) return;
    if (step < 2) goTo((step + 1) as Step);
    else submit();
  };

  const entering = (): LayoutAnimation => {
    'worklet';
    const d = direction.get();
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateX: d * AXIS_SHIFT }],
      },
      animations: {
        opacity: withDelay(70, withTiming(1, { duration: 230, easing: Easing.out(Easing.quad) })),
        transform: [
          {
            translateX: withTiming(0, {
              duration: 360,
              easing: Easing.out(Easing.cubic),
            }),
          },
        ],
      },
    };
  };
  const exiting = (): LayoutAnimation => {
    'worklet';
    const d = direction.get();
    return {
      initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
      animations: {
        opacity: withTiming(0, {
          duration: 130,
          easing: Easing.in(Easing.quad),
        }),
        transform: [
          {
            translateX: withTiming(-d * AXIS_SHIFT, {
              duration: 240,
              easing: Easing.in(Easing.cubic),
            }),
          },
        ],
      },
    };
  };

  const onFooterLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h !== footerHeight) setFooterHeight(h);
  };

  const footerSpace = (footerHeight || FOOTER_ESTIMATE + insets.bottom) + space[4];
  const strength = passwordStrength(password);
  const resultIsInfo = result ? /inbox|sign in to continue/i.test(result) : false;

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <IconButton label={step > 0 ? 'Previous step' : 'Back'} onPress={back}>
          <ChevronLeft size={22} color={colors.ink} strokeWidth={2.2} />
        </IconButton>
        <View style={styles.progress}>
          <View style={styles.progressLabels}>
            <Animated.View key={`n${step}`} entering={navigated && !reduced ? FadeIn.duration(220) : undefined}>
              <Label>{`Step ${step + 1} of 3`}</Label>
            </Animated.View>
            <Animated.View
              key={`s${step}`}
              entering={navigated && !reduced ? FadeIn.duration(220).delay(60) : undefined}>
              <Label tone="secondary">{STEPS[step]}</Label>
            </Animated.View>
          </View>
          <SegmentedProgress total={3} value={stepProgress} height={space[1] + 2} />
        </View>
      </View>

      <KeyboardAwareScrollView
        ref={scrollRef}
        bottomOffset={footerSpace}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: footerSpace }]}>
        <BackendNotice />

        <Animated.View
          key={step}
          entering={navigated && !reduced ? entering : undefined}
          exiting={reduced ? undefined : exiting}
          style={styles.step}>
          {step === 0 ? (
            <>
              <AuthHeader
                titleVariant="title"
                title="How will you use LandConnect?"
                subtitle="Your role decides what your account can do. It is set once and cannot be changed later."
              />
              <View style={styles.cards} accessibilityRole="radiogroup">
                {ROLES.map((r, i) => (
                  <Enter key={r} index={i} delay={80}>
                    <RoleCard
                      role={r}
                      selected={role === r}
                      onSelect={(next) => {
                        setRole(next);
                        clearError('role');
                      }}
                    />
                  </Enter>
                ))}
              </View>
              {errors.role ? (
                <Text variant="caption" tone="danger">
                  {errors.role}
                </Text>
              ) : null}
              <PressableScale haptic="selection" onPress={() => router.replace('/sign-in')} style={styles.inlineLink}>
                <Text variant="caption" tone="secondary">
                  Already have an account?{' '}
                  <Text variant="captionStrong" tone="accent">
                    Sign in
                  </Text>
                </Text>
              </PressableScale>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <View style={styles.intro}>
                <Text variant="title">Tell us about you</Text>
                <Text variant="body" tone="secondary">
                  You can switch to an anonymous handle at any time in privacy settings.
                </Text>
              </View>
              <FieldCard>
                <Field
                  label="Full name"
                  placeholder="Ananya Rao"
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    clearError('name');
                  }}
                  error={errors.name}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={focusNext}
                />
                <View style={styles.group}>
                  <Field
                    label="City"
                    placeholder="Where you are based"
                    value={city}
                    onChangeText={(t) => {
                      setCity(t);
                      clearError('city');
                    }}
                    error={errors.city}
                    autoCapitalize="words"
                    textContentType="addressCity"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={focusNext}
                  />
                  <View style={styles.cityChips}>
                    {CITIES.map((c) => (
                      <Chip
                        key={c}
                        label={c}
                        selected={city === c}
                        onPress={() => {
                          setCity(c);
                          clearError('city');
                        }}
                      />
                    ))}
                  </View>
                </View>
                <View style={styles.group}>
                  <Field
                    label="Phone · optional"
                    placeholder="10-digit mobile"
                    value={phone}
                    onChangeText={(t) => {
                      setPhone(t.replace(/\D/g, '').slice(0, 10));
                      clearError('phone');
                    }}
                    error={errors.phone}
                    keyboardType="number-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    maxLength={10}
                    leading={
                      <Text variant="bodyStrong" tone="tertiary" style={styles.figure}>
                        +91
                      </Text>
                    }
                  />
                  <View style={styles.privacyNote}>
                    <View style={styles.privacyIcon}>
                      <LockKeyhole size={15} color={colors.accent} strokeWidth={2.2} />
                    </View>
                    <Text variant="caption" tone="secondary" style={styles.flex}>
                      Stored privately. Never shown to other users — calls happen inside the app.
                    </Text>
                  </View>
                </View>
              </FieldCard>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <View style={styles.intro}>
                <Text variant="title">Secure your account</Text>
                <Text variant="body" tone="secondary">
                  Your email is used to sign in. It is never shown on listings or in chats.
                </Text>
              </View>
              {role ? (
                <View style={styles.roleSummary}>
                  <View style={[styles.roleSummaryGlyph, { backgroundColor: wash(ROLE_TINT[role]) }]}>
                    <RoleGlyph role={role} size={36} />
                  </View>
                  <View style={styles.flex}>
                    <Label>Creating a</Label>
                    <Text variant="bodyStrong">{`${ROLE_COPY[role].label} account`}</Text>
                  </View>
                  <ShieldCheck size={18} color={colors.accent} strokeWidth={2.1} />
                </View>
              ) : null}
              <FieldCard>
                <Field
                  label="Email"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    clearError('email');
                  }}
                  error={errors.email}
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
                <View style={styles.group}>
                  <PasswordField
                    label="Password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      clearError('password');
                    }}
                    error={errors.password}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="go"
                    onSubmitEditing={onPrimary}
                    leading={<FocusIcon icon={LockKeyhole} focused={focus === 'password'} />}
                    onFocus={() => setFocus('password')}
                    onBlur={() => setFocus((f) => (f === 'password' ? null : f))}
                  />
                  {errors.password ? null : (
                    <View style={styles.strength}>
                      <View style={styles.strengthBar}>
                        <ProgressSegments
                          total={4}
                          value={strength.score}
                          height={space[1]}
                          color={STRENGTH_COLOR[strength.score]}
                        />
                      </View>
                      <Text variant="caption" tone="tertiary" style={styles.flex}>
                        {strength.hint}
                      </Text>
                    </View>
                  )}
                </View>
              </FieldCard>
              {result ? (
                <Animated.View
                  entering={reduced ? undefined : FadeIn.duration(200)}
                  accessibilityRole="alert"
                  style={[
                    styles.result,
                    {
                      backgroundColor: resultIsInfo ? colors.accentSoft : colors.dangerSoft,
                    },
                  ]}>
                  <Text variant="captionStrong" tone={resultIsInfo ? 'accent' : 'danger'}>
                    {result}
                  </Text>
                </Animated.View>
              ) : null}
            </>
          ) : null}
        </Animated.View>
      </KeyboardAwareScrollView>

      {/* Floats over the scroll view; the content reserves its measured height so nothing hides behind it. */}
      <KeyboardStickyView style={styles.footerDock} offset={{ closed: 0, opened: insets.bottom - space[3] }}>
        <View onLayout={onFooterLayout}>
          <LinearGradient pointerEvents="none" colors={[CANVAS_CLEAR, colors.canvas]} style={styles.footerFade} />
          <View style={[styles.footer, { paddingBottom: insets.bottom }]}>
            <Button
              label={step < 2 ? 'Continue' : 'Create account'}
              variant={step < 2 ? 'primary' : 'accent'}
              loading={submitting}
              onPress={onPrimary}
              trailing={step < 2 ? <ArrowRight size={18} color={colors.inkOnDark} strokeWidth={2.2} /> : undefined}
            />
          </View>
        </View>
      </KeyboardStickyView>

      <AccountMoment state={moment} />
    </View>
  );
}

const SUMMARY_PAD = space[3];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: gutter,
    paddingBottom: space[3],
  },
  progress: { flex: 1, gap: space[2] },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  content: { paddingHorizontal: gutter, paddingTop: space[3], gap: space[4] },
  step: { gap: space[5] },
  intro: { gap: space[2] },
  cards: { gap: space[3] },
  group: { gap: space[3] },
  cityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  figure: { fontVariant: ['tabular-nums'] },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
  },
  privacyIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: SUMMARY_PAD,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...AUTH_CARD,
  },
  roleSummaryGlyph: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strength: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  strengthBar: { width: 96 },
  result: {
    padding: space[3],
    borderRadius: radius.md,
    borderCurve: 'continuous',
  },
  inlineLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footerDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  footerFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -space[6],
    height: space[6],
  },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: space[3],
    backgroundColor: colors.canvas,
  },
});

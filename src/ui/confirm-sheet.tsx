import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, curve, duration, radius, space, spring } from '@/theme/tokens';

import { Button } from './button';
import { Text } from './text';

export type ConfirmSheetTone = 'danger' | 'accent';

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  /** One short line under the title. */
  message?: string;
  icon?: LucideIcon;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for destructive actions (red confirm), `accent` for everything else. */
  tone?: ConfirmSheetTone;
  /**
   * Runs after the sheet has finished sliding away, so the action never fights the exit
   * (navigation, sign-out, a system picker).
   */
  onConfirm: () => void;
  /** Cancel, backdrop tap, swipe down and Android back all land here. Set `visible` false. */
  onClose: () => void;
};

const SHEET_R = radius.xl;
const ICON = 56;
/** Drag distance (fraction of sheet height) or downward fling speed that dismisses. */
const DISMISS_AT = 0.28;
const FLING = 900;
/** Calm: critically damped, no overshoot, settles in about half a second. */
const OPEN = { ...spring.sheet, overshootClamping: true };
const CLOSE = { duration: duration.base + 40, easing: Easing.bezier(...curve.inOut) };
const FALLBACK_H = 360;

const TONE = {
  danger: { icon: colors.danger, wash: colors.dangerSoft, button: 'danger' as const },
  accent: { icon: colors.accent, wash: colors.accentSoft, button: 'accent' as const },
};

/**
 * Bottom-sheet confirmation in the app's light language: a dimmed backdrop fades in, the sheet
 * rises on a calm spring with an icon in a soft circle, a title, one line, and two stacked buttons.
 * Swipe down, tap the backdrop or press Android back to dismiss. All motion runs on the UI thread.
 */
export const ConfirmSheet = memo(function ConfirmSheet({
  visible,
  title,
  message,
  icon: Icon,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onClose,
}: ConfirmSheetProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const height = useSharedValue(FALLBACK_H);
  const confirmed = useRef(false);
  // Latest callbacks, so the close animation's completion never calls a stale one.
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  const finish = useCallback(() => {
    setMounted(false);
    if (confirmed.current) {
      confirmed.current = false;
      onConfirmRef.current();
    }
  }, []);

  useEffect(() => {
    if (visible) {
      confirmed.current = false;
      drag.set(0);
      setMounted(true);
      progress.set(reduced ? withTiming(1, { duration: duration.fast }) : withSpring(1, OPEN));
    } else {
      progress.set(
        withTiming(0, reduced ? { duration: duration.fast } : CLOSE, (done) => {
          if (done) scheduleOnRN(finish);
        }),
      );
    }
  }, [visible, reduced, progress, drag, finish]);

  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    failOffsetX: [-16, 16],
    onUpdate: (e) => {
      'worklet';
      const y = e.translationY;
      // Free downward, a stiff rubber band upward.
      drag.set(y > 0 ? y : y * 0.15);
    },
    onDeactivate: (e) => {
      'worklet';
      if (drag.get() > height.get() * DISMISS_AT || e.velocityY > FLING) {
        scheduleOnRN(onClose);
      } else {
        drag.set(withSpring(0, { ...spring.sheet, velocity: e.velocityY }));
      }
    },
  });

  const backdropStyle = useAnimatedStyle(() => {
    const h = height.get();
    const pulled = h > 0 ? Math.min(1, Math.max(0, drag.get()) / h) : 0;
    return { opacity: progress.get() * (1 - pulled * 0.8) };
  });
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.get(), [0, 1], [height.get() + space[6], 0]) + drag.get() }],
  }));

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      height.set(e.nativeEvent.layout.height);
    },
    [height],
  );

  const onConfirmPress = useCallback(() => {
    if (tone === 'danger') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    confirmed.current = true;
    onClose();
  }, [tone, onClose]);

  const t = TONE[tone];

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {/* Android modals live outside the app's root view, so gestures need their own root. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={`${cancelLabel}, dismiss`}
          />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View
            onLayout={onLayout}
            accessibilityViewIsModal
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space[4]) + space[2] }, sheetStyle]}>
            <View style={styles.grabber} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />

            <View style={styles.copy}>
              {Icon ? (
                <View style={[styles.icon, { backgroundColor: t.wash }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Icon size={24} color={t.icon} strokeWidth={2.1} />
                </View>
              ) : null}
              <Text variant="title" center accessibilityRole="header">
                {title}
              </Text>
              {message ? (
                <Text variant="body" tone="secondary" center style={styles.message}>
                  {message}
                </Text>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Button label={confirmLabel} variant={t.button} haptic={false} onPress={onConfirmPress} />
              <Button label={cancelLabel} variant="soft" haptic="selection" onPress={onClose} />
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space[2],
    paddingHorizontal: space[5],
    borderTopLeftRadius: SHEET_R,
    borderTopRightRadius: SHEET_R,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(16,32,28,0.05)',
    boxShadow: '0 -12px 32px rgba(16,32,28,0.08)',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineStrong,
    marginBottom: space[5],
  },
  copy: { alignItems: 'center', gap: space[2], paddingHorizontal: space[2] },
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: ICON / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[2],
  },
  message: { maxWidth: 300 },
  actions: { gap: space[2], marginTop: space[6] },
});

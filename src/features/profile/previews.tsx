import { CheckCheck, Phone, PhoneOff, Video } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useReducedMotion, withSpring, withTiming } from 'react-native-reanimated';

import type { CallPermission, Profile } from '@/lib/types';
import { publicName } from '@/lib/format';
import { colors, radius, space, spring } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Text } from '@/ui/text';

/** Spring to 0/1 for a boolean, or jump when reduced motion is on. */
function useSwitch(on: boolean) {
  const reduced = useReducedMotion();
  return useDerivedValue(() => (reduced ? withTiming(on ? 1 : 0, { duration: 0 }) : withSpring(on ? 1 : 0, spring.gentle)));
}

/** Two stacked layers that cross-fade with a small vertical slide. */
function Swap({ on, a, b, height }: { on: boolean; a: ReactNode; b: ReactNode; height: number }) {
  const p = useSwitch(on);
  const aStyle = useAnimatedStyle(() => ({ opacity: 1 - p.get(), transform: [{ translateY: p.get() * -6 }] }));
  const bStyle = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: (1 - p.get()) * 6 }] }));
  return (
    <View style={{ height }}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.swap, aStyle]}>{a}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.swap, bStyle]}>{b}</Animated.View>
    </View>
  );
}

/** Sunken "their screen" frame under a setting. */
function TheySee({ children }: { children: ReactNode }) {
  return (
    <View style={styles.frame}>
      <Text variant="captionStrong" tone="tertiary">
        They see
      </Text>
      {children}
    </View>
  );
}

/** Last-seen setting: a chat header whose presence line and dot appear or vanish. */
export function PresencePreview({ profile }: { profile: Profile }) {
  const p = useSwitch(profile.show_last_seen);
  const dot = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ scale: p.get() }] }));
  const name = publicName(profile);
  return (
    <TheySee>
      <View style={styles.header}>
        <View>
          <Avatar profile={profile} size={36} onColor={colors.surfaceMuted} />
          <Animated.View style={[styles.dot, dot]} />
        </View>
        <View style={styles.flex}>
          <Text variant="captionStrong" numberOfLines={1}>
            {name}
          </Text>
          <Swap
            on={profile.show_last_seen}
            height={18}
            a={
              <Text variant="caption" tone="tertiary">
                No presence shown
              </Text>
            }
            b={
              <Text variant="caption" tone="accent">
                online
              </Text>
            }
          />
        </View>
      </View>
    </TheySee>
  );
}

/** Read receipts: their sent message, with ticks that turn green only when receipts are on. */
export function ReceiptsPreview({ on }: { on: boolean }) {
  const p = useSwitch(on);
  const read = useAnimatedStyle(() => ({ opacity: p.get() }));
  const sent = useAnimatedStyle(() => ({ opacity: 1 - p.get() }));
  return (
    <TheySee>
      <View style={styles.bubble}>
        <Text variant="caption" style={styles.flexShrink}>
          Sharing the survey sketch now.
        </Text>
        <View style={styles.ticks}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, sent]}>
            <CheckCheck size={14} color={colors.inkTertiary} strokeWidth={2.3} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, read]}>
            <CheckCheck size={14} color={colors.accent} strokeWidth={2.3} />
          </Animated.View>
        </View>
      </View>
      <Swap
        on={on}
        height={18}
        a={
          <Text variant="caption" tone="tertiary" style={styles.right}>
            Delivered. Read status hidden.
          </Text>
        }
        b={
          <Text variant="caption" tone="secondary" style={styles.right}>
            Read
          </Text>
        }
      />
    </TheySee>
  );
}

const CALL_NOTE: Record<CallPermission, string> = {
  everyone: 'Call buttons are live in every chat.',
  contacts: 'Live only in chats you already have.',
  nobody: 'Calls are off. They can still message.',
};

/** Call permission: the call buttons in their chat header, live or switched off. */
export function CallsPreview({ value }: { value: CallPermission }) {
  const p = useSwitch(value !== 'nobody');
  const live = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ scale: 0.85 + 0.15 * p.get() }] }));
  const off = useAnimatedStyle(() => ({ opacity: 1 - p.get(), transform: [{ scale: 1 - 0.15 * p.get() }] }));
  return (
    <TheySee>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="caption" tone="secondary">
            {CALL_NOTE[value]}
          </Text>
        </View>
        <View style={styles.callButtons}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.callRow, live]}>
            <View style={[styles.callButton, styles.callLive]}>
              <Phone size={15} color={colors.inkOnDark} strokeWidth={2.2} />
            </View>
            <View style={[styles.callButton, styles.callLive]}>
              <Video size={15} color={colors.inkOnDark} strokeWidth={2.2} />
            </View>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.callRow, off]}>
            <View style={[styles.callButton, styles.callOff]}>
              <PhoneOff size={15} color={colors.inkTertiary} strokeWidth={2.2} />
            </View>
          </Animated.View>
        </View>
      </View>
    </TheySee>
  );
}

// Previews sit inside a padding-5 card (radius xl 28), so their inner radius is 8 (xs).
const INNER = radius.xl - space[5];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  right: { textAlign: 'right' },
  swap: { justifyContent: 'center' },
  frame: {
    gap: space[2],
    padding: space[3],
    marginBottom: space[2],
    borderRadius: INNER,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceMuted,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 40 },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.accentBright,
    borderWidth: 2,
    borderColor: colors.surfaceMuted,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    alignSelf: 'flex-end',
    maxWidth: '88%',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderBottomRightRadius: radius.xs / 2,
    borderCurve: 'continuous',
    backgroundColor: colors.bubbleOut,
  },
  ticks: { width: 16, height: 16 },
  callButtons: { width: 36 * 2 + space[2], height: 36 },
  callRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2] },
  callButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  callLive: { backgroundColor: colors.accent },
  callOff: { backgroundColor: colors.surfaceSunken },
});

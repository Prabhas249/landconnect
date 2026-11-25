import { BadgeCheck, CircleAlert, MessageCircle, Phone, Search, Users, type LucideIcon } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ROLE_COPY, type Profile, type UserRole } from '@/lib/types';
import { publicName } from '@/lib/format';
import { colors, maxStagger, palette, radius, space } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Chip } from '@/ui/chip';
import { Enter } from '@/ui/enter';
import { Label, Text } from '@/ui/text';

// ── identity bits

export function VerifiedTick({ size = 15 }: { size?: number }) {
  return <BadgeCheck size={size} color={colors.accent} strokeWidth={2.2} accessibilityLabel="Verified" />;
}

export function RoleChip({ role }: { role: UserRole }) {
  return <Chip mono label={ROLE_COPY[role].label} tone="neutral" />;
}

/**
 * Staggered entrance for the first screenful of a list only. Rows created later by scrolling
 * appear instantly, so a fast fling never waits on a delayed fade.
 */
export function ListEnter({ index, children, style }: { index: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  // Same wrapper either way, so a recycled row crossing the stagger cap never remounts (which
  // would replay its entrance mid-scroll).
  return (
    <Enter index={index} style={style} disabled={index > maxStagger}>
      {children}
    </Enter>
  );
}

// ── live indicator

/** Mint dot with a breathing halo. Runs entirely on the UI thread. */
export function LiveDot({ size = 8, color = colors.accentBright }: { size?: number; color?: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
  }, [t]);
  const halo = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - t.get()),
    transform: [{ scale: 1 + t.get() * 1.6 }],
  }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }, halo]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

export function LiveBadge({ label = 'Live', tone = 'light' }: { label?: string; tone?: 'light' | 'dark' }) {
  const dark = tone === 'dark';
  return (
    <View style={[styles.liveBadge, { backgroundColor: dark ? colors.ink : colors.accentSoft }]}>
      <LiveDot size={6} color={dark ? colors.accentBright : colors.accent} />
      <Label tone={dark ? 'onDark' : 'accent'}>{label}</Label>
    </View>
  );
}

// ── avatar stack

export function AvatarStack({
  people,
  max = 4,
  size = 30,
}: {
  people: Profile[];
  max?: number;
  size?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const overlap = Math.round(size * 0.32);
  return (
    <View style={styles.stack}>
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: shown.length - i }}>
          <Avatar name={publicName(p)} seed={p.id} uri={p.avatar_url} size={size} ring />
        </View>
      ))}
      {extra > 0 ? (
        <View
          style={[
            styles.overflow,
            { width: size, height: size, borderRadius: size / 2, marginLeft: -overlap },
          ]}>
          <Text variant="label" tone="secondary" style={styles.tabular}>
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ── skeletons

/** Shared breathing value so every skeleton block pulses in phase. */
function usePulse() {
  const t = useSharedValue(0.55);
  useEffect(() => {
    t.set(withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.55, { duration: 700 })), -1, false));
  }, [t]);
  return useAnimatedStyle(() => ({ opacity: t.get() }));
}

export function Bone({ style }: { style: StyleProp<ViewStyle> }) {
  const pulse = usePulse();
  return <Animated.View style={[styles.bone, style, pulse]} />;
}

export function RowSkeleton({ count = 6, avatar = 52 }: { count?: number; avatar?: number }) {
  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Bone style={{ width: avatar, height: avatar, borderRadius: avatar / 2 }} />
          <View style={styles.skeletonText}>
            <Bone style={{ width: `${48 + ((i * 17) % 30)}%`, height: 14, borderRadius: radius.xs }} />
            <Bone style={{ width: `${70 - ((i * 11) % 25)}%`, height: 12, borderRadius: radius.xs }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function CardSkeleton({ count = 2, height = 180 }: { count?: number; height?: number }) {
  return (
    <View style={styles.skeletonCards}>
      {Array.from({ length: count }, (_, i) => (
        <Bone key={i} style={{ height, borderRadius: radius.xl }} />
      ))}
    </View>
  );
}

// ── empty / error states

export type EmptyArt = 'chats' | 'rooms' | 'calls' | 'search' | 'error' | 'thread';

const EMPTY_ICON: Record<EmptyArt, LucideIcon> = {
  chats: MessageCircle,
  thread: MessageCircle,
  rooms: Users,
  calls: Phone,
  search: Search,
  error: CircleAlert,
};

/** Icon-in-circle on a soft glow, the same chip language as the rest of the app. */
function EmptyGraphic({ art }: { art: EmptyArt }) {
  const Icon = EMPTY_ICON[art];
  const error = art === 'error';
  return (
    <View style={[styles.emptyHalo, { backgroundColor: error ? palette.redWash : palette.mintWash }]}>
      <View style={styles.emptyDisc}>
        <Icon size={26} color={error ? palette.red : palette.green} strokeWidth={2} />
      </View>
    </View>
  );
}

export function EmptyState({
  art,
  title,
  body,
  action,
  style,
}: {
  art: EmptyArt;
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; leading?: ReactNode };
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.empty, style]}>
      <EmptyGraphic art={art} />
      <View style={styles.emptyText}>
        <Text variant="heading" center>
          {title}
        </Text>
        <Text variant="caption" tone="secondary" center>
          {body}
        </Text>
      </View>
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          leading={action.leading}
          variant="soft"
          size="sm"
          block={false}
          style={styles.emptyAction}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1] + 2,
    height: 24,
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  stack: { flexDirection: 'row', alignItems: 'center' },
  overflow: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSunken,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  bone: { backgroundColor: colors.surfaceSunken, borderCurve: 'continuous' },
  skeletonList: { gap: space[5], paddingTop: space[3] },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  skeletonText: { flex: 1, gap: space[2] },
  skeletonCards: { gap: space[4], paddingTop: space[3] },
  emptyHalo: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[3],
  },
  emptyDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(16,32,28,0.05)',
    boxShadow: '0 12px 32px rgba(16,32,28,0.08)',
  },
  empty: { alignItems: 'center', paddingVertical: space[8], paddingHorizontal: space[6], gap: space[2] },
  emptyText: { gap: space[1], maxWidth: 280 },
  emptyAction: { alignSelf: 'center', marginTop: space[3] },
});

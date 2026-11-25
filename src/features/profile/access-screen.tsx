import { useIsFocused } from 'expo-router';
import { Check, Database, Lock, LockKeyhole } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { RoleGlyph } from '@/features/auth/role-glyph';
import { ROLE_COPY, type UserRole } from '@/lib/types';
import { useSession } from '@/stores/session';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Enter } from '@/ui/enter';
import { Screen, useScreenInsets } from '@/ui/screen';
import { Label, Text } from '@/ui/text';

import { StackTopBar, useScrollY, useStackContentTop } from './chrome';
import { Group } from './parts';

const ROLES: UserRole[] = ['buyer', 'seller', 'broker'];

/* Grid. Card padding 12; three 48pt role columns leave 152pt for labels on a 360dp phone,
   so every label is one line. Rows are 44 tall; group heads 32. */
const PAD = space[3];
const COL = 48;
const HEAD_H = space[16];
const GROUP_H = space[8];
const LINE_H = 44;
const MARK = 22;

type Capability = {
  /** One line beside three columns at 360dp: keep under ~18 characters. */
  title: string;
  roles: UserRole[];
  /** Enforced by a database policy or function, not only by the app. */
  db: boolean;
};

type Section = { title: string; rows: Capability[] };

// Truthful to supabase/migrations/0001_init.sql: every `db` row maps to an RLS policy or a checked function.
const SECTIONS: Section[] = [
  {
    title: 'Discover',
    rows: [
      { title: 'Browse listings', roles: ['buyer', 'seller', 'broker'], db: true },
      { title: 'Keep a shortlist', roles: ['buyer'], db: false },
    ],
  },
  {
    title: 'Publish',
    rows: [
      { title: 'Publish listings', roles: ['seller', 'broker'], db: true },
      { title: 'Edit your listings', roles: ['seller', 'broker'], db: true },
    ],
  },
  {
    title: 'Contact & privacy',
    rows: [
      { title: 'Chat and call', roles: ['buyer', 'seller', 'broker'], db: true },
      { title: 'Host meeting rooms', roles: ['buyer', 'seller', 'broker'], db: true },
      { title: 'See phone or email', roles: [], db: true },
      { title: 'Change your role', roles: [], db: true },
    ],
  },
];

/** Running row index at the start of each section, so marks land row by row across groups. */
const SECTION_START = SECTIONS.reduce<number[]>((acc, _s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + SECTIONS[i - 1].rows.length], []);

/** 0..1 entrance clock shared by the whole matrix, so marks land row by row. */
function useEntrance() {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    t.set(withDelay(260, withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) })));
  }, [reduced, t]);
  return t;
}

function Mark({ allowed, mine, order, t }: { allowed: boolean; mine: boolean; order: number; t: SharedValue<number> }) {
  const start = 0.12 + order * 0.07;
  const style = useAnimatedStyle(() => {
    const p = interpolate(t.get(), [start, start + 0.22], [0, 1], 'clamp');
    return { opacity: p, transform: [{ scale: 0.6 + 0.4 * p }] };
  });
  return (
    <View style={styles.cell}>
      <Animated.View style={style}>
        {allowed ? (
          <View style={[styles.yes, mine ? styles.yesMine : null]}>
            <Check size={13} color={mine ? colors.inkOnDark : colors.inkSecondary} strokeWidth={3} />
          </View>
        ) : (
          <View style={styles.no} />
        )}
      </Animated.View>
    </View>
  );
}

function RoleCard({ role }: { role: UserRole }) {
  const copy = ROLE_COPY[role];
  const focused = useIsFocused();
  return (
    <Card padding={4} style={styles.roleCard}>
      <View style={styles.roleRow}>
        <View style={styles.glyph}>
          <RoleGlyph role={role} size={48} active={focused} />
        </View>
        <View style={styles.roleCopy}>
          <Label>Your role</Label>
          <Text variant="heading" numberOfLines={1}>
            {copy.label}
          </Text>
          <Text variant="caption" tone="secondary">
            {copy.blurb}
          </Text>
        </View>
      </View>
      <View style={styles.fixed}>
        <LockKeyhole size={14} color={colors.inkSecondary} strokeWidth={2.2} />
        <Text variant="caption" tone="secondary" style={styles.flex}>
          Set when you signed up. The database will not let it change.
        </Text>
      </View>
    </Card>
  );
}

/**
 * Role-based access made visible: one column per role with the member's own lifted out,
 * rows grouped by what people come to do, and a lock on every rule the database enforces.
 */
function Matrix({ role }: { role: UserRole }) {
  const t = useEntrance();
  const mineIndex = ROLES.indexOf(role);
  const mineLabel = ROLE_COPY[role].label;

  const column = useAnimatedStyle(() => {
    const p = interpolate(t.get(), [0, 0.3], [0, 1], 'clamp');
    return { opacity: p, transform: [{ scaleY: 0.94 + 0.06 * p }] };
  });

  return (
    <Card padding={3}>
      <View>
        <Animated.View pointerEvents="none" style={[styles.column, { right: (ROLES.length - 1 - mineIndex) * COL }, column]} />

        <View style={styles.head}>
          <View style={styles.flex} />
          {ROLES.map((r) => {
            const mine = r === role;
            return (
              <View key={r} style={styles.headCell} accessible accessibilityLabel={mine ? `${ROLE_COPY[r].label}, your role` : ROLE_COPY[r].label}>
                <RoleGlyph role={r} size={28} />
                <Text variant="captionStrong" tone={mine ? 'accent' : 'tertiary'} numberOfLines={1}>
                  {ROLE_COPY[r].label}
                </Text>
              </View>
            );
          })}
        </View>

        {SECTIONS.map((s, si) => (
          <View key={s.title}>
            <View style={styles.groupHead}>
              <Label numberOfLines={1}>{s.title}</Label>
            </View>
            {s.rows.map((c, i) => {
              const mine = c.roles.includes(role);
              const rowOrder = SECTION_START[si] + i;
              return (
                <View
                  key={c.title}
                  style={[styles.line, i > 0 ? styles.lineRule : null]}
                  accessible
                  accessibilityLabel={`${c.title}: ${mine ? 'allowed' : 'not available'} for ${mineLabel}${c.db ? ', enforced by the database' : ''}`}>
                  <View style={styles.lineTitle}>
                    <Text variant="caption" tone={mine ? 'ink' : 'secondary'} numberOfLines={1} style={styles.lineText}>
                      {c.title}
                    </Text>
                    {c.db ? <Lock size={11} color={colors.inkTertiary} strokeWidth={2.4} /> : null}
                  </View>
                  {ROLES.map((r) => (
                    <Mark key={r} allowed={c.roles.includes(r)} mine={r === role} order={rowOrder} t={t} />
                  ))}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </Card>
  );
}

function Enforcement() {
  return (
    <Card padding={4} tone="accent" elevated={false} style={styles.enforced}>
      <View style={styles.enforcedIcon}>
        <Database size={18} color={colors.accent} strokeWidth={2.1} />
      </View>
      <View style={styles.roleCopy}>
        <Text variant="bodyStrong">Enforced by the database</Text>
        <Text variant="caption" tone="secondary">
          Rules with a lock are row-level security policies on LandConnect&apos;s servers, so they hold even outside this
          app. Contact details are never readable by another member.
        </Text>
      </View>
    </Card>
  );
}

export default function AccessScreen() {
  const insets = useScreenInsets();
  const contentTop = useStackContentTop();
  const role = useSession((s) => s.profile?.role);
  const { scrollY, onScroll } = useScrollY();

  return (
    <Screen>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingTop: contentTop, paddingBottom: insets.bottom }]}>
        {role ? (
          <>
            <Enter index={0}>
              <RoleCard role={role} />
            </Enter>
            <Enter index={1}>
              <Group title="What each role can do" hint="Your column is highlighted.">
                <Matrix role={role} />
              </Group>
            </Enter>
            <Enter index={2}>
              <Enforcement />
            </Enter>
          </>
        ) : (
          <>
            <View style={[styles.skeleton, { height: 148 }]} />
            <View style={[styles.skeleton, { height: 520 }]} />
          </>
        )}
      </Animated.ScrollView>
      <StackTopBar scrollY={scrollY} title="Role and access" />
    </Screen>
  );
}

// Matrix card padding 12 inside radius xl (28): the highlight column takes radius 16 (md).
const COLUMN_R = radius.xl - PAD;
// Role card padding 16 inside radius xl (28): inner tiles take radius 12 (sm).
const INNER_R = radius.xl - space[4];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: gutter, gap: space[6] },
  roleCard: { gap: space[4] },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  roleCopy: { flex: 1, gap: 2 },
  glyph: {
    width: space[16],
    height: space[16],
    borderRadius: INNER_R,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: INNER_R,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceMuted,
  },
  column: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: COL,
    borderRadius: COLUMN_R,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
  },
  head: { flexDirection: 'row', alignItems: 'center', height: HEAD_H },
  headCell: { width: COL, alignItems: 'center', justifyContent: 'center', gap: 2 },
  groupHead: { height: GROUP_H, justifyContent: 'flex-end', paddingBottom: space[1], paddingHorizontal: space[2] },
  line: { flexDirection: 'row', alignItems: 'center', height: LINE_H },
  lineRule: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.hairline },
  lineTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[1], paddingLeft: space[2], paddingRight: space[1] },
  lineText: { flexShrink: 1 },
  cell: { width: COL, height: LINE_H, alignItems: 'center', justifyContent: 'center' },
  yes: {
    width: MARK,
    height: MARK,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesMine: { backgroundColor: colors.accent },
  no: { width: 10, height: 2, borderRadius: radius.pill, backgroundColor: colors.inkTertiary },
  enforced: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  enforcedIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeleton: { borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
});

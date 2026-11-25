import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Eye, Heart, LandPlot, MessageCircle, Phone, Users, type LucideIcon } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { qk } from '@/data/keys';
import { fetchMyListings, fetchSavedIds } from '@/data/listings';
import { formatNumber } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/types';
import { canManageListings, currentUserId } from '@/stores/session';
import { colors, font, palette, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { LIGHT_CARD, TINT } from './parts';

type ActivityCounts = { conversations: number; rooms: number; calls: number };

/**
 * Head-only counts (no rows transferred). RLS already scopes conversations to the
 * member and calls to their participants, so the filters only separate the kinds.
 */
async function fetchActivityCounts(): Promise<ActivityCounts> {
  const me = currentUserId();
  if (!me) return { conversations: 0, rooms: 0, calls: 0 };
  const [direct, rooms, calls] = await Promise.all([
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('kind', 'direct'),
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('kind', 'room'),
    supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .not('callee_id', 'is', null)
      .or(`caller_id.eq.${me},callee_id.eq.${me}`),
  ]);
  const err = direct.error ?? rooms.error ?? calls.error;
  if (err) throw new Error(err.message);
  return { conversations: direct.count ?? 0, rooms: rooms.count ?? 0, calls: calls.count ?? 0 };
}

const activityKey = ['profile-activity'] as const;

const COUNT_MS = 900;
const FRAME_MS = 32;
const FOCUS_FRESH_MS = 15_000;

/**
 * Tabular figure that counts up the first time its value arrives. Later refreshes
 * (every time the tab regains focus) just settle on the new number, so the strip
 * does not replay its entrance. Only this text re-renders while it runs.
 */
function CountUp({ value, delay }: { value: number; delay: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const played = useRef(false);

  useEffect(() => {
    if (reduced || played.current) {
      setShown(value);
      return;
    }
    const start = Date.now() + delay;
    let raf = 0;
    let last = 0;
    const step = () => {
      const now = Date.now();
      const t = Math.min(1, Math.max(0, (now - start) / COUNT_MS));
      // ~30 fps is plenty for a figure ticking up and halves the JS-thread renders; equal
      // integers bail out in React, so small counts render only as often as they change.
      if (t >= 1 || now - last >= FRAME_MS) {
        last = now;
        setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      }
      if (t < 1) raf = requestAnimationFrame(step);
      else played.current = true;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, reduced]);

  return (
    <Text style={styles.figure} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
      {formatNumber(shown)}
    </Text>
  );
}

type Stat = { key: string; caption: string; value: number | undefined; href: Href; a11y: string; icon: LucideIcon; tint: string };

const Cell = memo(function Cell({ stat, index }: { stat: Stat; index: number }) {
  const Icon = stat.icon;
  return (
    <PressableScale
      to={0.96}
      haptic="selection"
      onPress={() => router.push(stat.href)}
      accessibilityLabel={`${stat.a11y}: ${stat.value ?? 'loading'}`}
      style={styles.cell}>
      <View style={[styles.chip, { backgroundColor: stat.tint }]}>
        <Icon size={14} color={palette.white} strokeWidth={2.5} />
      </View>
      {stat.value !== undefined ? <CountUp value={stat.value} delay={index * 80} /> : <View style={styles.bone} />}
      <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.caption}>
        {stat.caption}
      </Text>
    </PressableScale>
  );
});

/**
 * What the member has done, as four tabular figures in one row. Each opens the tab
 * it counts. Listing and saved counts share their caches with the Land tab.
 */
export function StatsStrip({ role }: { role: UserRole }) {
  const manages = canManageListings(role);

  const counts = useQuery({ queryKey: activityKey, queryFn: fetchActivityCounts });
  const listings = useQuery({ queryKey: qk.myListings, queryFn: fetchMyListings, enabled: manages });
  const saved = useQuery({ queryKey: qk.savedIds, queryFn: fetchSavedIds, enabled: !manages });

  const refetchCounts = counts.refetch;
  const countsAt = useRef(0);
  countsAt.current = counts.dataUpdatedAt;
  // Chats and calls happen on other tabs; refresh when the profile comes back into view, unless
  // the counts are only seconds old (tab hopping should not fire three count queries each time).
  useFocusEffect(
    useCallback(() => {
      if (Date.now() - countsAt.current < FOCUS_FRESH_MS) return;
      // No cancel: a focus right after mount joins the first request instead of restarting it.
      refetchCounts({ cancelRefetch: false });
    }, [refetchCounts]),
  );

  const c = counts.data;
  const views = listings.data?.reduce((s, l) => s + l.views, 0);

  const stats: Stat[] = [
    ...(manages
      ? [
          { key: 'listings', caption: 'Listings', value: listings.data?.length, href: '/land' as Href, a11y: 'Your listings', icon: LandPlot, tint: TINT.green },
          { key: 'views', caption: 'Views', value: views, href: '/land' as Href, a11y: 'Views across your listings', icon: Eye, tint: TINT.blue },
        ]
      : [
          { key: 'saved', caption: 'Saved', value: saved.data?.length, href: '/land' as Href, a11y: 'Saved parcels', icon: Heart, tint: TINT.green },
          { key: 'rooms', caption: 'Rooms', value: c?.rooms, href: '/chats' as Href, a11y: 'Meeting rooms', icon: Users, tint: TINT.blue },
        ]),
    { key: 'chats', caption: 'Chats', value: c?.conversations, href: '/chats', a11y: 'Direct conversations', icon: MessageCircle, tint: TINT.amber },
    { key: 'calls', caption: 'Calls', value: c?.calls, href: '/chats', a11y: 'Calls through the relay', icon: Phone, tint: palette.mint },
  ];

  const failed = counts.isError || listings.isError || saved.isError;

  if (failed) {
    return (
      <Card padding={2} style={LIGHT_CARD}>
        <View style={styles.failed}>
          <Text variant="caption" tone="secondary" style={styles.flex}>
            Your activity could not be counted right now.
          </Text>
          <Button
            label="Retry"
            variant="soft"
            size="sm"
            block={false}
            onPress={() => {
              counts.refetch();
              if (manages) listings.refetch();
              else saved.refetch();
            }}
          />
        </View>
      </Card>
    );
  }

  return (
    <Card padding={2} style={[styles.row, LIGHT_CARD]}>
      {stats.map((s, i) => (
        <Cell key={s.key} stat={s} index={i} />
      ))}
    </Card>
  );
}

export function StatsStripSkeleton() {
  return <View style={styles.skeleton} />;
}

// Card padding 8 inside radius xl (28): cells press with an inner radius of 20.
const INNER = radius.xl - space[2];
const CHIP = 28;
const CELL_H = 104;
const STRIP_H = space[2] * 2 + CELL_H + 2;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: CELL_H,
    borderRadius: INNER,
    borderCurve: 'continuous',
  },
  chip: { width: CHIP, height: CHIP, borderRadius: CHIP / 2, alignItems: 'center', justifyContent: 'center', marginBottom: space[2] },
  caption: { fontSize: 12, lineHeight: 16 },
  figure: { fontFamily: font.semibold, fontSize: 26, lineHeight: 30, letterSpacing: -0.9, color: colors.ink, fontVariant: ['tabular-nums'] },
  bone: { width: space[8], height: 20, marginVertical: 4, borderRadius: radius.xs, backgroundColor: colors.surfaceSunken },
  failed: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 64, paddingLeft: space[3], paddingRight: space[1] },
  skeleton: { height: STRIP_H, borderRadius: radius.xl, borderCurve: 'continuous', backgroundColor: colors.surfaceSunken },
});

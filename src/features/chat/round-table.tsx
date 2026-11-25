import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  ZoomIn,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { publicName } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { colors, maxStagger, palette, radius, shadow, stagger } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Text } from '@/ui/text';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

const HEIGHT = 300;
const SEAT = 46;
const MAX_SEATS = 8;

/**
 * Top-down meeting table: the room's members seated around an oval, a parcel outline drawn on the
 * table surface (what the meeting is about), and a slow survey ring orbiting the seats.
 * Seats come in one by one; when a session is live the table breathes.
 */
export function RoundTable({ members, live, hostId }: { members: Profile[]; live: boolean; hostId?: string }) {
  const { width } = useWindowDimensions();
  const cx = width / 2;
  const cy = HEIGHT / 2 + 6;
  const rx = Math.min(width * 0.27, 120);
  const ry = 58;
  // Seats sit on a wider oval around the table edge.
  const sx = rx + 52;
  const sy = ry + 44;

  const seated = members.slice(0, MAX_SEATS);
  const extra = members.length - seated.length;
  const seats = extra > 0 ? seated.length + 1 : seated.length;

  const orbit = useSharedValue(0);
  const breathe = useSharedValue(0);
  useEffect(() => {
    orbit.set(withRepeat(withTiming(-60, { duration: 9000, easing: Easing.linear }), -1, false));
  }, [orbit]);
  useEffect(() => {
    if (live) breathe.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false));
    else breathe.set(withTiming(0, { duration: 300 }));
  }, [breathe, live]);

  const orbitProps = useAnimatedProps(() => ({ strokeDashoffset: orbit.get() }));
  const halo = useAnimatedStyle(() => ({
    opacity: live ? 0.5 * (1 - breathe.get()) : 0,
    transform: [{ scale: 1 + breathe.get() * 0.18 }],
  }));

  // A small irregular parcel on the tabletop, scaled to the table.
  const parcel = [
    [-0.42, -0.2],
    [0.08, -0.5],
    [0.46, -0.18],
    [0.3, 0.42],
    [-0.28, 0.36],
  ]
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(cx + x * rx * 0.62).toFixed(1)} ${(cy + y * ry * 0.7).toFixed(1)}`)
    .join(' ');

  return (
    <View style={{ width, height: HEIGHT }}>
      <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="tableGlow" cx="50%" cy="50%" rx="60%" ry="60%">
            <Stop offset="0" stopColor={palette.mintWash} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.canvas} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="tableTop" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.white} />
            <Stop offset="1" stopColor={colors.surfaceMuted} />
          </LinearGradient>
          {/* Fades the bottom of the hero into the canvas so it never sits in a box. */}
          <LinearGradient id="fadeOut" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.7" stopColor={colors.canvas} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.canvas} stopOpacity={1} />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={width} height={HEIGHT} fill="url(#tableGlow)" />

        {/* Survey rings on the floor */}
        <G fill="none" stroke={palette.green}>
          <Ellipse cx={cx} cy={cy} rx={sx + 34} ry={sy + 26} strokeOpacity={0.06} />
          <AnimatedEllipse
            cx={cx}
            cy={cy}
            rx={sx}
            ry={sy}
            strokeOpacity={0.18}
            strokeDasharray="2 8"
            strokeLinecap="round"
            animatedProps={orbitProps}
          />
        </G>

        {/* Table: soft cast shadow, top, contour rings and the parcel under discussion */}
        <Ellipse cx={cx} cy={cy + 10} rx={rx + 4} ry={ry + 2} fill={palette.forest} fillOpacity={0.07} />
        <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#tableTop)" />
        <G fill="none" stroke={palette.green} strokeWidth={1}>
          <Ellipse cx={cx} cy={cy} rx={rx * 0.82} ry={ry * 0.78} strokeOpacity={0.1} />
          <Ellipse cx={cx} cy={cy} rx={rx * 0.62} ry={ry * 0.56} strokeOpacity={0.08} />
        </G>
        <Path d={`${parcel} Z`} fill={palette.mintSoft} fillOpacity={0.55} stroke={palette.green} strokeWidth={1.4} strokeDasharray="4 3" strokeLinejoin="round" />
        <Path
          d={`M${cx} ${cy - 6}v12M${cx - 6} ${cy}h12`}
          stroke={palette.green}
          strokeOpacity={0.7}
          strokeWidth={1.4}
          strokeLinecap="round"
        />

        <Rect x={0} y={0} width={width} height={HEIGHT} fill="url(#fadeOut)" />
      </Svg>

      {/* Live halo around the table */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.halo,
          { left: cx - rx - 8, top: cy - ry - 8, width: (rx + 8) * 2, height: (ry + 8) * 2, borderRadius: rx + 8 },
          halo,
        ]}
      />

      {Array.from({ length: seats }, (_, i) => {
        const a = -Math.PI / 2 + (i / Math.max(1, seats)) * Math.PI * 2;
        const x = cx + Math.cos(a) * sx - SEAT / 2;
        const y = cy + Math.sin(a) * sy - SEAT / 2;
        const p = seated[i];
        return (
          <Animated.View
            key={p?.id ?? 'more'}
            entering={ZoomIn.delay(160 + Math.min(i, maxStagger) * stagger * 1.6)
              .springify()
              .damping(22)
              .stiffness(190)}
            style={[styles.seat, { left: x, top: y }]}>
            {p ? (
              <View style={p.id === hostId ? styles.hostRing : null}>
                <Avatar name={publicName(p)} seed={p.id} uri={p.avatar_url} size={SEAT} ring />
              </View>
            ) : (
              <View style={styles.more}>
                <Text variant="label" tone="secondary" style={styles.tabular}>
                  +{extra}
                </Text>
              </View>
            )}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  halo: { position: 'absolute', borderWidth: 2, borderColor: colors.accentBright },
  seat: { position: 'absolute', width: SEAT, height: SEAT, boxShadow: shadow.card, borderRadius: SEAT / 2 },
  hostRing: { margin: -2, borderWidth: 2, borderColor: colors.accentBright, borderRadius: radius.pill },
  more: {
    width: SEAT,
    height: SEAT,
    borderRadius: SEAT / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabular: { fontVariant: ['tabular-nums'] },
});

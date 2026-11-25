import { useIsFocused } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

import { LogoMark } from '@/features/auth/logo-mark';
import { colors, font, palette, radius, space, spring, type } from '@/theme/tokens';
import { Label, Text } from '@/ui/text';

/** Loop clock that only runs while `active`; parked at 0 (a calm, empty frame) otherwise. */
function useLoop(active: boolean, period: number) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  const run = active && !reduced;
  useEffect(() => {
    if (!run) {
      cancelAnimation(t);
      return;
    }
    // Restart from zero: a resumed repeat would otherwise loop from wherever it paused.
    t.set(0);
    t.set(withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(t);
  }, [run, period, t]);
  return t;
}

/* ------------------------------------------------------------------ */
/* How calls stay private                                               */
/* ------------------------------------------------------------------ */

const NODE = space[12];
const TILE = space[12];
const TOP = space[3];
const CY = TOP + NODE / 2;
const DOT = 10;
const HALO = 18;
const TRACK_GAP = space[2];
const RELAY_PERIOD = 4200;
const DIAGRAM_H = TOP + NODE + space[2] + 18 + space[1] + 22;

/* One loop: your call crosses to them through the relay, then theirs comes back.
   Each packet travels a track, disappears into the relay, and leaves from the other side.
   When it lands, that side's masked number flashes: still locked. */
type Phase = { a: number; b: number; c: number; d: number };
const OUT: Phase = { a: 0, b: 0.18, c: 0.26, d: 0.44 };
const BACK: Phase = { a: 0.5, b: 0.68, c: 0.76, d: 0.94 };

/** "B-2041" -> "B41", the stamp the app's avatars use for anonymous members. */
function stampOf(serial: string) {
  const m = /^([A-Z])-?(\d+)/.exec(serial);
  return m ? `${m[1]}${m[2].slice(-2)}` : serial.slice(0, 3);
}

function usePacket(t: SharedValue<number>, phase: Phase, from: number[], to: number[]) {
  return useAnimatedStyle(() => {
    const v = t.get();
    const x = interpolate(v, [phase.a, phase.b, phase.c, phase.d], [from[0], from[1], to[0], to[1]], 'clamp');
    const f = 0.025;
    const o = interpolate(
      v,
      [phase.a, phase.a + f, phase.b - f, phase.b, phase.c, phase.c + f, phase.d - f, phase.d],
      [0, 1, 1, 0, 0, 1, 1, 0],
      'clamp',
    );
    return { opacity: o, transform: [{ translateX: x - HALO / 2 }] };
  });
}

function ringStyle(v: number, start: number) {
  'worklet';
  const p = interpolate(v, [start, start + 0.2], [0, 1], 'clamp');
  return { opacity: p > 0 && p < 1 ? 0.55 * (1 - p) : 0, transform: [{ scale: 1 + 0.45 * p }] };
}

function Packet({ style }: { style: object }) {
  return (
    <Animated.View pointerEvents="none" style={[styles.packet, style]}>
      <View style={styles.halo} />
      <View style={styles.dot} />
    </Animated.View>
  );
}

function Endpoint({
  serial,
  caption,
  align,
  t,
  landsAt,
  tone,
}: {
  serial: string;
  caption: string;
  align: 'left' | 'right';
  t: SharedValue<number>;
  landsAt: number;
  tone: 'accent' | 'highlight';
}) {
  // The landing flash: the number's lock pill brightens, then settles.
  const flash = useAnimatedStyle(() => ({
    opacity: interpolate(t.get(), [landsAt, landsAt + 0.03, landsAt + 0.1], [0, 1, 0], 'clamp'),
  }));
  const lock = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(t.get(), [landsAt, landsAt + 0.03, landsAt + 0.1], [1, 1.25, 1], 'clamp') }],
  }));
  const end = align === 'right';
  return (
    <View style={[styles.endpoint, end ? styles.endRight : styles.endLeft]}>
      <View style={[styles.node, tone === 'accent' ? styles.nodeMine : styles.nodeTheirs]}>
        <Text style={styles.stamp} tone={tone}>
          {stampOf(serial)}
        </Text>
      </View>
      <Text style={styles.serial} tone="ink" numberOfLines={1}>
        {caption}
      </Text>
      <View style={styles.numberRow}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.numberFlash, flash]} />
        <Animated.View style={lock}>
          <Lock size={11} color={colors.accent} strokeWidth={2.6} />
        </Animated.View>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          +91 •••••
        </Text>
      </View>
    </View>
  );
}

/**
 * Two anonymous identities on a call. The call travels through the LandConnect relay in both
 * directions and each side's phone number stays locked. Loops only while `active` (on screen
 * and focused); reduced motion shows the still diagram.
 */
export function CallRelayDiagram({ mine, theirs, active }: { mine: string; theirs: string; active: boolean }) {
  const [w, setW] = useState(0);
  const t = useLoop(active && w > 0, RELAY_PERIOD);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    if (next !== w) setW(next);
  };

  const mid = w / 2;
  const leftA = NODE + TRACK_GAP;
  const leftB = mid - TILE / 2 - TRACK_GAP;
  const rightA = mid + TILE / 2 + TRACK_GAP;
  const rightB = w - NODE - TRACK_GAP;

  const out = usePacket(t, OUT, [leftA, leftB], [rightA, rightB]);
  const back = usePacket(t, BACK, [rightB, rightA], [leftB, leftA]);

  // The relay takes each packet in: a small press, and a mint ring spreading off the tile.
  const relay = useAnimatedStyle(() => {
    const v = t.get();
    const hit = (s: number) => interpolate(v, [s, s + 0.04, s + 0.1], [0, 1, 0], 'clamp');
    return { transform: [{ scale: 1 - 0.05 * Math.max(hit(OUT.b), hit(BACK.b)) }] };
  });
  const ringOut = useAnimatedStyle(() => ringStyle(t.get(), OUT.b));
  const ringBack = useAnimatedStyle(() => ringStyle(t.get(), BACK.b));

  return (
    <View
      style={styles.diagram}
      onLayout={onLayout}
      accessible
      accessibilityLabel={`Diagram: you, ${mine}, and the other participant, ${theirs}, are connected through the LandConnect relay. Both phone numbers stay hidden.`}>
      {w > 0 ? (
        <>
          <Svg width={w} height={DIAGRAM_H} style={StyleSheet.absoluteFill}>
            {[
              [leftA, leftB],
              [rightA, rightB],
            ].map(([a, b]) => (
              <Line
                key={a}
                x1={a}
                y1={CY}
                x2={b}
                y2={CY}
                stroke={palette.mintSoft}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray="1 6"
              />
            ))}
          </Svg>

          <Endpoint serial={mine} caption={`You · ${mine}`} align="left" t={t} landsAt={BACK.d} tone="accent" />
          <Endpoint serial={theirs} caption={theirs} align="right" t={t} landsAt={OUT.d} tone="highlight" />

          <View style={[styles.relay, { left: mid - TILE / 2 }]}>
            <Animated.View pointerEvents="none" style={[styles.ring, ringOut]} />
            <Animated.View pointerEvents="none" style={[styles.ring, ringBack]} />
            <Animated.View style={relay}>
              <LogoMark size={TILE} />
            </Animated.View>
          </View>
          <View style={[styles.relayLabel, { left: mid - space[12] }]}>
            <Label tone="accent">Relay</Label>
          </View>

          <Packet style={out} />
          <Packet style={back} />
        </>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Blocked list empty state                                             */
/* ------------------------------------------------------------------ */

const PERSON = (cx: number, cy: number) => `M${cx - 14} ${cy + 16}c1.5-8 7-11 14-11s12.5 3 14 11`;
const GATE_PERIOD = 2600;

/**
 * Empty state for the blocked list: you on the left, a closed gate in the middle, and a
 * signal from the other side that reaches the gate and stops there with a soft ripple.
 * Nothing crosses; nothing is announced.
 */
export function BlockedIllustration({ width = 280 }: { width?: number }) {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const gate = useSharedValue(reduced ? 1 : 0);
  const t = useLoop(focused, GATE_PERIOD);

  useEffect(() => {
    if (reduced) return;
    gate.set(withDelay(240, withSpring(1, spring.gentle)));
  }, [reduced, gate]);

  const k = width / 280;
  const height = 128 * k;

  // Travel 0..0.42, hit at 0.42, ripple and hold to 0.75, rest.
  const signal = useAnimatedStyle(() => {
    const v = t.get();
    const x = interpolate(v, [0, 0.42], [206, 166], 'clamp') * k;
    const o = interpolate(v, [0, 0.06, 0.36, 0.42], [0, 1, 1, 0], 'clamp');
    return { opacity: o, transform: [{ translateX: x - (DOT * k) / 2 }] };
  });
  const ripple = useAnimatedStyle(() => {
    const p = interpolate(t.get(), [0.42, 0.75], [0, 1], 'clamp');
    return { opacity: p > 0 && p < 1 ? 0.6 * (1 - p) : 0, transform: [{ scale: 1 + 0.4 * p }] };
  });
  const gateStyle = useAnimatedStyle(() => {
    const hold = interpolate(t.get(), [0.42, 0.47, 0.6], [0, 1, 0], 'clamp');
    return {
      opacity: gate.get(),
      transform: [{ scale: (0.8 + 0.2 * gate.get()) * (1 - 0.04 * hold) }, { translateX: 2 * hold * k }],
    };
  });

  const box = { left: 118 * k, top: 42 * k, width: 44 * k, height: 44 * k };

  return (
    <View style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height} viewBox="0 0 280 128">
        {/* Survey grid ground, fading at the edges */}
        <G opacity={0.5}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Line key={`v${i}`} x1={40 + i * 33} y1={18} x2={40 + i * 33} y2={110} stroke={palette.mintSoft} strokeWidth={1} strokeOpacity={i === 0 || i === 6 ? 0.35 : 1} />
          ))}
          {[0, 1, 2].map((i) => (
            <Line key={`h${i}`} x1={24} y1={30 + i * 34} x2={256} y2={30 + i * 34} stroke={palette.mintSoft} strokeWidth={1} />
          ))}
        </G>

        {/* Your side: a steady line up to the gate */}
        <Line x1={70} y1={64} x2={118} y2={64} stroke={palette.green} strokeWidth={2} strokeLinecap="round" />
        {/* Their side: a quiet dotted track that ends at the gate */}
        <Line x1={210} y1={64} x2={162} y2={64} stroke={colors.inkTertiary} strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" strokeDasharray="1 6" />

        <Circle cx={46} cy={64} r={24} fill={palette.mintWash} />
        <Circle cx={46} cy={57} r={7} fill={palette.green} />
        <Path d={PERSON(46, 61)} fill={palette.green} />

        <Circle cx={234} cy={64} r={24} fill={colors.surfaceSunken} />
        <Circle cx={234} cy={57} r={7} fill={colors.inkTertiary} />
        <Path d={PERSON(234, 61)} fill={colors.inkTertiary} />
      </Svg>

      <Animated.View
        style={[styles.signal, { top: 64 * k - (DOT * k) / 2, width: DOT * k, height: DOT * k, borderRadius: (DOT * k) / 2 }, signal]}
      />
      <Animated.View style={[styles.ripple, box, { borderRadius: 14 * k }, ripple]} />

      {/* The gate is a view so its motion is plain transform + opacity. */}
      <Animated.View style={[styles.gate, box, gateStyle]}>
        <Svg width={44 * k} height={44 * k} viewBox="118 42 44 44">
          <Rect x={118} y={42} width={44} height={44} rx={14} fill={palette.forest} />
          <Circle cx={140} cy={64} r={9} stroke={palette.mint} strokeWidth={2.4} fill="none" />
          <Line x1={133.6} y1={70.4} x2={146.4} y2={57.6} stroke={palette.mint} strokeWidth={2.4} strokeLinecap="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

// The relay ring sits on the logo tile's own corner radius (10 of 48 units).
const TILE_R = (10 * TILE) / 48;

const styles = StyleSheet.create({
  diagram: { height: DIAGRAM_H, alignSelf: 'stretch' },
  endpoint: { position: 'absolute', top: TOP, gap: space[1] },
  endLeft: { left: 0, alignItems: 'flex-start' },
  endRight: { right: 0, alignItems: 'flex-end' },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[1],
  },
  nodeMine: { backgroundColor: colors.accentSoft },
  nodeTheirs: { backgroundColor: colors.highlightSoft },
  stamp: { fontFamily: font.mono, fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight, letterSpacing: 0.2 },
  serial: { fontFamily: font.mono, fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: 22,
    paddingHorizontal: space[2],
    marginHorizontal: -space[2],
    borderRadius: radius.pill,
  },
  numberFlash: { backgroundColor: colors.accentSoft, borderRadius: radius.pill },
  relay: { position: 'absolute', top: TOP, width: TILE, height: TILE },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: TILE_R,
    borderCurve: 'continuous',
    borderWidth: 2,
    borderColor: palette.mint,
  },
  relayLabel: { position: 'absolute', top: TOP + TILE + space[2], width: space[12] * 2, alignItems: 'center' },
  packet: { position: 'absolute', left: 0, top: CY - HALO / 2, width: HALO, height: HALO, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.pill, backgroundColor: palette.mint, opacity: 0.3 },
  dot: { width: DOT, height: DOT, borderRadius: radius.pill, backgroundColor: colors.accent },
  signal: { position: 'absolute', left: 0, backgroundColor: colors.inkTertiary },
  ripple: { position: 'absolute', borderWidth: 2, borderColor: palette.mint, borderCurve: 'continuous' },
  gate: { position: 'absolute' },
});

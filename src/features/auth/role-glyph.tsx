import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

import type { UserRole } from '@/lib/types';
import { palette } from '@/theme/tokens';

export type RoleGlyphProps = {
  role: UserRole;
  size?: number;
  /**
   * When provided, the glyph is built from layers and plays a small loop while `true`:
   * the buyer's lens scans, the seller's flag lifts in the wind, the broker's portfolio breathes.
   */
  active?: boolean;
};

/**
 * Small isometric illustrations, one per role, on a 56-unit grid.
 * Buyer: a parcel under a survey lens. Seller: a staked parcel with a marker post.
 * Broker: a stacked portfolio of parcels.
 */
export function RoleGlyph({ role, size = 56, active }: RoleGlyphProps) {
  if (active === undefined) {
    return (
      <Svg width={size} height={size} viewBox="0 0 56 56">
        {role === 'buyer' ? (
          <>
            <BuyerGround />
            <BuyerLens />
          </>
        ) : role === 'seller' ? (
          <>
            <SellerGround />
            <SellerFlag />
          </>
        ) : (
          <>
            <BrokerLayer level={0} />
            <BrokerLayer level={1} />
            <BrokerLayer level={2} />
          </>
        )}
      </Svg>
    );
  }
  return <LayeredGlyph role={role} size={size} active={active} />;
}

const LOOP_MS = 2400;

function LayeredGlyph({ role, size, active }: { role: UserRole; size: number; active: boolean }) {
  const reduced = useReducedMotion();
  const phase = useSharedValue(0);
  const amp = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    if (active) {
      phase.set(0);
      phase.set(withRepeat(withTiming(1, { duration: LOOP_MS, easing: Easing.linear }), -1, false));
      amp.set(withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) }));
    } else {
      // Ease back to rest first, then stop the clock so idle cards cost nothing.
      amp.set(
        withTiming(0, { duration: 280 }, (finished) => {
          'worklet';
          if (finished) cancelAnimation(phase);
        }),
      );
    }
  }, [active, reduced, phase, amp]);

  const u = size / 56;

  if (role === 'buyer') {
    return (
      <Frame size={size}>
        <Layer size={size}>
          <BuyerGround />
        </Layer>
        <Moving size={size} phase={phase} amp={amp} kind="scan" unit={u}>
          <BuyerLens />
        </Moving>
      </Frame>
    );
  }
  if (role === 'seller') {
    return (
      <Frame size={size}>
        <Layer size={size}>
          <SellerGround />
        </Layer>
        <Moving size={size} phase={phase} amp={amp} kind="flag" unit={u}>
          <SellerFlag />
        </Moving>
      </Frame>
    );
  }
  return (
    <Frame size={size}>
      <Layer size={size}>
        <BrokerLayer level={0} />
      </Layer>
      <Moving size={size} phase={phase} amp={amp} kind="lift1" unit={u}>
        <BrokerLayer level={1} />
      </Moving>
      <Moving size={size} phase={phase} amp={amp} kind="lift2" unit={u}>
        <BrokerLayer level={2} />
      </Moving>
    </Frame>
  );
}

function Frame({ size, children }: { size: number; children: ReactNode }) {
  return <View style={{ width: size, height: size }}>{children}</View>;
}

function Layer({ size, children }: { size: number; children: ReactNode }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg width={size} height={size} viewBox="0 0 56 56">
        {children}
      </Svg>
    </View>
  );
}

type MotionKind = 'scan' | 'flag' | 'lift1' | 'lift2';

function Moving({
  size,
  phase,
  amp,
  kind,
  unit,
  children,
}: {
  size: number;
  phase: SharedValue<number>;
  amp: SharedValue<number>;
  kind: MotionKind;
  unit: number;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const th = phase.get() * Math.PI * 2;
    const a = amp.get();
    if (kind === 'scan') {
      // A slow figure-eight over the parcel, like a lens being moved across a plan.
      return { transform: [{ translateX: Math.sin(th) * 3 * unit * a }, { translateY: Math.sin(th * 2) * 1.6 * unit * a }] };
    }
    if (kind === 'flag') {
      return { transform: [{ scaleX: 1 - (0.5 + 0.5 * Math.sin(th * 2)) * 0.2 * a }, { translateY: -Math.abs(Math.sin(th)) * 1.2 * unit * a }] };
    }
    const lift = (0.5 - 0.5 * Math.cos(th)) * a;
    return { transform: [{ translateY: -lift * (kind === 'lift2' ? 3.2 : 1.4) * unit }] };
  });

  // The flag hinges on its pole.
  const origin = kind === 'flag' ? { transformOrigin: [33 * unit, 17 * unit, 0] as [number, number, number] } : null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, origin, style]}>
      <Svg width={size} height={size} viewBox="0 0 56 56">
        {children}
      </Svg>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Art                                                                  */
/* ------------------------------------------------------------------ */

/** Isometric diamond centred on (cx, cy) with half-width w. */
function diamond(cx: number, cy: number, w: number) {
  const h = w * 0.58;
  return `M${cx} ${cy - h} L${cx + w} ${cy} L${cx} ${cy + h} L${cx - w} ${cy} Z`;
}

/** Visible slab faces under a diamond, for a little depth. */
function slab(cx: number, cy: number, w: number, depth: number) {
  const h = w * 0.58;
  return {
    left: `M${cx - w} ${cy} L${cx} ${cy + h} L${cx} ${cy + h + depth} L${cx - w} ${cy + depth} Z`,
    right: `M${cx} ${cy + h} L${cx + w} ${cy} L${cx + w} ${cy + depth} L${cx} ${cy + h + depth} Z`,
  };
}

function Parcel({ cx, cy, w, fill, depth = 3 }: { cx: number; cy: number; w: number; fill: string; depth?: number }) {
  const s = slab(cx, cy, w, depth);
  return (
    <G>
      <Path d={s.left} fill={palette.green} opacity={0.55} />
      <Path d={s.right} fill={palette.forest2} opacity={0.6} />
      <Path d={diamond(cx, cy, w)} fill={fill} />
    </G>
  );
}

function BuyerGround() {
  return (
    <G>
      <Parcel cx={25} cy={32} w={17} fill={palette.mint} />
      <Path
        d="M17 32 L25 27.4 M21 34.3 L29 29.7 M25 36.6 L33 32"
        stroke={palette.white}
        strokeOpacity={0.45}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    </G>
  );
}

function BuyerLens() {
  return (
    <G>
      <Circle cx={33} cy={21} r={8} fill={palette.white} fillOpacity={0.55} stroke={palette.forest} strokeWidth={2.2} />
      <Line x1={38.8} y1={26.8} x2={44} y2={32} stroke={palette.forest} strokeWidth={2.6} strokeLinecap="round" />
      <Circle cx={33} cy={21} r={2} fill={palette.amber} />
    </G>
  );
}

function SellerGround() {
  return (
    <G>
      <Parcel cx={26} cy={34} w={18} fill={palette.mintSoft} />
      <Path
        d={diamond(26, 34, 12)}
        fill="none"
        stroke={palette.green}
        strokeWidth={1.6}
        strokeDasharray="3 2.4"
        strokeLinejoin="round"
      />
      <Line x1={33} y1={33} x2={33} y2={13} stroke={palette.forest} strokeWidth={2.2} strokeLinecap="round" />
      <Circle cx={33} cy={33.5} r={2.2} fill={palette.amber} />
    </G>
  );
}

function SellerFlag() {
  return <Path d="M33 14 L43 16.5 L33 20.5 Z" fill={palette.green} />;
}

const BROKER_FILLS = [palette.green, palette.mint, palette.mintSoft];

function BrokerLayer({ level }: { level: 0 | 1 | 2 }) {
  const cy = 38 - level * 9;
  return (
    <G>
      <Parcel cx={28} cy={cy} w={16} fill={BROKER_FILLS[level]} />
      {level === 2 ? <Circle cx={28} cy={20} r={2.2} fill={palette.amber} /> : null}
    </G>
  );
}

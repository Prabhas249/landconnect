import { Canvas, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Lock } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { formatDuration } from '@/lib/format';
import { colors, font, palette, radius, shadow, space } from '@/theme/tokens';
import { Text, type TextTone } from '@/ui/text';

import type { LinkQuality } from '../media';
import { PressableScale } from '@/ui/pressable-scale';

/**
 * Call-surface primitives shared by the incoming overlay and the call screen.
 * Calls use the app's own light language (white cards, forest ink, mint accents); only live
 * video and room tiles stay on forest-night, where they frame camera feeds. `nightGlass` is the
 * translucent white still used over video.
 */
export const nightGlass = {
  soft: 'rgba(255,255,255,0.10)',
  base: 'rgba(255,255,255,0.14)',
  strong: 'rgba(255,255,255,0.18)',
} as const;

/** `colors.night` (or any #RRGGBB token) at an opacity — for scrims that fade into the surface. */
export function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ── pulse rings (ringing) and speaking halo (live audio)

const RING_PERIOD = 2700;

function Ring({ index, size, color }: { index: number; size: number; color: string }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    t.set(
      withDelay(
        index * (RING_PERIOD / 3),
        withRepeat(withTiming(1, { duration: RING_PERIOD, easing: Easing.out(Easing.cubic) }), -1, false),
      ),
    );
    return () => cancelAnimation(t);
  }, [t, index, reduced]);

  const style = useAnimatedStyle(() => ({
    opacity: (1 - t.get()) * 0.42,
    transform: [{ scale: 1 + t.get() * 0.9 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
}

/** Three soft rings breathing out from the avatar while a call rings. */
export function PulseRings({ size, children, color = colors.accentBright }: { size: number; children: ReactNode; color?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ring index={0} size={size} color={color} />
      <Ring index={1} size={size} color={color} />
      <Ring index={2} size={size} color={color} />
      {children}
    </View>
  );
}

/** Two halos that swell with the remote voice level (0..1). */
export function SpeakingRings({ size, level, children }: { size: number; level: SharedValue<number>; children: ReactNode }) {
  const inner = useAnimatedStyle(() => ({
    opacity: 0.16 + level.get() * 0.4,
    transform: [{ scale: 1.08 + level.get() * 0.2 }],
  }));
  const outer = useAnimatedStyle(() => ({
    opacity: 0.08 + level.get() * 0.25,
    transform: [{ scale: 1.2 + level.get() * 0.45 }],
  }));
  const circle = { borderRadius: size / 2, backgroundColor: colors.accentBright };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, circle, outer]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, circle, inner]} />
      {children}
    </View>
  );
}

// ── over live video: dark scrims only (never white surfaces or glows over a camera feed)

/** Black at an opacity — the only tint used over video. */
export const videoBlack = (alpha: number) => `rgba(0,0,0,${alpha})`;
/** Dark frosted glass for chips and buttons over video. */
export const VIDEO_GLASS = videoBlack(0.35);

/** Top and bottom black 0 → 45% gradients so white text and controls stay legible over any feed. */
export function VideoScrims({ top, bottom }: { top: number; bottom: number }) {
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={[videoBlack(0.45), videoBlack(0)]}
        style={[styles.scrim, { top: 0, height: top }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[videoBlack(0), videoBlack(0.45)]}
        style={[styles.scrim, { bottom: 0, height: bottom }]}
      />
    </>
  );
}

// ── light call backdrop

/** Canvas white into the app canvas, with one soft mint glow behind the person. */
export function CallBackdrop({ glowY = 0.4 }: { glowY?: number }) {
  const { width, height } = useWindowDimensions();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[palette.white, colors.canvas]} locations={[0.1, 1]} style={StyleSheet.absoluteFill} />
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient
            c={vec(width / 2, height * glowY)}
            r={width * 0.75}
            colors={[withAlpha(palette.mint, 0.22), withAlpha(palette.mint, 0.06), withAlpha(palette.mint, 0)]}
            positions={[0, 0.55, 1]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}

/** The light card language: white, 1pt forest hairline at 5%, soft forest shadow. */
export const LIGHT_SURFACE = {
  backgroundColor: palette.white,
  borderWidth: 1,
  borderColor: 'rgba(16,32,28,0.05)',
  boxShadow: '0 1px 2px rgba(16,32,28,0.04), 0 12px 32px rgba(16,32,28,0.08)',
} as const;

// ── chips

/** "Buyer · B-2041" → "B-2041". */
function serialOf(handle: string) {
  const parts = handle.split('·');
  return (parts[parts.length - 1] ?? handle).trim();
}

const ROLE_HUE = { buyer: palette.mint, seller: palette.amber, broker: '#3B6FD8' } as const;

/** The person's anonymous ID, e.g. "S-5188", with a role-coloured dot. Never a number. */
export function IdChip({ handle, role, onVideo }: { handle: string; role?: keyof typeof ROLE_HUE; onVideo?: boolean }) {
  return (
    <View
      style={[styles.lightChip, styles.idChip, onVideo ? styles.videoChip : null]}
      accessibilityLabel={`Anonymous ID ${serialOf(handle)}`}>
      <View style={[styles.dot, { backgroundColor: role ? ROLE_HUE[role] : palette.mint }]} />
      <Text style={[styles.idText, onVideo ? styles.videoChipText : null]}>{serialOf(handle)}</Text>
    </View>
  );
}

/** "Number hidden · LandConnect call": lock in a small green circle. Phone numbers never reach a call. */
export function PrivacyLine({ onVideo }: { onVideo?: boolean }) {
  return (
    <View
      style={[styles.lightChip, onVideo ? styles.videoChip : null]}
      accessibilityLabel="Number hidden. This is a LandConnect call; neither side sees a phone number.">
      <View style={styles.lockDisc}>
        <Lock size={10} color={palette.white} strokeWidth={2.6} />
      </View>
      <Text variant="captionStrong" style={[styles.chipText, onVideo ? styles.videoChipText : null]}>
        Number hidden
        <Text variant="caption" tone={onVideo ? 'onDarkSecondary' : 'tertiary'}>
          {'  ·  LandConnect call'}
        </Text>
      </Text>
    </View>
  );
}

const BAR_HEIGHTS = [5, 8, 11] as const;

/** Three signal bars for the link quality; hidden until LiveKit has reported one. */
export function SignalBars({ quality, onVideo }: { quality: LinkQuality; onVideo?: boolean }) {
  if (quality === 'unknown') return null;
  const lit = quality === 'good' ? 3 : quality === 'weak' ? 2 : 1;
  const hue = quality === 'good' ? (onVideo ? palette.mint : palette.green) : quality === 'weak' ? palette.amber : CALM_RED;
  const dim = onVideo ? 'rgba(255,255,255,0.28)' : 'rgba(16,32,28,0.14)';
  const label = quality === 'good' ? 'Good connection' : quality === 'weak' ? 'Weak connection' : 'Connection lost';
  return (
    <View style={styles.bars} accessibilityLabel={label}>
      {BAR_HEIGHTS.map((h, i) => (
        <View key={h} style={[styles.bar, { height: h, backgroundColor: i < lit ? hue : dim }]} />
      ))}
    </View>
  );
}

/** Live mm:ss from `since` (answered_at), tabular. Only this text re-renders each second. */
export function CallTimer({ since, tone = 'ink', large = false }: { since: string | null; tone?: TextTone; large?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = since ? Math.max(0, (now - new Date(since).getTime()) / 1000) : 0;
  return (
    <Text variant={large ? 'figure' : 'figureSmall'} tone={tone} style={styles.tabular} accessibilityLabel={`Call time ${formatDuration(seconds)}`}>
      {formatDuration(seconds)}
    </Text>
  );
}

// ── round buttons

type RoundTone = 'glass' | 'on' | 'danger' | 'accent';

/** Calm red: the brand red, slightly softened, so ending a call never shouts. */
export const CALM_RED = '#D9534A';

const roundStyle: Record<RoundTone, ViewStyle> = {
  glass: LIGHT_SURFACE,
  on: { backgroundColor: palette.forest, boxShadow: '0 8px 20px rgba(16,32,28,0.22)' },
  danger: { backgroundColor: CALM_RED, boxShadow: '0 2px 4px rgba(217,83,74,0.18), 0 12px 24px rgba(217,83,74,0.26)' },
  accent: { backgroundColor: colors.accent, boxShadow: shadow.accent },
};

/** Over video: dark frosted circles; an engaged toggle is a solid white circle with a dark icon. */
const videoRoundStyle: Record<RoundTone, ViewStyle> = {
  glass: { backgroundColor: VIDEO_GLASS, overflow: 'hidden' },
  on: { backgroundColor: palette.white },
  danger: { backgroundColor: CALM_RED },
  accent: { backgroundColor: colors.accent },
};

/** Icon colour for a round button's tone (`onVideo`: the dark-scrim variant). */
export function roundInk(tone: RoundTone, onVideo = false) {
  if (onVideo) return tone === 'on' ? colors.ink : palette.white;
  return tone === 'glass' ? colors.ink : palette.white;
}

export type RoundButtonProps = {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  tone?: RoundTone;
  size?: number;
  /** Show the label under the button (incoming / end actions). */
  caption?: boolean;
  /** Caption on a dark surface (live video). */
  onDark?: boolean;
  /** Drawn over a camera feed: dark frosted glass instead of white surfaces. */
  onVideo?: boolean;
  disabled?: boolean;
};

/** Circular call action. `on` = a toggle that is engaged (muted, speaker on): forest with a white icon. */
export function RoundButton({ label, icon, onPress, tone = 'glass', size = 56, caption, onDark, onVideo, disabled }: RoundButtonProps) {
  return (
    <View style={styles.roundWrap}>
      <PressableScale
        to={0.92}
        haptic={tone === 'danger' || tone === 'accent' ? 'medium' : true}
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.round,
          { width: size, height: size, borderRadius: size / 2 },
          onVideo ? videoRoundStyle[tone] : roundStyle[tone],
          disabled ? styles.disabled : null,
        ]}>
        {onVideo && tone === 'glass' ? <BlurView tint="dark" intensity={30} style={StyleSheet.absoluteFill} /> : null}
        {icon}
      </PressableScale>
      {caption ? (
        <Text variant="captionStrong" tone={onVideo ? 'onDark' : onDark ? 'onDarkSecondary' : 'secondary'}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/** Pill action on call surfaces. */
export function NightPill({
  label,
  onPress,
  tone = 'glass',
  leading,
  onVideo,
}: {
  label: string;
  onPress: () => void;
  tone?: 'glass' | 'accent';
  leading?: ReactNode;
  /** Over a camera feed: dark glass with white text. */
  onVideo?: boolean;
}) {
  const surface = tone === 'accent' ? { backgroundColor: palette.forest, boxShadow: shadow.card } : onVideo ? styles.videoChip : LIGHT_SURFACE;
  return (
    <PressableScale accessibilityLabel={label} onPress={onPress} style={[styles.pill, surface]}>
      {leading}
      <Text variant="captionStrong" tone={tone === 'accent' || onVideo ? 'onDark' : 'ink'}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Small white status chip (reconnecting, weak signal, participant count, muted). */
export function NightChip({
  label,
  leading,
  tone = 'glass',
  style,
  onVideo,
}: {
  label: string;
  leading?: ReactNode;
  tone?: 'glass' | 'highlight';
  style?: StyleProp<ViewStyle>;
  onVideo?: boolean;
}) {
  return (
    <View
      style={[
        styles.lightChip,
        onVideo ? styles.videoChip : tone === 'highlight' ? styles.chipHighlight : null,
        style,
      ]}>
      {leading}
      <Text variant="captionStrong" style={[styles.chipText, onVideo ? styles.videoChipText : null]}>
        {label}
      </Text>
    </View>
  );
}

/** Icon colour for content inside a `NightChip`. */
export const CHIP_INK = colors.inkSecondary;
/** `CHIP_INK` for either surface. */
export const chipInk = (onVideo?: boolean) => (onVideo ? palette.white : CHIP_INK);

/** Calm transient banner from the store's `notice`. */
export function NoticeBanner({ message, onVideo }: { message: string | null; onVideo?: boolean }) {
  if (!message) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(220)}
      style={[styles.notice, onVideo ? styles.videoNotice : LIGHT_SURFACE]}>
      <Text variant="captionStrong" tone={onVideo ? 'onDark' : 'ink'} center>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 11 },
  bar: { width: 3, borderRadius: 1.5 },
  roundWrap: { alignItems: 'center', gap: space[2] },
  round: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  scrim: { position: 'absolute', left: 0, right: 0 },
  videoChip: { backgroundColor: VIDEO_GLASS, borderWidth: 0, boxShadow: 'none' },
  videoChipText: { color: palette.white },
  videoNotice: { backgroundColor: videoBlack(0.55) },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 48,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    borderCurve: 'continuous',
  },
  lightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 30,
    paddingLeft: 6,
    paddingRight: space[3],
    borderRadius: radius.pill,
    alignSelf: 'center',
    ...LIGHT_SURFACE,
    boxShadow: shadow.hair,
  },
  chipHighlight: { backgroundColor: colors.highlightSoft, borderColor: withAlpha(colors.highlight, 0.2) },
  chipText: { color: colors.ink, fontSize: 12.5 },
  idChip: { height: 26, paddingLeft: space[2], paddingRight: 10, gap: 6 },
  idText: { fontFamily: font.semibold, fontSize: 12.5, lineHeight: 16, letterSpacing: 0.2, color: colors.ink, fontVariant: ['tabular-nums'] },
  dot: { width: 6, height: 6, borderRadius: 3 },
  lockDisc: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.green },
  notice: {
    alignSelf: 'center',
    maxWidth: 340,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
});

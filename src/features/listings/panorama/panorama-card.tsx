import { useFocusEffect } from 'expo-router';
import { ChevronRight, Rotate3d } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  measure,
  useAnimatedReaction,
  useAnimatedRef,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

import { colors, radius, shadow, space } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import type { OriginRect } from '../media/overlay';
import { withAlpha } from '../meta';
import { PanoramaCanvas } from './pano-canvas';
import { PANO_FOV, wrapAngle } from './pano-shader';
import { usePanorama } from './pano-source';

const PAD = space[2];
const PREVIEW_HEIGHT = 188;
/** rad / ms — slower than the viewer; this is ambience, not a demo. */
const CARD_SPEED = 0.00007;
/** Advance the camera at ~30 fps: the motion is slow enough that 60 fps buys nothing visible. */
const FRAME_MS = 33;

export type PanoramaCardProps = {
  url: string;
  /** Inner content width of the sheet. */
  width: number;
  /** Detail-screen scroll offset, used to pause the preview once it leaves the viewport. */
  scrollY: SharedValue<number>;
  /** True while a fullscreen viewer covers the screen. */
  paused: boolean;
  onOpen: (origin: OriginRect | null, yaw: number) => void;
};

/**
 * Entry point to the 360° viewer: a live, gently turning look-around rendered by the same
 * shader at the preview tier (≤1024 px). Rotation only runs while the card is on screen, the
 * listing screen is focused, no viewer is open and reduced motion is off.
 */
export function PanoramaCard({ url, width, scrollY, paused, onOpen }: PanoramaCardProps) {
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const { image, status, retry } = usePanorama(url, 'preview');
  const canvasWidth = width - PAD * 2;

  const yaw = useSharedValue(0.6);
  const pitch = useSharedValue(-0.06);
  const fov = useSharedValue(PANO_FOV.initial * 1.1);
  const visible = useSharedValue(0);
  const carry = useSharedValue(0);
  const frameRef = useAnimatedRef<Animated.View>();
  const pressRef = useRef<ComponentRef<typeof View>>(null);
  const [focused, setFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const checkVisible = () => {
    'worklet';
    const m = measure(frameRef);
    if (!m) return;
    visible.set(m.pageY < windowHeight && m.pageY + m.height > 0 ? 1 : 0);
  };
  useAnimatedReaction(
    () => scrollY.get(),
    () => {
      checkVisible();
    },
  );

  const spin = useFrameCallback((info) => {
    'worklet';
    if (!visible.get()) return;
    const acc = carry.get() + (info.timeSincePreviousFrame ?? 16);
    if (acc < FRAME_MS) {
      carry.set(acc);
      return;
    }
    carry.set(0);
    yaw.set(wrapAngle(yaw.get() + acc * CARD_SPEED));
  }, false);

  // One gentle turn when the card first scrolls into view, then it rests: a constantly
  // redrawing shader under the scroll was the main GPU cost on the detail screen.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const on = !reduceMotion && focused && !paused && !!image && !settled;
    spin.setActive(on);
    if (!on) return;
    const t = setTimeout(() => setSettled(true), 2600);
    return () => clearTimeout(t);
  }, [spin, reduceMotion, focused, paused, image, settled]);

  const open = () => {
    const node = pressRef.current;
    const currentYaw = yaw.get();
    if (!node) {
      onOpen(null, currentYaw);
      return;
    }
    node.measureInWindow((x, y, w, h) => onOpen(w > 0 ? { x, y, width: w, height: h } : null, currentYaw));
  };

  return (
    <PressableScale
      to={0.985}
      onPress={open}
      style={styles.card}
      accessibilityLabel="Open the 360 degree site view">
      <Animated.View
        ref={frameRef}
        style={styles.frame}
        onLayout={() => scheduleOnUI(checkVisible)}>
        <View ref={pressRef} collapsable={false} style={StyleSheet.absoluteFill}>
          <PanoramaCanvas
            image={image}
            yaw={yaw}
            pitch={pitch}
            fov={fov}
            width={canvasWidth}
            height={PREVIEW_HEIGHT}
            tone="light"
          />
        </View>
        <View style={styles.badge} pointerEvents="none">
          <Rotate3d size={14} color={colors.inkOnDark} strokeWidth={2.1} />
          <Label tone="onDark">360°</Label>
        </View>
        {status === 'loading' ? (
          <View style={styles.status} pointerEvents="none">
            <Label tone="secondary">Loading site view</Label>
          </View>
        ) : status === 'error' ? (
          <PressableScale onPress={retry} style={styles.status} accessibilityLabel="Retry loading the 360 preview">
            <Label tone="highlight">Preview unavailable · retry</Label>
          </PressableScale>
        ) : null}
      </Animated.View>
      <View style={styles.text}>
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            360° site view
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            Look around the land from where the owner stood. Drag, pinch and turn.
          </Text>
        </View>
        <View style={styles.go}>
          <ChevronRight size={18} color={colors.accent} strokeWidth={2.3} />
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  card: {
    padding: PAD,
    gap: space[3],
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  frame: {
    height: PREVIEW_HEIGHT,
    borderRadius: radius.xl - PAD,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.accentSoft,
  },
  badge: {
    position: 'absolute',
    top: space[3],
    left: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: 26,
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.ink, 0.42),
  },
  status: {
    position: 'absolute',
    left: space[3],
    bottom: space[3],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    borderCurve: 'continuous',
    backgroundColor: withAlpha(colors.surface, 0.9),
  },
  text: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingBottom: space[3] },
  go: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
});

import { CloudOff, Move, RotateCcw, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import { withAlpha } from '../meta';
import { useOverlayChrome, type OriginRect } from '../media/overlay';
import { HeadingDial } from './heading-dial';
import { PanoramaCanvas } from './pano-canvas';
import { PANO_FOV, PANO_MAX_PITCH, panoramaEffect, wrapAngle } from './pano-shader';
import { releasePanorama, usePanorama } from './pano-source';

/** rad / ms — one slow turn a minute. */
const AUTO_SPEED = 0.0001;
const OPEN_MS = 320;
const RESET_MS = 520;

export type PanoramaViewerProps = {
  url: string;
  title: string;
  subtitle: string;
  /** Card rect to grow out of; omitted → plain fade. */
  origin?: OriginRect | null;
  /** Yaw the opener was showing, so the live preview continues seamlessly. */
  initialYaw?: number;
  onClose: () => void;
};

const clampPitch = (p: number) => {
  'worklet';
  return Math.min(PANO_MAX_PITCH, Math.max(-PANO_MAX_PITCH, p));
};
const clampFov = (f: number) => {
  'worklet';
  return Math.min(PANO_FOV.max, Math.max(PANO_FOV.min, f));
};

/** Fullscreen 360° look-around, rendered as an overlay inside the listing screen. */
export function PanoramaViewer({ url, title, subtitle, origin, initialYaw = 0, onClose }: PanoramaViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const full = usePanorama(url, 'full');
  const preview = usePanorama(url, 'preview');
  const image = full.image ?? preview.image;
  const sharpening = !full.image && !!preview.image && full.status === 'loading';
  const failed = !image && full.status === 'error';
  const shaderFailed = panoramaEffect() === null;

  const yaw = useSharedValue(initialYaw);
  const pitch = useSharedValue(0);
  const fov = useSharedValue(PANO_FOV.initial);
  const startFov = useSharedValue(PANO_FOV.initial);
  const interacted = useSharedValue(0);
  const progress = useSharedValue(0);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    progress.set(withTiming(1, { duration: reduceMotion ? 0 : OPEN_MS, easing: Easing.out(Easing.cubic) }));
    return () => releasePanorama(url, 'full');
  }, [progress, reduceMotion, url]);

  const close = () => {
    progress.set(
      withTiming(0, { duration: reduceMotion ? 0 : 240, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(onClose);
      }),
    );
  };
  useOverlayChrome(close);

  // Auto-rotate until the first touch; never under reduced motion.
  const spin = useFrameCallback((info) => {
    'worklet';
    if (interacted.get() || progress.get() < 1) return;
    yaw.set(yaw.get() + (info.timeSincePreviousFrame ?? 16) * AUTO_SPEED);
  }, false);
  useEffect(() => {
    spin.setActive(!reduceMotion && !touched);
  }, [spin, reduceMotion, touched]);

  const markTouched = () => setTouched(true);
  const touch = () => {
    'worklet';
    cancelAnimation(yaw);
    cancelAnimation(pitch);
    cancelAnimation(fov);
    yaw.set(wrapAngle(yaw.get()));
    if (!interacted.get()) {
      interacted.set(1);
      scheduleOnRN(markTouched);
    }
  };

  // Radians per point at the centre of view, so the scene stays under the finger.
  const shortSide = Math.min(width, height);

  const pan = usePanGesture({
    maxPointers: 1,
    onBegin: () => {
      'worklet';
      touch();
    },
    onUpdate: (e) => {
      'worklet';
      const k = fov.get() / shortSide;
      yaw.set(yaw.get() - e.changeX * k);
      pitch.set(clampPitch(pitch.get() + e.changeY * k));
    },
    onDeactivate: (e) => {
      'worklet';
      const k = fov.get() / shortSide;
      yaw.set(withDecay({ velocity: -e.velocityX * k, deceleration: 0.996 }));
      pitch.set(withDecay({ velocity: e.velocityY * k, deceleration: 0.994, clamp: [-PANO_MAX_PITCH, PANO_MAX_PITCH] }));
    },
  });

  const pinch = usePinchGesture({
    onBegin: () => {
      'worklet';
      touch();
      startFov.set(fov.get());
    },
    onUpdate: (e) => {
      'worklet';
      fov.set(clampFov(startFov.get() / Math.max(0.01, e.scale)));
    },
  });

  const resetView = () => {
    'worklet';
    touch();
    const ease = { duration: RESET_MS, easing: Easing.inOut(Easing.cubic) };
    yaw.set(withTiming(0, ease));
    pitch.set(withTiming(0, ease));
    fov.set(withTiming(PANO_FOV.initial, ease));
  };

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      'worklet';
      resetView();
    },
  });

  // Drag and double-tap race (first to activate wins); pinch runs alongside either.
  const look = useCompetingGestures(pan, doubleTap);
  const gesture = useSimultaneousGestures(look, pinch);

  const rootStyle = useAnimatedStyle(() => {
    const p = progress.get();
    if (!origin) return { opacity: p, transform: [{ scale: interpolate(p, [0, 1], [0.96, 1]) }] };
    const s = interpolate(p, [0, 1], [Math.max(origin.width / width, origin.height / height), 1]);
    const dx = origin.x + origin.width / 2 - width / 2;
    const dy = origin.y + origin.height / 2 - height / 2;
    return {
      opacity: interpolate(p, [0, 0.35, 1], [0, 1, 1]),
      transform: [{ translateX: dx * (1 - p) }, { translateY: dy * (1 - p) }, { scale: s }],
    };
  });
  const chromeStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.get(), [0.5, 1], [0, 1], 'clamp') }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: withTiming(interacted.get() ? 0 : 1, { duration: 420 }),
    transform: [{ translateY: withTiming(interacted.get() ? space[2] : 0, { duration: 420 }) }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, rootStyle]}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} accessibilityLabel="360 degree site view. Drag to look around." accessible>
          {shaderFailed ? null : (
            <PanoramaCanvas image={image} yaw={yaw} pitch={pitch} fov={fov} width={width} height={height} />
          )}
        </View>
      </GestureDetector>

      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, chromeStyle]}>
        <View style={[styles.top, { paddingTop: insets.top + space[2] }]} pointerEvents="box-none">
          <IconButton label="Close 360 view" variant="glass" onPress={close}>
            <X size={20} color={colors.inkOnDark} strokeWidth={2.2} />
          </IconButton>
          <View style={styles.titleBlock} pointerEvents="none">
            <Text variant="bodyStrong" tone="onDark" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" tone="onDarkSecondary" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          {touched ? (
            <IconButton label="Reset view" variant="glass" onPress={() => resetView()}>
              <RotateCcw size={18} color={colors.inkOnDark} strokeWidth={2.2} />
            </IconButton>
          ) : (
            <View style={styles.side} />
          )}
        </View>

        {failed || shaderFailed ? (
          <View style={styles.center} pointerEvents="box-none">
            <View style={styles.errorCard}>
              <View style={styles.errorIcon}>
                <CloudOff size={22} color={colors.highlight} strokeWidth={2.1} />
              </View>
              <Text variant="heading" tone="onDark" center>
                {shaderFailed ? 'This phone cannot draw the 360° view' : 'The 360° view could not load'}
              </Text>
              <Text variant="body" tone="onDarkSecondary" center>
                {shaderFailed
                  ? 'The photos and map on the listing still show the site.'
                  : 'Check your connection and try again. The listing photos are unaffected.'}
              </Text>
              {shaderFailed ? null : <Button label="Try again" variant="soft" size="md" block={false} onPress={full.retry} />}
            </View>
          </View>
        ) : null}

        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space[4]) + space[2] }]} pointerEvents="box-none">
          <HeadingDial yaw={yaw} fov={fov} />
          <View style={styles.bottomCenter} pointerEvents="box-none">
            {!image && !failed ? (
              <View style={styles.pill}>
                <Label tone="onDark">Loading 360° photo</Label>
              </View>
            ) : sharpening ? (
              <View style={styles.pill}>
                <Label tone="onDarkSecondary">Sharpening to full resolution</Label>
              </View>
            ) : full.status === 'error' && image ? (
              <PressableScale onPress={full.retry} style={styles.pill} accessibilityLabel="Retry full resolution">
                <Label tone="onDarkSecondary">Lighter version · tap to retry</Label>
              </PressableScale>
            ) : (
              <Animated.View style={[styles.pill, hintStyle]} pointerEvents="none">
                <Move size={14} color={colors.inkOnDark} strokeWidth={2.1} />
                <Label tone="onDark">Drag to look · pinch to zoom</Label>
              </Animated.View>
            )}
          </View>
          <View style={styles.side} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.night, overflow: 'hidden' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  titleBlock: { flex: 1, alignItems: 'center' },
  side: { width: 44, height: 44 },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[8],
  },
  errorCard: {
    alignItems: 'center',
    gap: space[3],
    padding: space[6],
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.nightRaised,
  },
  errorIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.highlight, 0.14),
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  bottomCenter: { flex: 1, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 32,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.night, 0.56),
  },
});

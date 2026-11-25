import { ImageOff, Rotate3d, Share2, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, gutter, radius, space, spring } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import { withAlpha } from '../meta';
import { useOverlayChrome, type OriginRect } from './overlay';
import { photoUrl } from './image-variants';
import { Photo } from './photo';
import { aspectOf, learnPlaceholder, prefetchAround, prefetchLater } from './photo-cache';

const THUMB = 52;
const THUMB_GAP = space[2];
const THUMB_RADIUS = radius.sm;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 110;
const OPEN_MS = 300;
const CLOSE_MS = 260;

const MODE_NONE = 0;
const MODE_PAGE = 1;
const MODE_MOVE = 2;
const MODE_DISMISS = 3;
/** Activated, but the drag has not shown its direction yet. */
const MODE_UNDECIDED = 4;
/** Travel after activation that decides between paging and dismissing. */
const DECIDE_DISTANCE = 4;

export type ViewerOrigin = {
  /** Where the photo is drawn (cover-fit) on the screen underneath. */
  image: OriginRect;
  /** The part of that rect actually visible (the hero is overlapped by the sheet). */
  clip: OriginRect;
};

export type PhotoViewerProps = {
  images: string[];
  startIndex: number;
  title: string;
  origin: ViewerOrigin | null;
  /** Adds a 360° tile as the last filmstrip item. */
  hasPanorama: boolean;
  onIndexChange: (index: number) => void;
  onOpenPanorama: () => void;
  onClose: () => void;
};

type Shared = {
  progress: SharedValue<number>;
  curIndex: SharedValue<number>;
  zoomOwner: SharedValue<number>;
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
};

function containSize(aspect: number, w: number, h: number) {
  'worklet';
  return w / h > aspect ? { dw: h * aspect, dh: h } : { dw: w, dh: w / aspect };
}

const lerp = (a: number, b: number, t: number) => {
  'worklet';
  return a + (b - a) * t;
};

function ViewerPage({
  uri,
  index,
  aspect,
  width,
  height,
  origin,
  shared,
  onAspect,
}: {
  uri: string;
  index: number;
  aspect: number;
  width: number;
  height: number;
  origin: ViewerOrigin | null;
  shared: Shared;
  onAspect: (uri: string, aspect: number) => void;
}) {
  const [state, setState] = useState<'ready' | 'loading' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const { dw, dh } = containSize(aspect, width, height);
  const { progress, curIndex, zoomOwner, scale, tx, ty, dragX, dragY } = shared;

  // Pinch / pan / dismiss drag — blended by `progress` so a close always lands on the origin.
  const zoomStyle = useAnimatedStyle(() => {
    const p = curIndex.get() === index ? progress.get() : 1;
    const own = zoomOwner.get() === index;
    const s = own ? scale.get() : 1;
    const dragging = curIndex.get() === index;
    const dx = dragging ? dragX.get() : 0;
    const dy = dragging ? dragY.get() : 0;
    const shrink = 1 - Math.min(1, Math.abs(dy) / height) * 0.3;
    return {
      transform: [
        { translateX: ((own ? tx.get() : 0) + dx) * p },
        { translateY: ((own ? ty.get() : 0) + dy) * p },
        { scale: 1 + (s * shrink - 1) * p },
      ],
    };
  });

  // Shared-element-like morph: the clip and the cover-fit image grow independently from the
  // hero's rectangles to the contain-fit frame, using transforms only.
  const clipStyle = useAnimatedStyle(() => {
    const p = curIndex.get() === index && origin ? progress.get() : 1;
    const c0 = origin ? origin.clip : { x: (width - dw) / 2, y: (height - dh) / 2, width: dw, height: dh };
    const cw = lerp(c0.width, dw, p);
    const ch = lerp(c0.height, dh, p);
    const ccx = lerp(c0.x + c0.width / 2, width / 2, p);
    const ccy = lerp(c0.y + c0.height / 2, height / 2, p);
    return {
      transform: [
        { translateX: ccx - width / 2 },
        { translateY: ccy - height / 2 },
        { scaleX: cw / dw },
        { scaleY: ch / dh },
      ],
    };
  });

  const imageStyle = useAnimatedStyle(() => {
    const p = curIndex.get() === index && origin ? progress.get() : 1;
    const o = origin ? origin.image : { x: (width - dw) / 2, y: (height - dh) / 2, width: dw, height: dh };
    const c0 = origin ? origin.clip : o;
    const cw = lerp(c0.width, dw, p);
    const ch = lerp(c0.height, dh, p);
    const ccx = lerp(c0.x + c0.width / 2, width / 2, p);
    const ccy = lerp(c0.y + c0.height / 2, height / 2, p);
    const icx = lerp(o.x + o.width / 2, width / 2, p);
    const icy = lerp(o.y + o.height / 2, height / 2, p);
    const cover = lerp(Math.max(o.width / dw, o.height / dh), 1, p);
    const sx = cw / dw;
    const sy = ch / dh;
    return {
      transform: [
        { translateX: (icx - ccx) / sx },
        { translateY: (icy - ccy) / sy },
        { scaleX: cover / sx },
        { scaleY: cover / sy },
      ],
    };
  });

  return (
    <Animated.View style={[styles.page, { left: index * width, width, height }, zoomStyle]} pointerEvents="box-none">
      <Animated.View
        pointerEvents="none"
        style={[styles.frame, { left: (width - dw) / 2, top: (height - dh) / 2, width: dw, height: dh }, clipStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, imageStyle]}>
          <Photo
            key={attempt}
            uri={uri}
            size="full"
            tint={colors.nightRaised}
            shimmer="dark"
            // Keep full resolution so a 4× zoom stays sharp.
            allowDownscaling={false}
            priority="high"
            onLoad={(e) => {
              const { width: w, height: h } = e.source;
              if (w > 0 && h > 0) onAspect(uri, w / h);
              if (photoUrl(uri, 'card') === uri) learnPlaceholder(uri);
              setState('ready');
            }}
            onError={() => setState('error')}
          />
        </Animated.View>
      </Animated.View>
      {state === 'error' ? (
        <View style={styles.pageError} pointerEvents="box-none">
          <ImageOff size={24} color={colors.inkOnDarkSecondary} strokeWidth={2} />
          <Text variant="body" tone="onDarkSecondary" center>
            This photo could not load.
          </Text>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            block={false}
            onPress={() => {
              setState('loading');
              setAttempt((a) => a + 1);
            }}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

function Thumb({
  uri,
  index,
  page,
  width,
  onPress,
}: {
  uri: string;
  index: number;
  page: SharedValue<number>;
  width: number;
  onPress: () => void;
}) {
  const style = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(page.get() / width - index));
    return { opacity: 1 - d * 0.5, transform: [{ scale: 1 - d * 0.12 }] };
  });
  const ring = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.abs(page.get() / width - index) * 2) }));
  return (
    <PressableScale onPress={onPress} haptic="selection" accessibilityLabel={`Photo ${index + 1}`}>
      <Animated.View style={[styles.thumb, style]}>
        <Photo uri={uri} size="thumb" tint={colors.nightRaised} shimmer={false} transition={160} />
        <Animated.View style={[styles.thumbRing, ring]} />
      </Animated.View>
    </PressableScale>
  );
}

/**
 * Fullscreen photo viewer rendered as an overlay of the listing screen: custom pager with
 * pinch / double-tap zoom, pan-to-edge hand-off to the next photo, swipe down to dismiss, a
 * filmstrip that tracks the pager on the UI thread, and a grow-from-hero open/close transition.
 */
export function PhotoViewer({
  images,
  startIndex,
  title,
  origin,
  hasPanorama,
  onIndexChange,
  onOpenPanorama,
  onClose,
}: PhotoViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const count = images.length;

  const [index, setIndex] = useState(startIndex);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const aspectFor = (uri: string) => aspects[uri] ?? aspectOf(uri);

  const progress = useSharedValue(0);
  const pageX = useSharedValue(startIndex * width);
  const curIndex = useSharedValue(startIndex);
  const zoomOwner = useSharedValue(startIndex);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const mode = useSharedValue(MODE_NONE);
  // Translation at activation. Android's pan resets its translation to zero when it activates
  // (iOS does not), so every drag is measured from here and the direction is read from the
  // first few points of travel rather than from the activation event, which reads 0/0 on Android.
  const fromX = useSharedValue(0);
  const fromY = useSharedValue(0);
  const chrome = useSharedValue(1);
  const aspect = useSharedValue(aspectFor(images[startIndex] ?? ''));
  const shared: Shared = { progress, curIndex, zoomOwner, scale, tx, ty, dragX, dragY };

  const currentUri = images[index] ?? '';
  const currentAspect = aspectFor(currentUri);
  useEffect(() => {
    aspect.set(currentAspect);
  }, [aspect, currentAspect]);

  useEffect(() => {
    progress.set(withTiming(1, { duration: reduceMotion ? 0 : OPEN_MS, easing: Easing.out(Easing.cubic) }));
  }, [progress, reduceMotion]);

  useEffect(() => {
    prefetchAround(images, index, 1);
    onIndexChange(index);
  }, [images, index, onIndexChange]);

  useEffect(() => {
    prefetchLater(images.map((u) => photoUrl(u, 'thumb')), true);
  }, [images]);

  const finishClose = () => onClose();
  const close = () => {
    'worklet';
    progress.set(
      withTiming(0, { duration: reduceMotion ? 0 : CLOSE_MS, easing: Easing.inOut(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(finishClose);
      }),
    );
  };
  useOverlayChrome(() => close());

  const onAspect = (uri: string, a: number) => setAspects((prev) => (prev[uri] === a ? prev : { ...prev, [uri]: a }));

  // ── worklet helpers

  const limits = (s: number) => {
    'worklet';
    const { dw, dh } = containSize(aspect.get(), width, height);
    return { x: Math.max(0, (dw * s - width) / 2), y: Math.max(0, (dh * s - height) / 2) };
  };

  const resetZoom = (animated: boolean) => {
    'worklet';
    if (animated) {
      scale.set(withSpring(1, spring.snappy));
      tx.set(withSpring(0, spring.snappy));
      ty.set(withSpring(0, spring.snappy));
    } else {
      scale.set(1);
      tx.set(0);
      ty.set(0);
    }
  };

  const goTo = (target: number, velocity: number) => {
    'worklet';
    const next = Math.max(0, Math.min(count - 1, target));
    pageX.set(withSpring(next * width, { ...spring.snappy, velocity }));
    if (next !== curIndex.get()) {
      curIndex.set(next);
      // Let the outgoing photo un-zoom as it slides away, then hand the zoom to the new one.
      scale.set(
        withTiming(1, { duration: 200 }, () => {
          zoomOwner.set(next);
        }),
      );
      tx.set(withTiming(0, { duration: 200 }));
      ty.set(withTiming(0, { duration: 200 }));
      scheduleOnRN(setIndex, next);
    }
  };

  const settlePage = (vx: number) => {
    'worklet';
    const rest = curIndex.get() * width;
    const off = pageX.get() - rest;
    let target = curIndex.get();
    if (off > width * 0.22 || vx < -600) target += 1;
    else if (off < -width * 0.22 || vx > 600) target -= 1;
    goTo(target, -vx);
  };

  const pagerResist = (next: number) => {
    'worklet';
    // `next` is the pager offset from rest; resist past the first and last photo.
    const atStart = curIndex.get() === 0 && next < 0;
    const atEnd = curIndex.get() === count - 1 && next > 0;
    return atStart || atEnd ? next * 0.3 : next;
  };

  // ── gestures

  const pan = usePanGesture({
    onActivate: (e) => {
      'worklet';
      cancelAnimation(pageX);
      fromX.set(e.translationX);
      fromY.set(e.translationY);
      if (scale.get() > 1.01 || e.numberOfPointers > 1) {
        mode.set(MODE_MOVE);
        cancelAnimation(tx);
        cancelAnimation(ty);
        zoomOwner.set(curIndex.get());
      } else {
        mode.set(MODE_UNDECIDED);
      }
    },
    onUpdate: (e) => {
      'worklet';
      const dx = e.translationX - fromX.get();
      const dy = e.translationY - fromY.get();
      if (mode.get() === MODE_UNDECIDED) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_DISTANCE) return;
        if (e.numberOfPointers > 1 || scale.get() > 1.01) mode.set(MODE_MOVE);
        else if (count > 1 && Math.abs(dx) > Math.abs(dy)) mode.set(MODE_PAGE);
        else mode.set(MODE_DISMISS);
      }
      const m = mode.get();
      const rest = curIndex.get() * width;
      if (m === MODE_PAGE) {
        pageX.set(rest + pagerResist(-dx));
      } else if (m === MODE_DISMISS) {
        dragX.set(dx * 0.6);
        dragY.set(dy > 0 ? dy : dy * 0.3);
      } else if (m === MODE_MOVE) {
        const lim = limits(scale.get());
        const off = pageX.get() - rest;
        const cx = e.changeX;
        const pushingRight = cx < 0 && tx.get() <= -lim.x + 0.5;
        const pushingLeft = cx > 0 && tx.get() >= lim.x - 0.5;
        if (count > 1 && e.numberOfPointers === 1 && (off !== 0 || pushingRight || pushingLeft)) {
          // At the photo's edge, the drag hands over to the pager.
          let next = off - cx;
          if ((off > 0 && next < 0) || (off < 0 && next > 0)) next = 0;
          pageX.set(rest + pagerResist(next));
        } else {
          const nx = tx.get() + cx;
          tx.set(Math.abs(nx) > lim.x ? tx.get() + cx * 0.35 : nx);
        }
        const ny = ty.get() + e.changeY;
        ty.set(Math.abs(ny) > lim.y ? ty.get() + e.changeY * 0.35 : ny);
      }
    },
    onDeactivate: (e) => {
      'worklet';
      const m = mode.get();
      if (m === MODE_PAGE) {
        settlePage(e.velocityX);
      } else if (m === MODE_DISMISS) {
        if (e.translationY - fromY.get() > DISMISS_DISTANCE || e.velocityY > 900) {
          close();
        } else {
          dragX.set(withSpring(0, spring.snappy));
          dragY.set(withSpring(0, spring.snappy));
        }
      } else if (m === MODE_MOVE) {
        const off = pageX.get() - curIndex.get() * width;
        if (off !== 0) {
          settlePage(e.velocityX);
          return;
        }
        const lim = limits(scale.get());
        tx.set(withDecay({ velocity: e.velocityX, clamp: [-lim.x, lim.x], rubberBandEffect: true }));
        ty.set(withDecay({ velocity: e.velocityY, clamp: [-lim.y, lim.y], rubberBandEffect: true }));
      }
    },
    onFinalize: () => {
      'worklet';
      mode.set(MODE_NONE);
    },
  });

  const pinch = usePinchGesture({
    onBegin: () => {
      'worklet';
      cancelAnimation(scale);
      cancelAnimation(tx);
      cancelAnimation(ty);
      zoomOwner.set(curIndex.get());
    },
    onUpdate: (e) => {
      'worklet';
      const m = mode.get();
      if (m === MODE_DISMISS || m === MODE_PAGE) return;
      const prev = scale.get();
      const next = Math.min(MAX_SCALE * 1.5, Math.max(0.6, prev * e.scaleChange));
      const f = next / prev;
      // Keep the point under the fingers fixed: t' = F − (F − t)·f.
      const fx = e.focalX - width / 2;
      const fy = e.focalY - height / 2;
      tx.set(fx - (fx - tx.get()) * f);
      ty.set(fy - (fy - ty.get()) * f);
      scale.set(next);
    },
    onDeactivate: () => {
      'worklet';
      const s = scale.get();
      if (s <= 1) {
        resetZoom(true);
        return;
      }
      const target = Math.min(MAX_SCALE, s);
      const lim = limits(target);
      const k = target / s;
      scale.set(withSpring(target, spring.snappy));
      tx.set(withSpring(Math.max(-lim.x, Math.min(lim.x, tx.get() * k)), spring.snappy));
      ty.set(withSpring(Math.max(-lim.y, Math.min(lim.y, ty.get() * k)), spring.snappy));
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      zoomOwner.set(curIndex.get());
      if (scale.get() > 1.01) {
        resetZoom(true);
        return;
      }
      const s = DOUBLE_TAP_SCALE;
      const lim = limits(s);
      const fx = e.x - width / 2;
      const fy = e.y - height / 2;
      scale.set(withSpring(s, spring.snappy));
      tx.set(withSpring(Math.max(-lim.x, Math.min(lim.x, -fx * (s - 1))), spring.snappy));
      ty.set(withSpring(Math.max(-lim.y, Math.min(lim.y, -fy * (s - 1))), spring.snappy));
    },
  });

  const singleTap = useTapGesture({
    onActivate: () => {
      'worklet';
      chrome.set(withTiming(chrome.get() > 0.5 ? 0 : 1, { duration: 200 }));
    },
  });

  const taps = useExclusiveGestures(doubleTap, singleTap);
  const gesture = useSimultaneousGestures(pan, pinch, taps);

  // ── filmstrip follows the pager on the UI thread

  const stripRef = useAnimatedRef<Animated.ScrollView>();
  const showStrip = count > 1 || hasPanorama;
  useAnimatedReaction(
    () => pageX.get() / width,
    (p) => {
      if (showStrip) scrollTo(stripRef, p * (THUMB + THUMB_GAP), 0, false);
    },
  );

  const jumpTo = (i: number) => {
    if (i === index) return;
    pageX.set(withTiming(i * width, { duration: reduceMotion ? 0 : 280, easing: Easing.out(Easing.cubic) }));
    curIndex.set(i);
    zoomOwner.set(i);
    scale.set(1);
    tx.set(0);
    ty.set(0);
    setIndex(i);
  };

  const share = () => {
    if (!currentUri) return;
    Share.share({ message: `${title} — photo ${index + 1} of ${count} on LandConnect\n${currentUri}`, url: currentUri });
  };

  // ── styles

  const backdrop = useAnimatedStyle(() => {
    const fade = 1 - Math.min(1, Math.abs(dragY.get()) / (height * 0.45)) * 0.85;
    return { opacity: progress.get() * fade };
  });
  const track = useAnimatedStyle(() => ({ transform: [{ translateX: -pageX.get() }] }));
  const chromeStyle = useAnimatedStyle(() => {
    const drag = 1 - Math.min(1, Math.abs(dragY.get()) / 80);
    return { opacity: interpolate(progress.get(), [0.6, 1], [0, 1], 'clamp') * chrome.get() * drag };
  });

  const pages: number[] = [];
  for (let i = Math.max(0, index - 1); i <= Math.min(count - 1, index + 1); i++) pages.push(i);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]} pointerEvents="none" />
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} accessible accessibilityLabel={`Photo ${index + 1} of ${count}`}>
          <Animated.View style={[StyleSheet.absoluteFill, track]}>
            {pages.map((i) => (
              <ViewerPage
                key={`${i}:${images[i]}`}
                uri={images[i]}
                index={i}
                aspect={aspectFor(images[i])}
                width={width}
                height={height}
                origin={origin}
                shared={shared}
                onAspect={onAspect}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>

      <Animated.View style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents="box-none">
        <View style={[styles.top, { paddingTop: insets.top + space[2] }]} pointerEvents="box-none">
          <IconButton label="Close photos" variant="glass" onPress={() => close()}>
            <X size={20} color={colors.inkOnDark} strokeWidth={2.2} />
          </IconButton>
          <View style={styles.topCenter} pointerEvents="none">
            {count > 1 ? <Label tone="onDark" style={styles.tabular}>{`${index + 1} / ${count}`}</Label> : null}
            <Text variant="caption" tone="onDarkSecondary" numberOfLines={1}>
              {title}
            </Text>
          </View>
          <IconButton label="Share photo" variant="glass" onPress={share}>
            <Share2 size={18} color={colors.inkOnDark} strokeWidth={2.1} />
          </IconButton>
        </View>

        {showStrip ? (
          <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space[3]) + space[2] }]}>
            <Animated.ScrollView
              ref={stripRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.strip, { paddingHorizontal: width / 2 - THUMB / 2 }]}>
              {images.map((uri, i) => (
                <Thumb key={`${i}:${uri}`} uri={uri} index={i} page={pageX} width={width} onPress={() => jumpTo(i)} />
              ))}
              {hasPanorama ? (
                <PressableScale onPress={onOpenPanorama} accessibilityLabel="Open the 360 degree site view">
                  <View style={[styles.thumb, styles.panoThumb]}>
                    <Rotate3d size={18} color={colors.accentBright} strokeWidth={2.1} />
                    <Label tone="onDark">360°</Label>
                  </View>
                </PressableScale>
              ) : null}
            </Animated.ScrollView>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: colors.night },
  page: { position: 'absolute', top: 0 },
  frame: { position: 'absolute', overflow: 'hidden', backgroundColor: colors.nightRaised },
  pageError: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[8],
  },
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
  topCenter: { flex: 1, alignItems: 'center', gap: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space[3] },
  strip: { gap: THUMB_GAP, alignItems: 'center' },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.nightRaised,
  },
  thumbRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: THUMB_RADIUS,
    borderCurve: 'continuous',
    borderWidth: 2,
    borderColor: colors.inkOnDark,
  },
  panoThumb: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: withAlpha(colors.accent, 0.32),
  },
});

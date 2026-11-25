import { router } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, gutter, space, spring, type } from '@/theme/tokens';
import { Button } from '@/ui/button';
import { Enter } from '@/ui/enter';
import { useScreenInsets } from '@/ui/screen';
import { Text } from '@/ui/text';

import { LogoMark, Wordmark } from './logo-mark';
import { StoryCanvas } from './story-canvas';
import { StoryProgress } from './story-progress';
import { GLIDE, GLIDE_MS, useStoryTimeline } from './timeline';

/** One story, three steps, matching the name: find land, connect with its owner, buy it. */
const PANELS = [
  {
    title: 'Find land',
    body: 'Verified parcels on a real map of Bengaluru and Karnataka.',
  },
  {
    title: 'Connect privately',
    body: 'Call the owner in-app as anonymous IDs. Real names come at the end.',
  },
  {
    title: 'Buy with certainty',
    body: 'Every edge measured, every acre verified. Then close the deal.',
  },
] as const;

const LAST = PANELS.length - 1;
/** The same glide the camera and auto-advance use, so copy and land move as one. */
const advanceEasing = GLIDE;

/** How far the copy rises into the hero's fade, so the two read as one surface. */
const OVERLAP = space[16];
/**
 * Room for two title lines and two body lines, whatever the step: the copy never reflows the
 * footer, so the buttons never jump between steps.
 */
const COPY_HEIGHT = type.display.lineHeight * 2 + space[3] + type.body.lineHeight * 2;

const BRAND_ROW = 44;
/** The segment row is a full 44pt touch target; its 4pt track sits in the middle. */
const SEGMENT_ROW = 44;
/** A press that moves less than this, this quickly, is a tap on the hero rather than a swipe. */
const TAP_SLOP = 10;
const TAP_MS = 280;
/** A flick faster than this (panels per second) always turns the page, even over a short distance. */
const FLICK = 0.35;

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

/**
 * The welcome story: three panels over one continuous aerial scene. A horizontal pan drives a single
 * `progress` shared value; the camera and copy cross-fade read from it, and each panel's own clock
 * (started when the pager lands there) drives its beats and its segment's fill.
 * Auto-advance waits for each panel's sequence to finish; a touch pauses it, and it resumes on release.
 */
export function WelcomeStory() {
  const { width } = useWindowDimensions();
  const insets = useScreenInsets();
  const reduced = useReducedMotion();

  const [hero, setHero] = useState<{ w: number; h: number } | null>(null);
  const [active, setActive] = useState(0);

  const progress = useSharedValue(0);
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const touchAt = useSharedValue(0);
  /** Bottom of the area where a tap turns the page: the hero, above where the copy overlaps it. */
  const tapBottom = useSharedValue(0);
  const footerIn = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) footerIn.set(withDelay(320, withTiming(1, { duration: 320 })));
  }, [reduced, footerIn]);
  const footerStyle = useAnimatedStyle(() => ({ opacity: footerIn.get() }));
  const timeline = useStoryTimeline({ progress, reduced, ready: hero !== null });
  const { hold, release } = timeline;

  const goTo = (index: number) => {
    progress.set(withTiming(index, { duration: reduced ? 0 : GLIDE_MS, easing: advanceEasing }));
  };

  const go = (href: '/sign-up' | '/sign-in') => {
    router.push(href);
  };

  useAnimatedReaction(
    () => Math.min(LAST, Math.max(0, Math.round(progress.get()))),
    (current, previous) => {
      if (current !== previous) scheduleOnRN(setActive, current);
    },
  );

  const pan = usePanGesture({
    activeOffsetX: [-8, 8],
    failOffsetY: [-12, 12],
    onBegin: (e) => {
      'worklet';
      // Any touch pauses the story where it is; the finger takes over from the exact frame.
      cancelAnimation(progress);
      start.set(progress.get());
      hold();
      touchX.set(e.x);
      touchY.set(e.y);
      touchAt.set(Date.now());
    },
    onActivate: () => {
      'worklet';
      dragging.set(true);
    },
    onUpdate: (e) => {
      'worklet';
      let next = start.get() - e.translationX / width;
      // Rubber-band past either end instead of a hard stop.
      if (next < 0) next *= 0.28;
      if (next > LAST) next = LAST + (next - LAST) * 0.28;
      progress.set(next);
    },
    onDeactivate: (e) => {
      'worklet';
      const velocity = -e.velocityX / width;
      const base = Math.round(start.get());
      const p = progress.get();
      // A flick turns the page in its direction; a slow drag settles on whichever page is nearer.
      const wanted = Math.abs(velocity) > FLICK ? base + Math.sign(velocity) : Math.round(p);
      // Never more than one page per gesture, never past either end.
      const target = Math.min(LAST, Math.max(0, Math.min(base + 1, Math.max(base - 1, wanted))));
      progress.set(withSpring(target, { ...spring.gentle, velocity }));
    },
    onFinalize: (e) => {
      'worklet';
      const p = progress.get();
      if (!dragging.get()) {
        const still = Math.abs(e.x - touchX.get()) < TAP_SLOP && Math.abs(e.y - touchY.get()) < TAP_SLOP;
        const quick = Date.now() - touchAt.get() < TAP_MS;
        const here = Math.round(clamp01(p / LAST) * LAST);
        if (still && quick && touchY.get() < tapBottom.get()) {
          // Stories pattern on the hero only: left third goes back, right third goes forward.
          const third = touchX.get() / width;
          const next = third < 1 / 3 ? here - 1 : third > 2 / 3 ? here + 1 : here;
          progress.set(withTiming(Math.min(LAST, Math.max(0, next)), { duration: GLIDE_MS, easing: advanceEasing }));
        } else if (Math.abs(p - here) > 0.001) {
          // A touch that interrupted an advance: settle where it left us.
          progress.set(withSpring(here, spring.gentle));
        }
      }
      dragging.set(false);
      // Autoplay picks up again from wherever the reader left it.
      release();
    },
  });

  const onHeroLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    // The detector's coordinates start at the stage top, which is the hero top.
    tapBottom.set(h - OVERLAP - SEGMENT_ROW / 2);
    if (!hero || hero.h !== h || hero.w !== width) setHero({ w: width, h });
  };

  const current = PANELS[active];

  return (
    <View style={styles.screen}>
      <GestureDetector gesture={pan}>
        <View style={styles.stage} collapsable={false}>
          <View style={styles.hero} onLayout={onHeroLayout}>
            {/* Drawn the frame the hero is measured, with no fade from nothing: the land is the first thing you see. */}
            {hero ? (
              <StoryCanvas
                width={hero.w}
                height={hero.h}
                progress={progress}
                timeline={timeline}
                reduced={reduced}
                top={insets.top + BRAND_ROW + space[2]}
                bottom={hero.h - OVERLAP - (SEGMENT_ROW - space[1]) / 2}
              />
            ) : null}
          </View>

          <View style={[styles.copyWrap, { marginTop: -OVERLAP - (SEGMENT_ROW - space[1]) / 2 }]}>
            <Enter index={0} delay={220}>
              <StoryProgress total={PANELS.length} value={timeline.fill} onSelect={goTo} label={(i) => `Step ${i + 1}: ${PANELS[i].title}`} />
            </Enter>
            <Enter index={1} delay={220}>
              <View
                style={styles.copy}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={`Step ${active + 1} of ${PANELS.length}. ${current.title}. ${current.body}`}
                accessibilityValue={{ text: `${active + 1} of ${PANELS.length}` }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'increment') goTo(Math.min(LAST, active + 1));
                  if (e.nativeEvent.actionName === 'decrement') goTo(Math.max(0, active - 1));
                }}>
                {PANELS.map((panel, i) => (
                  <PanelCopy key={panel.title} index={i} progress={progress} title={panel.title} body={panel.body} />
                ))}
              </View>
            </Enter>
          </View>
        </View>
      </GestureDetector>

      {/* Plain views with an opacity fade, not a layout animation: both actions must be hittable from the first frame. */}
      <Animated.View style={[styles.footer, { paddingBottom: insets.bottom }, footerStyle]}>
        <Button
          label="Get started"
          onPress={() => go('/sign-up')}
          trailing={<ArrowRight size={18} color={colors.inkOnDark} strokeWidth={2.2} />}
        />
        <Button label="I already have an account" variant="ghost" size="md" onPress={() => go('/sign-in')} />
      </Animated.View>

      <View style={[styles.brand, { top: insets.top }]} pointerEvents="none">
        <View style={styles.brandMark}>
          <LogoMark size={32} animate delay={120} />
          <Wordmark size={18} />
        </View>
      </View>
    </View>
  );
}

function PanelCopy({
  index,
  progress,
  title,
  body,
}: {
  index: number;
  progress: SharedValue<number>;
  title: string;
  body: string;
}) {
  // Headline travels further than the body: a little depth, and the eye lands on the title first.
  const titleStyle = useAnimatedStyle(() => {
    const d = progress.get() - index;
    return { opacity: clamp01(1 - Math.abs(d) * 1.8), transform: [{ translateX: -d * 32 }] };
  });
  const bodyStyle = useAnimatedStyle(() => {
    const d = progress.get() - index;
    return { opacity: clamp01(1 - Math.abs(d) * 2.1), transform: [{ translateX: -d * 18 }] };
  });

  return (
    <View style={styles.panel} pointerEvents="none">
      <Animated.View style={titleStyle}>
        <Text variant="display" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}>
          {title}
        </Text>
      </Animated.View>
      <Animated.View style={bodyStyle}>
        <Text variant="body" tone="secondary" numberOfLines={2}>
          {body}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  stage: { flex: 1 },
  hero: { flex: 1, overflow: 'hidden' },
  // The segment row's own padding (half of SEGMENT_ROW) supplies the gap above the copy.
  copyWrap: { paddingHorizontal: gutter },
  copy: { height: COPY_HEIGHT },
  panel: { ...StyleSheet.absoluteFill, gap: space[3] },
  footer: { paddingHorizontal: gutter, paddingTop: space[4], gap: space[1] },
  brand: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: BRAND_ROW,
  },
  brandMark: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});

import { LinearGradient } from 'expo-linear-gradient';
import { ImageOff, Images, Rotate3d } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { Listing } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Label } from '@/ui/text';

import { ContourArt } from '../graphics/contour-art';
import { LAND_TINT, withAlpha } from '../meta';
import { photoUrl } from './image-variants';
import { Photo } from './photo';
import { learnPlaceholder, prefetchAround } from './photo-cache';

/** Inner photo drifts at 70% of the swipe, so pages slide over each other with depth. */
const PARALLAX = 0.3;

export type HeroGalleryProps = {
  /** False during the open transition: only the first photo decodes until the push lands. */
  settled?: boolean;
  listing: Pick<Listing, 'id' | 'images' | 'land_type' | 'panorama_url'>;
  width: number;
  height: number;
  /** Height of the sheet that overlaps the bottom edge; chrome sits above it. */
  overlap: number;
  /** Scroll the pager here without animation (after the fullscreen viewer moved on). */
  syncIndex: number;
  onOpenPhoto: (index: number) => void;
  onOpenPanorama: () => void;
};

function Segment({ index, page }: { index: number; page: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const d = Math.min(1, Math.abs(page.get() - index));
    return { opacity: 1 - d * 0.55, transform: [{ scaleX: 1 - d * 0.45 }] };
  });
  return <Animated.View style={[styles.segment, style]} />;
}

function HeroPage({
  uri,
  index,
  page,
  width,
  height,
  mounted,
  tint,
  onPress,
}: {
  uri: string;
  index: number;
  page: SharedValue<number>;
  width: number;
  height: number;
  mounted: boolean;
  tint: string;
  onPress: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const drift = useAnimatedStyle(() => ({ transform: [{ translateX: (page.get() - index) * width * PARALLAX }] }));

  return (
    <PressableScale to={1} haptic={false} onPress={onPress} accessibilityLabel={`Open photo ${index + 1}`}>
      <View style={[styles.page, { width, height, backgroundColor: tint }]}>
        {mounted ? (
          <Animated.View style={[StyleSheet.absoluteFill, drift]}>
            <Photo
              uri={uri}
              size="full"
              tint={tint}
              transition={260}
              // The detail opens on the first photo: decode it before anything else on the screen.
              priority={index === 0 ? 'high' : 'low'}
              recyclingKey={uri}
              onLoad={() => {
                // Uploaded photos have no smaller CDN variant to stand in; learn a thumbhash instead.
                if (photoUrl(uri, 'card') === uri) learnPlaceholder(uri);
              }}
              onError={() => setFailed(true)}
            />
          </Animated.View>
        ) : null}
        {failed ? (
          <View style={styles.pageError} pointerEvents="none">
            <ImageOff size={22} color={colors.inkTertiary} strokeWidth={2} />
            <Label tone="secondary">Photo unavailable</Label>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

/**
 * Full-bleed hero: swipeable photos with per-page parallax, segment indicator, live counter and
 * a 360° badge. Only the visible page and its neighbours mount an image; the next two are
 * prefetched. Listings without photos keep the generated contour survey preview.
 */
export function HeroGallery({ listing, width, height, overlap, syncIndex, onOpenPhoto, onOpenPanorama, settled = true }: HeroGalleryProps) {
  const reduceMotion = useReducedMotion();
  const images = listing.images;
  const count = images.length;
  const hasPanorama = !!listing.panorama_url;
  const tint = LAND_TINT[listing.land_type].wash;

  const page = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const pager = useAnimatedRef<Animated.ScrollView>();

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      page.set(e.contentOffset.x / width);
    },
  });
  useAnimatedReaction(
    () => Math.round(page.get()),
    (now, before) => {
      if (now !== before) scheduleOnRN(setIndex, Math.max(0, Math.min(count - 1, now)));
    },
  );

  useEffect(() => {
    if (count > 1 && settled) prefetchAround(images, index, 1);
  }, [images, index, count, settled]);

  useEffect(() => {
    if (syncIndex >= 0 && syncIndex < count) pager.current?.scrollTo({ x: syncIndex * width, animated: false });
  }, [syncIndex, count, width, pager]);

  const bottom = overlap + space[4];
  const panoBadge = hasPanorama ? (
    <PressableScale onPress={onOpenPanorama} style={styles.pill} accessibilityLabel="Open the 360 degree site view">
      <Rotate3d size={14} color={colors.accentBright} strokeWidth={2.2} />
      <Label tone="onDark">360°</Label>
    </PressableScale>
  ) : null;

  if (count === 0) {
    return (
      <View style={{ width, height }}>
        <ContourArt seed={listing.id} landType={listing.land_type} animated={!reduceMotion} style={{ width, height }} />
        <View style={[styles.chrome, { bottom }]} pointerEvents="box-none">
          <View style={styles.surveyPill}>
            <Label tone="secondary">Survey preview · no photos yet</Label>
          </View>
          {panoBadge}
        </View>
      </View>
    );
  }

  return (
    <View style={{ width, height }}>
      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={count > 1}
        showsHorizontalScrollIndicator={false}>
        {images.map((uri, i) => (
          <HeroPage
            key={`${i}:${uri}`}
            uri={uri}
            index={i}
            page={page}
            width={width}
            height={height}
            mounted={i === index || (settled && Math.abs(i - index) <= 1)}
            tint={tint}
            onPress={() => onOpenPhoto(i)}
          />
        ))}
      </Animated.ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={[withAlpha(colors.ink, 0), colors.scrim]}
        locations={[0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.chrome, { bottom }]} pointerEvents="box-none">
        {count > 1 ? (
          <View style={styles.segments} pointerEvents="none">
            {images.map((uri, i) => (
              <Segment key={`${i}:${uri}`} index={i} page={page} />
            ))}
          </View>
        ) : (
          <View />
        )}
        <View style={styles.badges} pointerEvents="box-none">
          {panoBadge}
          <View style={styles.pill} pointerEvents="none">
            <Images size={13} color={colors.inkOnDark} strokeWidth={2} />
            <Label tone="onDark" style={styles.tabular}>
              {count > 1 ? `${index + 1} / ${count}` : '1 photo'}
            </Label>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { overflow: 'hidden' },
  pageError: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  chrome: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  segments: { flexDirection: 'row', gap: space[1], flexShrink: 1 },
  segment: { width: 20, height: 4, borderRadius: 2, backgroundColor: colors.inkOnDark },
  badges: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: 28,
    paddingHorizontal: space[2] + 2,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.ink, 0.42),
  },
  surveyPill: {
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.surface, 0.9),
  },
  tabular: { fontVariant: ['tabular-nums'] },
});

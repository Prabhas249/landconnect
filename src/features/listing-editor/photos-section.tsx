import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, Plus, RotateCw, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { uploadImage } from '@/data/listings';
import { errorMessage } from '@/lib/supabase';
import { colors, duration, radius, space } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import { MAX_PHOTOS, type Photo } from './form';

const COLUMNS = 3;
const GAP = space[2];
const TILE_RADIUS = radius.sm;
const EMPTY_H = 136;

const tileLayout = LinearTransition.springify().damping(26).stiffness(240);

type Props = {
  photos: Photo[];
  setPhotos: (fn: (prev: Photo[]) => Photo[]) => void;
  error?: string;
};

/** Three-column photo grid. The first photo is the cover; long-press any other to promote it. */
export function PhotosSection({ photos, setPhotos, error }: Props) {
  const [width, setWidth] = useState(0);
  const tile = width > 0 ? Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS) : 0;
  const room = MAX_PHOTOS - photos.length;

  const patch = (key: string, p: Partial<Photo>) =>
    setPhotos((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const upload = async (key: string, uri: string) => {
    try {
      const url = await uploadImage(uri);
      patch(key, { url, uri: url, status: 'done' });
    } catch (e) {
      patch(key, { status: 'error' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Photo not uploaded', errorMessage(e));
    }
  };

  const pick = async () => {
    if (room <= 0) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.7,
    });
    if (res.canceled) return;
    const added: Photo[] = res.assets.slice(0, room).map((a, i) => ({
      key: `${Date.now()}-${i}`,
      uri: a.uri,
      url: null,
      status: 'uploading',
    }));
    setPhotos((prev) => [...prev, ...added]);
    added.forEach((p) => void upload(p.key, p.uri));
  };

  const retry = (p: Photo) => {
    patch(p.key, { status: 'uploading' });
    void upload(p.key, p.uri);
  };

  const makeCover = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhotos((prev) => {
      const hit = prev.find((x) => x.key === key);
      return hit ? [hit, ...prev.filter((x) => x.key !== key)] : prev;
    });
  };

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  if (photos.length === 0) {
    return (
      <View style={styles.wrap}>
        <PressableScale onPress={pick} to={0.98} accessibilityLabel="Add photos" style={[styles.empty, error ? styles.emptyError : null]}>
          <View style={styles.emptyIcon}>
            <ImagePlus size={22} color={colors.accent} strokeWidth={2} />
          </View>
          <Text variant="bodyStrong" tone="accent">
            Add site photos
          </Text>
          <Text variant="caption" tone="secondary" center>
            {`Up to ${MAX_PHOTOS}. The first becomes the cover.`}
          </Text>
        </PressableScale>
        {error ? (
          <Text variant="caption" tone="danger">
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.grid} onLayout={onLayout}>
        {tile > 0
          ? photos.map((p, i) => (
              <Animated.View
                key={p.key}
                entering={FadeIn.duration(duration.base)}
                exiting={FadeOut.duration(duration.fast)}
                layout={tileLayout}
                style={{ width: tile, height: tile }}>
                <PressableScale
                  haptic={false}
                  to={0.97}
                  delayLongPress={320}
                  onLongPress={p.status === 'done' && i > 0 ? () => makeCover(p.key) : undefined}
                  accessibilityLabel={i === 0 ? 'Cover photo' : `Photo ${i + 1}. Long-press to make it the cover`}
                  style={styles.tile}>
                  <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={duration.base} />
                  {i === 0 ? (
                    <View style={styles.cover}>
                      <Label tone="onDark">Cover</Label>
                    </View>
                  ) : null}
                  {p.status === 'uploading' ? (
                    <View style={styles.overlay}>
                      <ActivityIndicator color={colors.inkOnDark} />
                    </View>
                  ) : null}
                </PressableScale>
                {p.status === 'error' ? (
                  <PressableScale onPress={() => retry(p)} accessibilityLabel="Retry upload" style={[styles.overlay, styles.tileRadius]}>
                    <RotateCw size={20} color={colors.inkOnDark} strokeWidth={2.2} />
                    <Label tone="onDark">Retry</Label>
                  </PressableScale>
                ) : null}
                <PressableScale
                  to={0.9}
                  haptic="selection"
                  accessibilityLabel="Remove photo"
                  onPress={() => setPhotos((prev) => prev.filter((x) => x.key !== p.key))}
                  style={styles.remove}>
                  <X size={13} color={colors.inkOnDark} strokeWidth={2.6} />
                </PressableScale>
              </Animated.View>
            ))
          : null}
        {tile > 0 && room > 0 ? (
          <Animated.View layout={tileLayout} style={{ width: tile, height: tile }}>
            <PressableScale onPress={pick} accessibilityLabel="Add more photos" style={[styles.tile, styles.add]}>
              <Plus size={20} color={colors.accent} strokeWidth={2.2} />
              <Text variant="captionStrong" tone="accent">
                Add
              </Text>
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : (
        <Text variant="caption" tone="tertiary">
          {photos.length > 1
            ? `${photos.length} of ${MAX_PHOTOS} photos. Long-press one to make it the cover.`
            : `${photos.length} of ${MAX_PHOTOS} photos`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: {
    flex: 1,
    borderRadius: TILE_RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
  },
  tileRadius: { borderRadius: TILE_RADIUS, borderCurve: 'continuous', overflow: 'hidden' },
  add: { alignItems: 'center', justifyContent: 'center', gap: space[1], backgroundColor: colors.accentSoft },
  empty: {
    height: EMPTY_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    paddingHorizontal: space[5],
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.accentSoft,
  },
  emptyError: { backgroundColor: colors.dangerSoft },
  emptyIcon: {
    width: 44,
    height: 44,
    marginBottom: space[1],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  cover: {
    position: 'absolute',
    left: space[2],
    bottom: space[2],
    paddingHorizontal: space[2],
    height: 20,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    backgroundColor: colors.scrim,
  },
  remove: {
    position: 'absolute',
    top: space[1] + 2,
    right: space[1] + 2,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
});

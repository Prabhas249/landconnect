import { Image, type ImageLoadEventData } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';

import { colors } from '@/theme/tokens';

import { Shimmer } from '../skeleton';
import { photoUrl, type PhotoSize } from './image-variants';
import { isReady, lowResFor, rememberLoad } from './photo-cache';

export type PhotoProps = {
  /** The listing's stored (original) URL; the variant for `size` is derived from it. */
  uri: string;
  size: PhotoSize;
  /** Surface shown while nothing has decoded yet. */
  tint?: string;
  priority?: 'low' | 'normal' | 'high';
  /** Keep stable per photo inside recycled list cells. */
  recyclingKey?: string;
  transition?: number;
  allowDownscaling?: boolean;
  shimmer?: 'light' | 'dark' | false;
  style?: StyleProp<ImageStyle>;
  onLoad?: (e: ImageLoadEventData) => void;
  onError?: () => void;
};

/**
 * A listing photo with the session's loading rules: the right-sized variant, memory-disk cache,
 * a low-res stand-in when a smaller variant is already cached, a tinted shimmer otherwise, and a
 * cross-dissolve in — never a white flash. Fills its parent.
 */
export function Photo({
  uri,
  size,
  tint = colors.surfaceSunken,
  priority = 'normal',
  recyclingKey,
  transition = 220,
  allowDownscaling,
  shimmer = 'light',
  style,
  onLoad,
  onError,
}: PhotoProps) {
  const url = photoUrl(uri, size);
  // Tagged with the URL: list cells recycle this component across photos.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const placeholder = lowResFor(uri, size);
  const loading = loadedUrl !== url && !isReady(url) && !placeholder;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} pointerEvents="none">
      {loading && shimmer ? <Shimmer tone={shimmer} /> : null}
      <Image
        source={{ uri: url }}
        placeholder={placeholder}
        placeholderContentFit="cover"
        style={[StyleSheet.absoluteFill, style]}
        contentFit="cover"
        transition={{ duration: transition, effect: 'cross-dissolve' }}
        recyclingKey={recyclingKey ?? url}
        cachePolicy="memory-disk"
        priority={priority}
        allowDownscaling={allowDownscaling}
        onLoad={(e) => {
          rememberLoad(url, e);
          setLoadedUrl(url);
          onLoad?.(e);
        }}
        onError={onError}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

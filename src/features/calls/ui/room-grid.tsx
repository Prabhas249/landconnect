import {
  VideoTrack,
  isTrackReference,
  useIsMuted,
  useIsSpeaking,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import { MicOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { Profile } from '@/lib/types';
import { colors, duration, palette, radius, space } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Text } from '@/ui/text';

import { nightGlass } from './parts';

const GAP = space[2];

function Tile({
  trackRef,
  profile,
  width,
  height,
  mirror,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  profile: Profile | undefined;
  width: number;
  height: number;
  mirror: boolean;
}) {
  const participant = trackRef.participant;
  const speaking = useIsSpeaking(participant);
  const micPublication = participant.getTrackPublication(Track.Source.Microphone);
  const micRef: TrackReferenceOrPlaceholder = micPublication
    ? { participant, publication: micPublication, source: Track.Source.Microphone }
    : { participant, source: Track.Source.Microphone };
  const micMuted = useIsMuted(micRef) || !micPublication;

  const ring = useSharedValue(0);
  useEffect(() => {
    ring.set(withTiming(speaking ? 1 : 0, { duration: duration.base }));
  }, [ring, speaking]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.get() }));

  const camera = isTrackReference(trackRef) && !trackRef.publication.isMuted && trackRef.publication.track ? trackRef : null;
  // The token carries the public name, so this is the same name everyone else sees.
  const name = participant.isLocal ? 'You' : participant.name || 'Participant';
  const avatarSize = Math.min(72, Math.round(Math.min(width, height) * 0.36));

  return (
    <View style={[styles.tile, { width, height }]}>
      {camera ? (
        <VideoTrack
          key={camera.publication.trackSid}
          trackRef={camera}
          style={styles.full}
          objectFit="cover"
          mirror={participant.isLocal && mirror}
          zOrder={0}
        />
      ) : (
        <View style={styles.center}>
          <Avatar name={participant.name || 'Participant'} seed={participant.identity} uri={profile?.avatar_url} size={avatarSize} />
        </View>
      )}
      <Animated.View pointerEvents="none" style={[styles.speakerRing, ringStyle]} />
      <View style={styles.nameTag}>
        {micMuted ? <MicOff size={12} color={colors.inkOnDark} strokeWidth={2.2} /> : null}
        <Text variant="captionStrong" tone="onDark" numberOfLines={1}>
          {name}
        </Text>
      </View>
    </View>
  );
}

/**
 * Meeting-room grid: 1 → full, 2 → split, 3–4 → 2×2, more → scrolling two-column grid.
 * A ScrollView rather than a recycling list on purpose: native video surfaces must not be
 * recycled between participants, and a room holds a handful of people.
 */
export function RoomGrid({
  tracks,
  members,
  mirrorLocal,
  top,
  bottom,
}: {
  tracks: TrackReferenceOrPlaceholder[];
  members: Map<string, Profile>;
  mirrorLocal: boolean;
  top: number;
  bottom: number;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  // Others first, you last — like every grid call people already know.
  const ordered = [...tracks].sort((a, b) => Number(a.participant.isLocal) - Number(b.participant.isLocal));
  const n = ordered.length;
  const w = size.width - GAP * 2;
  const h = size.height - top - bottom;

  let tileW = w;
  let tileH = h;
  if (n === 2) tileH = (h - GAP) / 2;
  else if (n >= 3) {
    tileW = (w - GAP) / 2;
    tileH = n <= 4 ? (h - GAP) / 2 : tileW * 1.3;
  }

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {size.width > 0 ? (
        <ScrollView
          scrollEnabled={n > 4}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.grid, { paddingTop: top, paddingBottom: bottom, paddingHorizontal: GAP }]}>
          {ordered.map((ref) => (
            <Tile
              key={`${ref.participant.identity}-${ref.source}`}
              trackRef={ref}
              profile={members.get(ref.participant.identity)}
              width={Math.max(0, tileW)}
              height={Math.max(0, tileH)}
              mirror={mirrorLocal}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: palette.forest2,
  },
  full: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  speakerRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 2,
    borderColor: colors.accentBright,
  },
  nameTag: {
    position: 'absolute',
    left: space[2],
    bottom: space[2],
    maxWidth: '80%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    height: 26,
    paddingHorizontal: space[2],
    // Inner radius = tile radius − inset.
    borderRadius: radius.lg - space[2],
    borderCurve: 'continuous',
    backgroundColor: nightGlass.strong,
  },
});

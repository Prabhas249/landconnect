import { useTracks } from '@livekit/react-native';
import { useQuery } from '@tanstack/react-query';
import { Track } from 'livekit-client';
import { Users } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { fetchConversation } from '@/data/chat';
import { qk } from '@/data/keys';
import type { Profile } from '@/lib/types';
import { space } from '@/theme/tokens';
import { Text } from '@/ui/text';

import { hangUp, useCallStore } from '../call-store';
import { ControlBar } from './controls';
import { VIDEO_SURFACE } from './incoming-view';
import { LiveHeader, useLiveInsets } from './live-header';
import { CallBackdrop, CallTimer, NightChip, chipInk } from './parts';
import { RoomGrid } from './room-grid';

/** Live meeting room: a grid of everyone (camera or avatar), title, head count and timer. */
export function RoomCall({ onMinimize }: { onMinimize: () => void }) {
  const call = useCallStore((s) => s.call);
  const phase = useCallStore((s) => s.phase);
  const facing = useCallStore((s) => s.facing);
  const live = useLiveInsets();
  const conversationId = call?.conversation_id ?? '';

  const { data: conversation } = useQuery({
    queryKey: qk.conversation(conversationId),
    queryFn: () => fetchConversation(conversationId),
    enabled: conversationId.length > 0,
  });
  const members = new Map<string, Profile>((conversation?.members ?? []).map((m) => [m.id, m]));

  // One entry per participant; placeholders stand in for people with their camera off.
  const tiles = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const connected = phase === 'connected';
  // Video rooms sit on a dark surface (tiles are camera feeds); audio rooms keep the light design.
  const video = call?.kind === 'video';

  return (
    <View style={styles.fill}>
      {video ? <View style={[StyleSheet.absoluteFill, { backgroundColor: VIDEO_SURFACE }]} /> : <CallBackdrop glowY={0.2} />}
      <RoomGrid tracks={tiles} members={members} mirrorLocal={facing === 'user'} top={live.top + space[10]} bottom={live.bottom} />

      <LiveHeader onVideo={video} onMinimize={onMinimize}>
        <View style={styles.identity}>
          <Text variant="heading" tone={video ? 'onDark' : 'ink'} numberOfLines={1}>
            {conversation?.title ?? 'Meeting room'}
          </Text>
          <View style={styles.meta}>
            <NightChip onVideo={video} label={`${tiles.length} in room`} leading={<Users size={13} color={chipInk(video)} strokeWidth={2.3} />} />
            {connected ? (
              <CallTimer since={call?.answered_at ?? null} tone={video ? 'onDark' : 'ink'} />
            ) : (
              <Text variant="caption" tone={video ? 'onDark' : 'secondary'}>
                Connecting…
              </Text>
            )}
          </View>
        </View>
      </LiveHeader>

      <View pointerEvents="box-none" style={[styles.controls, { paddingBottom: live.controls }]}>
        <ControlBar isRoom isVideo={video} onEnd={hangUp} onVideo={video} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  identity: { alignItems: 'center', gap: space[2] },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

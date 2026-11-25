import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { CalendarClock, Image as ImageIcon, MapPin, Phone, Video, type LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { connectedSeconds, type CallLogEntry } from '@/data/call-log';
import { fetchLiveRoomSession } from '@/data/calls';
import { qk } from '@/data/keys';
import { joinRoom, placeCall } from '@/features/calls/actions';
import { photoUrl } from '@/features/listings/media/image-variants';
import { formatDateTime, formatStamp, isOnline, publicName } from '@/lib/format';
import type { ConversationSummary } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Card, Divider } from '@/ui/card';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import { describeCall, parseCallPreview } from './call-copy';
import { AvatarStack, LiveBadge, RoleChip, VerifiedTick } from './parts';
import { callTint } from './tints';

// ── preview

type Preview = { text: string; Icon: LucideIcon | null; danger: boolean; call: boolean };

/** The trigger stores a plain-text preview; recover photos, listings and call lines from its fixed phrasing. */
function readPreview(text: string | null, mine: boolean): Preview {
  if (!text) return { text: 'No messages yet. Say hello.', Icon: null, danger: false, call: false };
  if (text === 'Photo') return { text, Icon: ImageIcon, danger: false, call: false };
  if (text === 'Shared a listing') return { text, Icon: MapPin, danger: false, call: false };
  const facts = parseCallPreview(text, mine);
  if (!facts) return { text, Icon: null, danger: false, call: false };
  const copy = describeCall(facts);
  return { text: copy.line, Icon: copy.Direction, danger: copy.missed, call: true };
}

// ── direct conversation row

export const ConversationRow = memo(function ConversationRow({ item, me }: { item: ConversationSummary; me: string | null }) {
  const peer = item.peer;
  const name = peer ? publicName(peer) : 'Former member';
  const unread = item.unread > 0;
  const mine = item.last_message_sender === me;
  const preview = readPreview(item.last_message_preview, mine);

  return (
    <PressableScale
      haptic="selection"
      accessibilityLabel={`Chat with ${name}${unread ? `, ${item.unread} unread` : ''}`}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
      style={styles.row}>
      <Avatar
        name={name}
        seed={peer?.id ?? item.id}
        uri={peer?.avatar_url}
        size={52}
        online={peer ? isOnline(peer) : false}
      />
      <View style={styles.rowBody}>
        <View style={styles.line}>
          <View style={styles.nameWrap}>
            <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
              {name}
            </Text>
            {peer?.verified ? <VerifiedTick size={14} /> : null}
            {peer ? <RoleChip role={peer.role} /> : null}
          </View>
          <Label tone={unread ? 'accent' : 'tertiary'}>{formatStamp(item.last_message_at)}</Label>
        </View>

        <View style={styles.line}>
          <View style={styles.previewWrap}>
            {mine && !preview.call ? (
              <Text variant="caption" tone="tertiary">
                You:
              </Text>
            ) : null}
            {preview.Icon ? (
              <preview.Icon
                size={15}
                color={preview.danger ? colors.danger : unread ? colors.ink : colors.inkTertiary}
                strokeWidth={2.1}
              />
            ) : null}
            <Text
              variant={unread ? 'captionStrong' : 'caption'}
              tone={preview.danger ? 'danger' : unread ? 'ink' : 'secondary'}
              numberOfLines={1}
              style={styles.shrink}>
              {preview.text}
            </Text>
          </View>
          {unread ? (
            <View style={styles.badge}>
              <Text variant="label" tone="onDark" style={styles.badgeText}>
                {item.unread > 99 ? '99+' : String(item.unread)}
              </Text>
            </View>
          ) : null}
        </View>

        {item.listing ? (
          <View style={styles.listingLine}>
            {item.listing.images[0] ? (
              <Image
                source={{ uri: photoUrl(item.listing.images[0], 'thumb') }}
                style={styles.thumb}
                contentFit="cover"
                transition={160}
                cachePolicy="memory-disk"
                recyclingKey={item.id}
              />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <MapPin size={11} color={colors.accent} strokeWidth={2.2} />
              </View>
            )}
            <Text variant="caption" tone="tertiary" numberOfLines={1} style={styles.shrink}>
              {item.listing.title}
            </Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
});

// ── meeting room card

export const RoomCard = memo(function RoomCard({ item }: { item: ConversationSummary }) {
  const { data: live } = useQuery({
    queryKey: qk.roomSession(item.id),
    queryFn: () => fetchLiveRoomSession(item.id),
    refetchInterval: 20_000,
  });
  const title = item.title?.trim() || 'Untitled room';
  const open = () => router.push({ pathname: '/room/[id]', params: { id: item.id } });

  return (
    <PressableScale onPress={open} haptic="selection" accessibilityLabel={`Meeting room ${title}`}>
      <Card padding={5}>
        <View style={styles.roomTop}>
          <Label>
            Meeting room · {item.members.length} {item.members.length === 1 ? 'member' : 'members'}
          </Label>
          {live ? <LiveBadge /> : null}
        </View>

        <View style={styles.roomText}>
          <Text variant="heading" numberOfLines={1}>
            {title}
          </Text>
          {item.agenda ? (
            <Text variant="caption" tone="secondary" numberOfLines={2}>
              {item.agenda}
            </Text>
          ) : null}
        </View>

        <View style={styles.schedule}>
          <CalendarClock size={15} color={item.scheduled_at ? colors.accent : colors.inkTertiary} strokeWidth={2.1} />
          <Text variant="captionStrong" tone={item.scheduled_at ? 'ink' : 'tertiary'} style={styles.tabular}>
            {item.scheduled_at ? formatDateTime(item.scheduled_at) : 'Not scheduled'}
          </Text>
        </View>

        <View style={styles.roomDivider}>
          <Divider />
        </View>

        <View style={styles.roomFoot}>
          <AvatarStack people={item.members} max={4} size={32} />
          <View style={styles.roomActions}>
            <Button label="Open" variant="soft" size="sm" block={false} onPress={open} />
            <Button
              label={live ? 'Join' : 'Start'}
              variant="accent"
              size="sm"
              block={false}
              haptic="medium"
              leading={<Video size={15} color={colors.inkOnDark} strokeWidth={2.2} />}
              onPress={() => joinRoom(item.id)}
            />
          </View>
        </View>
      </Card>
    </PressableScale>
  );
});

// ── call log row

/** Consecutive calls with the same person, direction and outcome collapse into one row, WhatsApp-style. */
export type CallGroup = { key: string; entry: CallLogEntry; count: number };

export function groupCalls(log: CallLogEntry[]): CallGroup[] {
  const out: CallGroup[] = [];
  let prevSig = '';
  for (const c of log) {
    const sig = `${c.peer?.id}|${c.outgoing}|${!!c.answered_at}|${c.kind}|${new Date(c.created_at).toDateString()}`;
    const last = out[out.length - 1];
    if (last && sig === prevSig && !c.answered_at) last.count += 1;
    else out.push({ key: c.id, entry: c, count: 1 });
    prevSig = sig;
  }
  return out;
}

export const CallRow = memo(function CallRow({ group }: { group: CallGroup }) {
  const item = group.entry;
  const name = item.peer ? publicName(item.peer) : 'Former member';
  const copy = describeCall({ kind: item.kind, status: item.status, seconds: connectedSeconds(item), outgoing: item.outgoing });
  const KindIcon = item.kind === 'video' ? Video : Phone;
  const back = item.kind === 'video' ? callTint.video : callTint.voice;

  return (
    <View style={styles.row}>
      <PressableScale
        haptic="selection"
        style={styles.callMain}
        accessibilityLabel={`${copy.line} with ${name}`}
        onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.conversation_id } })}>
        <Avatar name={name} seed={item.peer?.id ?? item.id} uri={item.peer?.avatar_url} size={48} />
        <View style={styles.rowBody}>
          <View style={styles.line}>
            <Text variant="bodyStrong" tone={copy.missed ? 'danger' : 'ink'} numberOfLines={1} style={styles.shrink}>
              {name}
              {group.count > 1 ? ` (${group.count})` : ''}
            </Text>
            <Label>{formatStamp(item.created_at)}</Label>
          </View>
          <View style={styles.previewWrap}>
            <copy.Direction size={14} color={copy.missed ? colors.danger : copy.tint.ink} strokeWidth={2.3} />
            <Text variant="caption" tone={copy.missed ? 'danger' : 'secondary'} style={[styles.tabular, styles.shrink]} numberOfLines={1}>
              {copy.line}
            </Text>
          </View>
        </View>
      </PressableScale>
      <IconButton
        label={`Call ${name} back`}
        size={40}
        variant="plain"
        haptic="medium"
        style={{ backgroundColor: back.wash }}
        onPress={() => placeCall(item.conversation_id, item.kind)}>
        <KindIcon size={18} color={back.ink} strokeWidth={2.2} />
      </IconButton>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rowBody: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2], justifyContent: 'space-between' },
  nameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[1] + 2 },
  previewWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[1] },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: space[1] + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontVariant: ['tabular-nums'], letterSpacing: 0 },
  listingLine: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[1] },
  thumb: { width: 20, height: 20, borderRadius: radius.xs / 2 + 2, borderCurve: 'continuous' },
  thumbEmpty: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  callMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  roomTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  roomText: { gap: space[1], marginTop: space[2] },
  schedule: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] },
  roomDivider: { marginVertical: space[4] },
  roomFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  roomActions: { flexDirection: 'row', gap: space[2] },
});

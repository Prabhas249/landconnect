import { Phone, Video } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatTime } from '@/lib/format';
import type { CallKind, Message } from '@/lib/types';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { describeCall } from '../call-copy';
import { callTint } from '../tints';

const ICON = 40;
const CALL_BACK = 36;

export type CallCardProps = {
  message: Message;
  /** The caller posts the log line, so "mine" means the viewer placed the call. */
  mine: boolean;
  /** Absent in rooms, where nobody is rung. */
  onCallBack?: (kind: CallKind) => void;
};

/** A call log line in the thread: side-aligned like a bubble, with a one-tap call back. */
export const CallCard = memo(function CallCard({ message, mine, onCallBack }: CallCardProps) {
  const kind: CallKind = message.meta.call_kind ?? 'audio';
  const copy = describeCall({
    kind,
    status: message.meta.call_status,
    seconds: message.meta.duration_s ?? 0,
    outgoing: mine,
  });
  const KindIcon = kind === 'video' ? Video : Phone;
  const back = kind === 'video' ? callTint.video : callTint.voice;
  const time = formatTime(message.created_at);

  return (
    <View style={[styles.row, mine ? styles.rowMine : null]}>
      <View style={styles.card}>
        <View style={[styles.icon, { backgroundColor: copy.tint.wash }]}>
          <KindIcon size={18} color={copy.tint.ink} strokeWidth={2.2} />
        </View>
        <View style={styles.text}>
          <Text variant="captionStrong" tone={copy.missed ? 'danger' : 'ink'} numberOfLines={1}>
            {copy.title}
          </Text>
          <View style={styles.detail}>
            <copy.Direction size={12} color={copy.missed ? colors.danger : colors.inkTertiary} strokeWidth={2.3} />
            <Text variant="caption" tone="tertiary" numberOfLines={1} style={styles.tabular}>
              {copy.detail ? `${copy.detail} · ${time}` : time}
            </Text>
          </View>
        </View>
        {onCallBack ? (
          <PressableScale
            haptic="medium"
            to={0.9}
            accessibilityLabel={`${copy.title}. Call back`}
            onPress={() => onCallBack(kind)}
            style={[styles.callBack, { backgroundColor: back.wash }]}>
            <KindIcon size={16} color={back.ink} strokeWidth={2.3} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: gutter, paddingVertical: space[2] },
  rowMine: { justifyContent: 'flex-end' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minWidth: 232,
    maxWidth: '82%',
    padding: space[2],
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(16,32,28,0.05)',
    boxShadow: '0 12px 32px rgba(16,32,28,0.08)',
  },
  icon: { width: ICON, height: ICON, borderRadius: ICON / 2, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 1 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  tabular: { fontVariant: ['tabular-nums'] },
  callBack: {
    width: CALL_BACK,
    height: CALL_BACK,
    borderRadius: CALL_BACK / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import { StyleSheet, View } from 'react-native';

import type { Profile } from '@/lib/types';
import { space } from '@/theme/tokens';
import { ProgressSegments } from '@/ui/progress-segments';
import { Text } from '@/ui/text';

import { postureSummary } from './parts';

/** Headline and segmented meter: one segment per protection, filled when it favours discretion. */
export function PostureSummary({ profile }: { profile: Profile }) {
  const { safe, total, headline } = postureSummary(profile);
  return (
    <View style={styles.summary} accessible accessibilityLabel={`Privacy posture: ${headline}, ${safe} of ${total} protections on`}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="heading">{headline}</Text>
          <Text variant="caption" tone="secondary">
            Contact details are withheld whatever you choose.
          </Text>
        </View>
        <View style={styles.score}>
          {/* Heading size with tabular digits keeps the screen at three sizes. */}
          <Text variant="heading" style={styles.tabular}>
            {String(safe)}
          </Text>
          <Text variant="caption" tone="tertiary" style={styles.tabular}>
            of {total}
          </Text>
        </View>
      </View>
      <ProgressSegments total={total} value={safe} height={10} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  summary: { gap: space[3] },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: space[3] },
  score: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
  tabular: { fontVariant: ['tabular-nums'] },
});

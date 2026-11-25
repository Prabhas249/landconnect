import { ChevronRight } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { formatNumber, polygonAcres } from '@/lib/format';
import { colors, font, radius, space } from '@/theme/tokens';
import { Field } from '@/ui/field';
import { PressableScale } from '@/ui/pressable-scale';
import { Label, Text } from '@/ui/text';

import type { FormState } from './form';
import { Toggle } from './toggle';

/** Parcel outline with a pin, drawn in code. */
function ParcelGlyph({ size = 56 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 56 56" fill="none">
      <Path
        d="M8 36 L22 20 L44 24 L50 40 L28 48 Z"
        fill={colors.accentSoft}
        stroke={colors.accent}
        strokeWidth={1.9}
        strokeLinejoin="round"
        strokeDasharray="3 4"
      />
      <Path
        d="M28 8 C22.5 8 19 12 19 16.5 C19 22.5 28 31 28 31 C28 31 37 22.5 37 16.5 C37 12 33.5 8 28 8 Z"
        fill={colors.accent}
      />
      <Circle cx={28} cy={16.5} r={3.2} fill={colors.surface} />
    </Svg>
  );
}

type Props = {
  form: FormState;
  update: (patch: Partial<FormState>) => void;
  onPick: () => void;
  error?: string;
};

export function LocationSection({ form, update, onPick, error }: Props) {
  const hasPin = form.lat != null && form.lng != null;
  const acres = form.boundary && form.boundary.length >= 3 ? polygonAcres(form.boundary) : 0;

  return (
    <View style={styles.wrap}>
      <PressableScale onPress={onPick} accessibilityLabel="Choose location on map" style={[styles.pick, error ? styles.pickError : null]}>
        <View style={styles.glyph}>
          <ParcelGlyph size={GLYPH} />
        </View>
        <View style={styles.pickText}>
          {hasPin ? (
            <>
              <Label tone="accent">Pinned on map</Label>
              <Text variant="bodyStrong" numberOfLines={1} style={styles.mono}>
                {`${(form.lat ?? 0).toFixed(5)}, ${(form.lng ?? 0).toFixed(5)}`}
              </Text>
              <Text variant="caption" tone="secondary">
                {form.boundary && form.boundary.length >= 3
                  ? `Approximate area ${formatNumber(acres)} acres · ${form.boundary.length} boundary points`
                  : 'Pin only. Tap to outline the boundary.'}
              </Text>
            </>
          ) : (
            <>
              <Text variant="bodyStrong">Place the land on the map</Text>
              <Text variant="caption" tone="secondary">
                Drop a pin, then outline the boundary so buyers can judge the parcel.
              </Text>
            </>
          )}
        </View>
        <ChevronRight size={20} color={colors.inkTertiary} strokeWidth={2.1} />
      </PressableScale>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}

      <Field
        label="Locality"
        placeholder="e.g. Devanahalli"
        value={form.locality}
        onChangeText={(locality) => update({ locality })}
        autoCapitalize="words"
      />
      <View style={styles.split}>
        <View style={styles.half}>
          <Field
            label="District"
            placeholder="Bengaluru Rural"
            value={form.district}
            onChangeText={(district) => update({ district })}
            autoCapitalize="words"
          />
        </View>
        <View style={styles.half}>
          <Field
            label="State"
            placeholder="Karnataka"
            value={form.state}
            onChangeText={(state) => update({ state })}
            autoCapitalize="words"
          />
        </View>
      </View>
      <Field
        label="Survey number (optional)"
        placeholder="e.g. 112/3"
        value={form.survey}
        onChangeText={(survey) => update({ survey })}
        autoCapitalize="characters"
        autoCorrect={false}
        style={form.survey ? styles.monoInput : null}
      />

      <View style={styles.privacy}>
        <Toggle label="Hide exact location" value={form.hideExact} onChange={(hideExact) => update({ hideExact })} />
        <Text variant="caption" tone="tertiary">
          Buyers see an approximate area until you choose to share the exact parcel with them.
        </Text>
      </View>
    </View>
  );
}

const PAD = space[4];
const GLYPH = 48;
const styles = StyleSheet.create({
  wrap: { gap: space[4] },
  // Card radius xl (28) minus card padding (20) = 8 reads too tight at this size, so the well uses md.
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: PAD,
    minHeight: 88,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceMuted,
  },
  pickError: { backgroundColor: colors.dangerSoft },
  pickText: { flex: 1, gap: space[1] },
  glyph: { width: GLYPH, height: GLYPH },
  // Coordinates and survey numbers are code-like, so they take the mono face at the reading size.
  mono: { fontFamily: font.mono, letterSpacing: -0.2 },
  monoInput: { fontFamily: font.mono },
  split: { flexDirection: 'row', gap: space[3] },
  half: { flex: 1 },
  privacy: { gap: space[2] },
});

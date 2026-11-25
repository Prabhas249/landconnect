import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { colors, palette, radius } from '@/theme/tokens';

import { withAlpha } from '../meta';

const SIZE = 44;
const C = SIZE / 2;
const R = 15;

/**
 * Street-view style heading indicator: the mint wedge is where you are looking and how wide
 * (it narrows as you pinch in); the tick at the top marks the direction the photo opened at.
 * We have no compass bearing for the capture, so it is a relative heading, not true north.
 */
export function HeadingDial({ yaw, fov }: { yaw: SharedValue<number>; fov: SharedValue<number> }) {
  const wedge = useDerivedValue(() => {
    const sweep = (fov.get() * 180) / Math.PI;
    const centre = -90 + (yaw.get() * 180) / Math.PI;
    return Skia.PathBuilder.Make()
      .moveTo(C, C)
      .arcToOval(Skia.XYWHRect(C - R, C - R, R * 2, R * 2), centre - sweep / 2, sweep, false)
      .close()
      .detach();
  });

  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={styles.canvas}>
        <Circle cx={C} cy={C} r={R + 3} color={withAlpha(colors.inkOnDark, 0.12)} />
        <Path path={wedge} color={palette.mint} opacity={0.85} />
        <Group>
          <Circle cx={C} cy={C - R - 1} r={2} color={colors.inkOnDark} />
          <Circle cx={C} cy={C} r={3} color={colors.inkOnDark} />
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.night, 0.48),
    overflow: 'hidden',
  },
  canvas: { width: SIZE, height: SIZE },
});

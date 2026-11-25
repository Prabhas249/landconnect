import { Canvas, FilterMode, Fill, ImageShader, MipmapMode, Shader, Skia, type SkImage } from '@shopify/react-native-skia';
import type { StyleProp, ViewStyle } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { colors, palette } from '@/theme/tokens';

import { focalFor, graticuleEffect, panoramaEffect } from './pano-shader';

export type PanoramaCanvasProps = {
  /** Null draws the graticule skeleton through the same camera. */
  image: SkImage | null;
  yaw: SharedValue<number>;
  pitch: SharedValue<number>;
  fov: SharedValue<number>;
  width: number;
  height: number;
  /** Graticule colours: dark for the fullscreen viewer, light for the card. */
  tone?: 'night' | 'light';
  style?: StyleProp<ViewStyle>;
};

// Linear, no mipmaps: mip selection from screen-space derivatives would jump across the ±180° wrap.
const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

// Plain arrays (not Float32Array) so they copy cleanly into the UI-thread worklet closure.
const rgba = (hex: string) => Array.from(Skia.Color(hex));

const GRID_TONES = {
  night: { ink: rgba(palette.mint), base: rgba(colors.night), fill: colors.night },
  light: { ink: rgba(palette.green), base: rgba(colors.accentSoft), fill: colors.accentSoft },
};

/**
 * The look-around surface. Yaw / pitch / FOV are shared values written by gestures and frame
 * callbacks on the UI thread; a derived value turns them into shader uniforms there too, so the
 * JS thread is never involved while you look around.
 */
export function PanoramaCanvas({ image, yaw, pitch, fov, width, height, tone = 'night', style }: PanoramaCanvasProps) {
  const pano = panoramaEffect();
  const grid = graticuleEffect();
  const iw = image ? image.width() : 1;
  const ih = image ? image.height() : 1;
  const gridTone = GRID_TONES[tone];

  const camera = useDerivedValue(() => {
    const y = yaw.get();
    const p = pitch.get();
    return {
      rot: [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p)],
      focal: focalFor(fov.get(), width, height),
    };
  });

  const imageUniforms = useDerivedValue(() => ({
    resolution: [width, height],
    imageSize: [iw, ih],
    rot: camera.get().rot,
    focal: camera.get().focal,
  }));

  const gridUniforms = useDerivedValue(() => ({
    resolution: [width, height],
    rot: camera.get().rot,
    focal: camera.get().focal,
    ink: gridTone.ink,
    base: gridTone.base,
  }));

  return (
    <Canvas style={[{ width, height }, style]}>
      {image && pano ? (
        <Fill>
          <Shader source={pano} uniforms={imageUniforms}>
            <ImageShader image={image} tx="repeat" ty="clamp" sampling={SAMPLING} />
          </Shader>
        </Fill>
      ) : grid ? (
        <Fill>
          <Shader source={grid} uniforms={gridUniforms} />
        </Fill>
      ) : (
        <Fill color={gridTone.fill} />
      )}
    </Canvas>
  );
}

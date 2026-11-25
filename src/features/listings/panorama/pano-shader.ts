import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

/**
 * Rectilinear look-around through an equirectangular panorama.
 *
 * Each pixel becomes a ray (x, y, focal) in camera space, is rotated by pitch (about X) then yaw
 * (about Y), and the ray's longitude/latitude index the 2:1 image: u = lon / 2π + ½, v = ½ − lat / π.
 * Trig for the camera is done once per frame on the UI thread and arrives as `rot` (cos/sin of yaw
 * and pitch) so the fragment stage only pays for one atan pair.
 *
 * Seam: u is wrapped with `fract` and the image child uses a repeat tile mode with linear filtering
 * and no mipmaps, so texels either side of ±180° blend into each other and no derivative-driven mip
 * jump can draw a line down the seam. Poles: latitude comes from atan(y, |xz|) — stable at ±90° —
 * and the image child clamps vertically so the top and bottom rows never wrap into each other.
 */
const PANORAMA_SKSL = `
uniform shader image;
uniform float2 resolution;
uniform float2 imageSize;
uniform float4 rot;
uniform float focal;

const float PI = 3.14159265;
const float TAU = 6.28318531;

half4 main(float2 xy) {
  float3 d = normalize(float3(xy.x - 0.5 * resolution.x, 0.5 * resolution.y - xy.y, focal));
  float y1 = d.y * rot.z + d.z * rot.w;
  float z1 = d.z * rot.z - d.y * rot.w;
  float x2 = d.x * rot.x + z1 * rot.y;
  float z2 = z1 * rot.x - d.x * rot.y;
  float lon = atan(x2, z2);
  float lat = atan(y1, length(float2(x2, z2)));
  float u = fract(lon / TAU + 0.5);
  float v = clamp(0.5 - lat / PI, 0.0, 1.0);
  return image.eval(float2(u * imageSize.x, v * imageSize.y));
}
`;

/**
 * Loading skeleton drawn through the same projection: a graticule every 15° with a brighter
 * horizon, so the view already reads as a sphere you can turn while the photo arrives. Line
 * width is expressed in radians per pixel (1 / focal) because runtime effects have no fwidth.
 */
const GRATICULE_SKSL = `
uniform float2 resolution;
uniform float4 rot;
uniform float focal;
uniform float4 ink;
uniform float4 base;

const float PI = 3.14159265;
const float STEP = 0.261799388;

half4 main(float2 xy) {
  float3 d = normalize(float3(xy.x - 0.5 * resolution.x, 0.5 * resolution.y - xy.y, focal));
  float y1 = d.y * rot.z + d.z * rot.w;
  float z1 = d.z * rot.z - d.y * rot.w;
  float x2 = d.x * rot.x + z1 * rot.y;
  float z2 = z1 * rot.x - d.x * rot.y;
  float lon = atan(x2, z2);
  float lat = atan(y1, length(float2(x2, z2)));
  float px = 1.3 / focal;
  float dLon = abs(fract(lon / STEP + 0.5) - 0.5) * STEP * cos(lat);
  float dLat = abs(fract(lat / STEP + 0.5) - 0.5) * STEP;
  float grid = 1.0 - smoothstep(0.0, px, min(dLon, dLat));
  float horizon = 1.0 - smoothstep(0.0, px * 1.6, abs(lat));
  float fade = 1.0 - smoothstep(0.9, 1.45, abs(lat));
  float a = max(grid * 0.22 * fade, horizon * 0.55);
  return half4(mix(base.rgb, ink.rgb, a), 1.0);
}
`;

let panorama: SkRuntimeEffect | null | undefined;
let graticule: SkRuntimeEffect | null | undefined;

/** Compiled lazily so app start never pays for it; null means the device's SkSL compile failed. */
export function panoramaEffect() {
  if (panorama === undefined) panorama = Skia.RuntimeEffect.Make(PANORAMA_SKSL);
  return panorama;
}

export function graticuleEffect() {
  if (graticule === undefined) graticule = Skia.RuntimeEffect.Make(GRATICULE_SKSL);
  return graticule;
}

export const PANO_FOV = {
  /** Horizontal FOV across the shorter side, radians. */
  initial: (78 * Math.PI) / 180,
  min: (34 * Math.PI) / 180,
  max: (104 * Math.PI) / 180,
};
/** Centre-of-view pitch limit; the projection itself is correct past the poles. */
export const PANO_MAX_PITCH = (80 * Math.PI) / 180;

/** Focal length in px for a horizontal FOV across the shorter canvas side. */
export function focalFor(fov: number, width: number, height: number) {
  'worklet';
  return (0.5 * Math.min(width, height)) / Math.tan(fov / 2);
}

/** Wraps an angle into [-π, π) so yaw never drifts into float imprecision. */
export function wrapAngle(a: number) {
  'worklet';
  const t = Math.PI * 2;
  return a - t * Math.floor((a + Math.PI) / t);
}

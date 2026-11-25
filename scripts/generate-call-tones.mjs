#!/usr/bin/env node
/**
 * Synthesises the two call sounds into small mono 16-bit WAV files so the repo
 * needs no licensed audio:
 *
 *   assets/sounds/ringtone.wav — incoming call: a soft two-note bell ("da-ding") played
 *                                twice, then a rest. Loops seamlessly.
 *   assets/sounds/ringback.wav — outgoing call: the Indian ringback cadence
 *                                (0.4 s on, 0.2 s off, 0.4 s on, 2.0 s off) on a 400 + 425 Hz pair.
 *
 * Usage: node scripts/generate-call-tones.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'sounds');

/** Float samples in [-1, 1] → 16-bit PCM mono WAV. */
function encodeWav(samples) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

const seconds = (s) => Math.round(s * SAMPLE_RATE);

/** Bell-like note: fundamental + soft harmonics, quick attack, exponential decay. */
function bell(out, startS, freq, lengthS, gain) {
  const start = seconds(startS);
  const len = seconds(lengthS);
  const attack = seconds(0.008);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const env = (i < attack ? i / attack : 1) * Math.exp(-t * 5.2);
    const v =
      Math.sin(2 * Math.PI * freq * t) +
      0.34 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t * 3) +
      0.12 * Math.sin(2 * Math.PI * freq * 3.01 * t) * Math.exp(-t * 6);
    out[start + i] += v * env * gain;
  }
}

/** Steady dual tone with 12 ms raised-cosine edges so loops never click. */
function burst(out, startS, lengthS, freqs, gain) {
  const start = seconds(startS);
  const len = seconds(lengthS);
  const edge = seconds(0.012);
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    let env = 1;
    if (i < edge) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / edge);
    else if (i > len - edge) env = 0.5 - 0.5 * Math.cos((Math.PI * (len - i)) / edge);
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t);
    out[start + i] += (v / freqs.length) * env * gain;
  }
}

function normalise(samples, peak) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  const k = max > 0 ? peak / max : 1;
  return samples.map((s) => s * k);
}

function ringtone() {
  const out = new Float32Array(seconds(2.8));
  // G5 → D6, twice: calm, unmistakably a call, never shrill.
  const low = 783.99;
  const high = 1174.66;
  bell(out, 0.0, low, 0.7, 0.8);
  bell(out, 0.16, high, 0.9, 0.7);
  bell(out, 0.62, low, 0.7, 0.8);
  bell(out, 0.78, high, 1.2, 0.7);
  // Fade the tail to exact silence so the loop point is seamless.
  const fade = seconds(0.25);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return normalise(Array.from(out), 0.5);
}

function ringback() {
  const out = new Float32Array(seconds(3.0));
  burst(out, 0.0, 0.4, [400, 425], 1);
  burst(out, 0.6, 0.4, [400, 425], 1);
  return normalise(Array.from(out), 0.32);
}

mkdirSync(outDir, { recursive: true });
for (const [name, samples] of [
  ['ringtone.wav', ringtone()],
  ['ringback.wav', ringback()],
]) {
  const file = join(outDir, name);
  const wav = encodeWav(samples);
  writeFileSync(file, wav);
  console.log(`wrote ${file} (${(wav.length / 1024).toFixed(1)} KB)`);
}

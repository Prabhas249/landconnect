import type { AreaUnit, Profile } from './types';

/** Square feet per unit. Gunta and cent are the Karnataka / South India conventions. */
const SQFT: Record<AreaUnit, number> = {
  acre: 43560,
  gunta: 1089,
  cent: 435.6,
  sqft: 1,
  sqyd: 9,
};

export function toAcres(value: number, unit: AreaUnit) {
  return (value * SQFT[unit]) / SQFT.acre;
}

export function convertArea(value: number, from: AreaUnit, to: AreaUnit) {
  return (value * SQFT[from]) / SQFT[to];
}

const UNIT_LABEL: Record<AreaUnit, [string, string]> = {
  acre: ['acre', 'acres'],
  gunta: ['gunta', 'guntas'],
  cent: ['cent', 'cents'],
  sqft: ['sq ft', 'sq ft'],
  sqyd: ['sq yd', 'sq yd'],
};

const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatNumber(n: number) {
  return plain.format(n);
}

export function formatArea(value: number, unit: AreaUnit) {
  const [one, many] = UNIT_LABEL[unit];
  return `${plain.format(value)} ${value === 1 ? one : many}`;
}

export function unitLabel(unit: AreaUnit, plural = false) {
  return UNIT_LABEL[unit][plural ? 1 : 0];
}

function trim(n: number, digits: number) {
  return n.toFixed(digits).replace(/\.?0+$/, '');
}

/** Indian convention: ₹48 L, ₹2.4 Cr. Returns the parts so UI can style the unit separately. */
export function priceParts(inr: number): { amount: string; unit: '' | 'K' | 'L' | 'Cr' } {
  if (inr >= 1e7) return { amount: trim(inr / 1e7, inr >= 1e8 ? 1 : 2), unit: 'Cr' };
  if (inr >= 1e5) return { amount: trim(inr / 1e5, inr >= 1e6 ? 1 : 2), unit: 'L' };
  if (inr >= 1e3) return { amount: trim(inr / 1e3, 0), unit: 'K' };
  return { amount: whole.format(inr), unit: '' };
}

export function formatPrice(inr: number) {
  const { amount, unit } = priceParts(inr);
  return `₹${amount}${unit ? ` ${unit}` : ''}`;
}

/** "₹48 L / acre" */
export function formatRate(priceTotal: number, areaValue: number, unit: AreaUnit) {
  if (!areaValue) return '';
  return `${formatPrice(priceTotal / areaValue)} / ${UNIT_LABEL[unit][0]}`;
}

/** The name other people see, honouring the privacy setting. */
export function publicName(p: Pick<Profile, 'display_name' | 'handle' | 'show_real_name'> | null | undefined) {
  if (!p) return 'Unknown';
  return p.show_real_name ? p.display_name : p.handle;
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const fullFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

export function formatTime(iso: string) {
  return timeFmt.format(new Date(iso)).toLowerCase();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Chat-list stamp: time today, "Yesterday", weekday this week, else date. */
export function formatStamp(iso: string) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 864e5);
  if (days <= 0) return formatTime(iso);
  if (days === 1) return 'Yesterday';
  if (days < 7) return dayFmt.format(d);
  return dateFmt.format(d);
}

/** Day separator in a chat thread. */
export function formatDay(iso: string) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return fullFmt.format(d);
}

export function formatDateTime(iso: string) {
  return `${dateFmt.format(new Date(iso))}, ${formatTime(iso)}`;
}

export function formatAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return dateFmt.format(new Date(iso));
}

/** Presence line that respects the "show last seen" setting. */
export function formatPresence(p: Pick<Profile, 'last_seen_at' | 'show_last_seen'>) {
  if (!p.show_last_seen) return null;
  const s = (Date.now() - new Date(p.last_seen_at).getTime()) / 1000;
  if (s < 90) return 'online';
  return `last seen ${formatAgo(p.last_seen_at)}`;
}

export function isOnline(p: Pick<Profile, 'last_seen_at' | 'show_last_seen'>) {
  return p.show_last_seen && Date.now() - new Date(p.last_seen_at).getTime() < 90_000;
}

/** 0:07, 12:45, 1:02:03 */
export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Rough polygon area in acres from [lng, lat] points (equirectangular; fine at parcel scale). */
export function polygonAcres(points: [number, number][]) {
  if (points.length < 3) return 0;
  const lat0 = (points[0][1] * Math.PI) / 180;
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos(lat0);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * mLng * (y2 * mLat) - x2 * mLng * (y1 * mLat);
  }
  return Math.abs(sum / 2) / 4046.86;
}

/** Deterministically nudges a pin ~300–600 m so an "approximate location" never reveals the parcel. */
export function fuzzLocation(id: string, lat: number, lng: number) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const angle = ((Math.abs(h) % 360) * Math.PI) / 180;
  const dist = 0.003 + (Math.abs(h >> 8) % 100) / 33000;
  return { lat: lat + Math.sin(angle) * dist, lng: lng + Math.cos(angle) * dist };
}

/** 1 hectare = 2.47105 acres. */
export const ACRES_PER_HECTARE = 2.47105;

/**
 * Indian digit grouping (3,48,480 · 12,34,567.5) without relying on the engine's Intl data.
 * A worklet, so count-up figures can format on the UI thread.
 */
export function groupIndian(n: number, decimals = 0) {
  'worklet';
  const neg = n < 0;
  const factor = Math.pow(10, decimals);
  const r = Math.round(Math.abs(n) * factor) / factor;
  let int = Math.floor(r);
  let frac = decimals > 0 ? Math.round((r - int) * factor) : 0;
  if (frac >= factor) {
    int += 1;
    frac = 0;
  }
  const s = String(int);
  let out = s;
  if (s.length > 3) {
    let rest = s.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) parts.unshift(rest);
    out = `${parts.join(',')},${s.slice(-3)}`;
  }
  if (frac > 0) {
    let f = String(frac);
    while (f.length < decimals) f = `0${f}`;
    out = `${out}.${f.replace(/0+$/, '')}`;
  }
  return neg && (int > 0 || frac > 0) ? `-${out}` : out;
}

/** 8.25 acres → { acres: 8, guntas: 10 }. Guntas keep up to two decimals; 39.999… carries over. */
export function acresAndGuntas(totalAcres: number) {
  let acres = Math.floor(totalAcres + 1e-9);
  let guntas = Math.round((totalAcres - acres) * 40 * 100) / 100;
  if (guntas >= 40) {
    acres += 1;
    guntas = 0;
  }
  return { acres, guntas: Math.max(0, guntas) };
}

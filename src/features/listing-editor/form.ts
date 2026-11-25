import type { AreaUnit, LandType, ListingInput, ListingWithOwner, LngLat } from '@/lib/types';

export const MAX_PHOTOS = 8;

export type Photo = {
  /** Local key, stable across upload. */
  key: string;
  /** Local uri while uploading, remote url afterwards. */
  uri: string;
  url: string | null;
  status: 'uploading' | 'done' | 'error';
};

export type FormState = {
  photos: Photo[];
  title: string;
  landType: LandType;
  description: string;
  areaText: string;
  unit: AreaUnit;
  priceText: string;
  negotiable: boolean;
  lat: number | null;
  lng: number | null;
  boundary: LngLat[] | null;
  locality: string;
  district: string;
  state: string;
  survey: string;
  hideExact: boolean;
  features: string[];
  documents: string[];
};

export type FormErrors = Partial<Record<'title' | 'area' | 'price' | 'location' | 'photos', string>>;

export const emptyForm: FormState = {
  photos: [],
  title: '',
  landType: 'agricultural',
  description: '',
  areaText: '',
  unit: 'acre',
  priceText: '',
  negotiable: true,
  lat: null,
  lng: null,
  boundary: null,
  locality: '',
  district: '',
  state: 'Karnataka',
  survey: '',
  hideExact: true,
  features: [],
  documents: [],
};

export function formFromListing(l: ListingWithOwner): FormState {
  return {
    photos: l.images.map((url, i) => ({ key: `r${i}-${url}`, uri: url, url, status: 'done' as const })),
    title: l.title,
    landType: l.land_type,
    description: l.description,
    areaText: String(l.area_value),
    unit: l.area_unit,
    priceText: String(Math.round(l.price_total)),
    negotiable: l.negotiable,
    lat: l.lat,
    lng: l.lng,
    boundary: l.boundary,
    locality: l.locality,
    district: l.district,
    state: l.state,
    survey: l.survey_number ?? '',
    hideExact: l.hide_exact_location,
    features: l.features,
    documents: l.documents,
  };
}

export const parseArea = (t: string) => {
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};
export const parsePrice = (t: string) => {
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : 0;
};

export function validate(f: FormState): FormErrors {
  const e: FormErrors = {};
  if (f.title.trim().length < 3) e.title = 'Add a short title, at least 3 characters.';
  if (parseArea(f.areaText) <= 0) e.area = 'Enter the size of the parcel.';
  if (parsePrice(f.priceText) <= 0) e.price = 'Enter the total asking price.';
  if (f.lat == null || f.lng == null) e.location = 'Choose where the land is on the map.';
  if (f.photos.some((p) => p.status === 'uploading')) e.photos = 'Photos are still uploading.';
  return e;
}

/** Which of the five sections are finished, in editor order. */
export function sectionStatus(f: FormState): boolean[] {
  return [
    f.photos.some((p) => p.status === 'done'),
    f.title.trim().length >= 3 && f.landType.length > 0,
    parseArea(f.areaText) > 0 && parsePrice(f.priceText) > 0,
    f.lat != null && f.lng != null,
    f.features.length + f.documents.length > 0,
  ];
}

/** Number of finished sections out of five. */
export function completeness(f: FormState) {
  return sectionStatus(f).filter(Boolean).length;
}

/** Caller must have run `validate` first, so location is present. */
export function toInput(f: FormState, status: ListingInput['status']): ListingInput {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    land_type: f.landType,
    area_value: parseArea(f.areaText),
    area_unit: f.unit,
    price_total: parsePrice(f.priceText),
    negotiable: f.negotiable,
    locality: f.locality.trim(),
    district: f.district.trim(),
    state: f.state.trim(),
    lat: f.lat ?? 0,
    lng: f.lng ?? 0,
    boundary: f.boundary,
    hide_exact_location: f.hideExact,
    survey_number: f.survey.trim() || null,
    documents: f.documents,
    features: f.features,
    images: f.photos.flatMap((p) => (p.url ? [p.url] : [])),
    status,
  };
}

/** Serialisable snapshot used for the unsaved-changes check. */
export function snapshot(f: FormState) {
  return JSON.stringify({ ...f, photos: f.photos.map((p) => p.url ?? p.uri) });
}

/** Indian digit grouping on a plain digit string: 1250000 -> 12,50,000. String-only, so no rounding. */
export function groupIndian(digits: string) {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${digits.slice(-3)}`;
}

/** Live display for a decimal entry ("1234.5" -> "1,234.5"), keeping a trailing dot while typing. */
export function groupDecimal(text: string) {
  if (!text) return text;
  const [int, frac] = text.split('.');
  const grouped = groupIndian(int || (frac != null ? '0' : ''));
  return frac != null ? `${grouped}.${frac}` : grouped;
}

/** Digits only, no leading zeros: what the price field stores. */
export const cleanPrice = (t: string) => t.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);

/** One decimal point, at most two decimals: what the area field stores. */
export const cleanArea = (t: string) =>
  t
    .replace(/[^0-9.]/g, '')
    .replace(/(\..*)\./g, '$1')
    .replace(/^0+(?=\d)/, '')
    .replace(/(\.\d{2})\d+$/, '$1')
    .slice(0, 12);

import { create } from 'zustand';

import type { LngLat } from '@/lib/types';

/**
 * Hand-off between the listing editor and the map location picker.
 * The editor seeds it, the picker writes the chosen pin / boundary back, the editor reads it on return.
 */
type DraftLocation = {
  lat: number | null;
  lng: number | null;
  boundary: LngLat[] | null;
  /** Reverse-geocoded hints, when available. */
  locality: string | null;
  district: string | null;
  state: string | null;
};

type ListingDraftState = DraftLocation & {
  setLocation: (patch: Partial<DraftLocation>) => void;
  reset: () => void;
};

const empty: DraftLocation = { lat: null, lng: null, boundary: null, locality: null, district: null, state: null };

export const useListingDraft = create<ListingDraftState>((set) => ({
  ...empty,
  setLocation: (patch) => set(patch),
  reset: () => set(empty),
}));

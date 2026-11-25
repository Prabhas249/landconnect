/** Domain types — mirror `supabase/migrations/0001_init.sql`. */

export type UserRole = 'buyer' | 'seller' | 'broker';
export type LandType = 'agricultural' | 'residential' | 'commercial' | 'industrial' | 'farmhouse';
export type AreaUnit = 'acre' | 'gunta' | 'cent' | 'sqft' | 'sqyd';
export type ListingStatus = 'draft' | 'active' | 'under_offer' | 'sold';
export type ConversationKind = 'direct' | 'room';
export type MessageKind = 'text' | 'image' | 'listing' | 'call' | 'system';
export type CallKind = 'audio' | 'video';
export type CallStatus = 'ringing' | 'accepted' | 'rejected' | 'missed' | 'cancelled' | 'ended';
export type CallPermission = 'everyone' | 'contacts' | 'nobody';

export type Profile = {
  id: string;
  role: UserRole;
  display_name: string;
  /** Anonymous handle, e.g. "Buyer · B-2041". Shown when `show_real_name` is off. */
  handle: string;
  avatar_url: string | null;
  city: string | null;
  about: string | null;
  verified: boolean;
  show_real_name: boolean;
  show_last_seen: boolean;
  read_receipts: boolean;
  allow_calls: CallPermission;
  last_seen_at: string;
  created_at: string;
};

/** Owner-only contact details. Never joined into other users' queries. */
export type ProfilePrivate = { id: string; phone: string | null; email: string | null };

/** [lng, lat] */
export type LngLat = [number, number];

export type Listing = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  land_type: LandType;
  area_value: number;
  area_unit: AreaUnit;
  /** INR */
  price_total: number;
  negotiable: boolean;
  locality: string;
  district: string;
  state: string;
  lat: number;
  lng: number;
  boundary: LngLat[] | null;
  hide_exact_location: boolean;
  survey_number: string | null;
  documents: string[];
  features: string[];
  images: string[];
  /** Equirectangular (2:1) 360° site photo, if the owner added one. */
  panorama_url: string | null;
  status: ListingStatus;
  verified: boolean;
  views: number;
  created_at: string;
  updated_at: string;
};

export type ListingWithOwner = Listing & { owner: Profile };

export type ListingInput = Pick<
  Listing,
  | 'title'
  | 'description'
  | 'land_type'
  | 'area_value'
  | 'area_unit'
  | 'price_total'
  | 'negotiable'
  | 'locality'
  | 'district'
  | 'state'
  | 'lat'
  | 'lng'
  | 'boundary'
  | 'hide_exact_location'
  | 'survey_number'
  | 'documents'
  | 'features'
  | 'images'
  | 'status'
>;

export type Conversation = {
  id: string;
  kind: ConversationKind;
  listing_id: string | null;
  title: string | null;
  agenda: string | null;
  scheduled_at: string | null;
  created_by: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_sender: string | null;
  created_at: string;
};

/** A conversation as the chat list needs it. */
export type ConversationSummary = Conversation & {
  members: Profile[];
  /** The other participant in a direct chat. */
  peer: Profile | null;
  listing: Pick<Listing, 'id' | 'title' | 'images' | 'locality' | 'price_total'> | null;
  unread: number;
  my_last_read_at: string;
};

export type MessageMeta = {
  /** kind = image */
  image_url?: string;
  /** kind = listing */
  listing_id?: string;
  /** kind = call */
  call_id?: string;
  call_kind?: CallKind;
  call_status?: CallStatus;
  duration_s?: number;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: MessageKind;
  body: string;
  meta: MessageMeta;
  created_at: string;
  /** Client-only: optimistic message not yet confirmed. */
  pending?: boolean;
};

export type Call = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string | null;
  kind: CallKind;
  status: CallStatus;
  room_name: string;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
};

export type ListingFilters = {
  query?: string;
  landType?: LandType | 'all';
  maxPrice?: number;
  minAcres?: number;
  sort?: 'newest' | 'price_low' | 'price_high' | 'area';
};

export const LAND_TYPES: { value: LandType; label: string }[] = [
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'farmhouse', label: 'Farmhouse' },
];

export const AREA_UNITS: { value: AreaUnit; label: string; short: string }[] = [
  { value: 'acre', label: 'Acres', short: 'ac' },
  { value: 'gunta', label: 'Guntas', short: 'gu' },
  { value: 'cent', label: 'Cents', short: 'ct' },
  { value: 'sqft', label: 'Sq ft', short: 'sq ft' },
  { value: 'sqyd', label: 'Sq yd', short: 'sq yd' },
];

/** Karnataka land paperwork a seller can mark as available. */
export const DOCUMENT_OPTIONS = ['RTC / Pahani', 'Encumbrance (EC)', 'Mutation', 'Khata', 'Survey sketch', 'DC conversion'] as const;

export const FEATURE_OPTIONS = [
  'Road access',
  'Borewell',
  'Electricity',
  'Fenced',
  'Clear title',
  'Highway facing',
  'Corner plot',
  'Near water body',
] as const;

export const ROLE_COPY: Record<UserRole, { label: string; blurb: string; can: string[] }> = {
  buyer: {
    label: 'Buyer',
    blurb: 'Explore verified land and talk to owners directly.',
    can: ['Browse and save listings', 'Message and call sellers', 'Join meeting rooms'],
  },
  seller: {
    label: 'Seller',
    blurb: 'List your land and meet serious buyers.',
    can: ['Publish and manage listings', 'Geotag your parcel', 'Chat and call buyers'],
  },
  broker: {
    label: 'Broker',
    blurb: 'Manage a portfolio on behalf of landowners.',
    can: ['Publish for multiple owners', 'Host meeting rooms', 'Track enquiries'],
  },
};

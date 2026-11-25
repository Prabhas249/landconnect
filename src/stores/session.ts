import { create } from 'zustand';

import { errorMessage, isBackendConfigured, supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/lib/types';

type Status = 'loading' | 'signedOut' | 'signedIn';

export type SignUpInput = {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  city?: string;
  phone?: string;
};

type SessionState = {
  status: Status;
  userId: string | null;
  profile: Profile | null;
  /** Call once at app start. */
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (input: SignUpInput) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Optimistically patch own profile (privacy settings, name, about…). */
  updateProfile: (patch: Partial<Omit<Profile, 'id' | 'role' | 'handle' | 'verified'>>) => Promise<string | null>;
};

async function loadProfile(userId: string): Promise<Profile | null> {
  // The profile row is created by a database trigger; retry briefly right after sign-up.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (data) return data as Profile;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

let started = false;

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  userId: null,
  profile: null,

  init: async () => {
    if (started) return;
    started = true;
    if (!isBackendConfigured) {
      set({ status: 'signedOut' });
      return;
    }
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) {
      const profile = await loadProfile(user.id);
      set(profile ? { status: 'signedIn', userId: user.id, profile } : { status: 'signedOut' });
    } else {
      set({ status: 'signedOut' });
    }

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        set({ status: 'signedOut', userId: null, profile: null });
      }
    });
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error || !data.user) return errorMessage(error, 'Could not sign you in.');
    const profile = await loadProfile(data.user.id);
    if (!profile) return 'Your profile could not be loaded.';
    set({ status: 'signedIn', userId: data.user.id, profile });
    return null;
  },

  signUp: async ({ email, password, displayName, role, city, phone }) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      // The role is written by a server-side trigger from this metadata and cannot be changed afterwards.
      options: { data: { display_name: displayName.trim(), role, city: city?.trim() || null, phone: phone?.trim() || null } },
    });
    if (error || !data.user) return errorMessage(error, 'Could not create your account.');
    if (!data.session) {
      // Accounts are auto-confirmed server-side in this prototype, so a direct sign-in succeeds.
      const retry = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (retry.error) return 'Account created. Please sign in to continue.';
    }
    const profile = await loadProfile(data.user.id);
    if (!profile) return 'Your profile could not be created.';
    set({ status: 'signedIn', userId: data.user.id, profile });
    return null;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ status: 'signedOut', userId: null, profile: null });
  },

  refreshProfile: async () => {
    const { userId } = get();
    if (!userId) return;
    const profile = await loadProfile(userId);
    if (profile) set({ profile });
  },

  updateProfile: async (patch) => {
    const { userId, profile } = get();
    if (!userId || !profile) return 'Not signed in.';
    set({ profile: { ...profile, ...patch } });
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) {
      set({ profile });
      return errorMessage(error);
    }
    return null;
  },
}));

/** Current user id, for use outside React. */
export function currentUserId() {
  return useSession.getState().userId;
}

export function canManageListings(role: UserRole | undefined | null) {
  return role === 'seller' || role === 'broker';
}

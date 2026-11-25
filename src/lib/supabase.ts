import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';

/** False until `.env` is filled in — the app shows a setup notice instead of crashing. */
export const isBackendConfigured = url.length > 0 && key.length > 0;

export const supabase = createClient(url || 'https://placeholder.supabase.co', key || 'placeholder', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** Turns a Supabase / Postgres error into a sentence a person can read. */
/** Unwraps a Supabase response, throwing its error so React Query and callers see a rejection. */
export function need<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.') {
  if (!e) return fallback;
  const msg = typeof e === 'string' ? e : ((e as { message?: string }).message ?? '');
  if (!msg) return fallback;
  if (/invalid login credentials/i.test(msg)) return 'That email and password do not match.';
  if (/already registered/i.test(msg)) return 'An account with this email already exists.';
  if (/row-level security/i.test(msg)) return 'Your role does not allow this action.';
  if (/network request failed|failed to fetch/i.test(msg)) return 'No connection. Check your network and retry.';
  return msg;
}

import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert } from 'react-native';

import { qk } from '@/data/keys';
import { errorMessage, supabase } from '@/lib/supabase';
import { useSession } from '@/stores/session';

// The schema has one public bucket. Its insert/delete policies allow any path whose first folder is
// the caller's uid (supabase/migrations/0001_init.sql), so avatars live at `<uid>/avatar-<ts>.<ext>`.
const BUCKET = 'listing-images';
const PREFIX = 'avatar-';

export type PhotoSource = 'library' | 'camera';

function extOf(asset: ImagePicker.ImagePickerAsset) {
  const fromMime = asset.mimeType?.split('/')[1];
  const fromName = asset.uri.split('?')[0].split('.').pop();
  const ext = (fromMime || fromName || 'jpg').toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? ext : 'jpg';
}

/** Storage path of a URL we previously uploaded for this user, or null if it is not ours to delete. */
function ownAvatarPath(url: string | null, userId: string) {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
  return path.startsWith(`${userId}/${PREFIX}`) ? path : null;
}

async function pickAsset(source: PhotoSource) {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    shape: 'oval',
    quality: 0.8,
  };
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access is off', 'Allow camera access in Settings to take a profile photo.');
      return null;
    }
    const res = await ImagePicker.launchCameraAsync(options);
    return res.canceled ? null : res.assets[0];
  }
  const res = await ImagePicker.launchImageLibraryAsync(options);
  return res.canceled ? null : res.assets[0];
}

/**
 * Pick, preview and upload a profile photo. The picked image shows on the pass at once
 * (`preview`), then `avatar_url` is written through `updateProfile` once the upload lands.
 * The previous avatar file is removed afterwards so the folder does not fill with old faces.
 */
export function useProfilePhoto() {
  const qc = useQueryClient();
  const userId = useSession((s) => s.userId);
  const profile = useSession((s) => s.profile);
  const updateProfile = useSession((s) => s.updateProfile);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = () => {
    if (userId) void qc.invalidateQueries({ queryKey: qk.profile(userId) });
    // Chat lists embed member profiles, so their faces refresh too.
    void qc.invalidateQueries({ queryKey: qk.conversations });
  };

  const change = async (source: PhotoSource) => {
    if (!userId || busy) return;
    const asset = await pickAsset(source);
    if (!asset) return;

    const previous = profile?.avatar_url ?? null;
    setPreview(asset.uri);
    setBusy(true);
    try {
      const ext = extOf(asset);
      const path = `${userId}/${PREFIX}${Date.now()}.${ext}`;
      const bytes = await (await fetch(asset.uri)).arrayBuffer();
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: asset.mimeType ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: false });
      if (error) throw new Error(error.message);
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

      const err = await updateProfile({ avatar_url: url });
      if (err) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw new Error(err);
      }
      const old = ownAvatarPath(previous, userId);
      if (old) void supabase.storage.from(BUCKET).remove([old]);
      finish();
      // The local preview stays on screen: swapping to the remote copy now would flash the initials.
    } catch (e) {
      setPreview(null);
      Alert.alert('Photo not updated', errorMessage(e, 'The upload did not finish. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!userId || busy || !profile?.avatar_url) return;
    const previous = profile.avatar_url;
    setPreview(null);
    setBusy(true);
    const err = await updateProfile({ avatar_url: null });
    setBusy(false);
    if (err) {
      Alert.alert('Photo not removed', err);
      return;
    }
    const old = ownAvatarPath(previous, userId);
    if (old) void supabase.storage.from(BUCKET).remove([old]);
    finish();
  };

  return { preview, busy, change, remove, hasPhoto: !!profile?.avatar_url };
}

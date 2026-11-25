import { useLocalSearchParams } from 'expo-router';

import { ListingEditor } from '@/features/listing-editor/editor';

export default function EditListingRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <ListingEditor id={typeof id === 'string' && id.length > 0 ? id : undefined} />;
}

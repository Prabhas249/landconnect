import { useLocalSearchParams } from 'expo-router';

import { CallScreen } from '@/features/calls/call-screen';

export default function CallRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const callId = Array.isArray(id) ? id[0] : id;
  return <CallScreen key={callId} id={callId ?? ''} />;
}

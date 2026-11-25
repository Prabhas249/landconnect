// LiveKit's WebRTC globals must be registered before any other module touches them.
import { registerGlobals } from '@livekit/react-native';

registerGlobals();

// eslint-disable-next-line import/first
import 'expo-router/entry';

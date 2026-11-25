# LandConnect — land marketplace prototype

> © 2026 Prabhas Raju. All rights reserved. Shared for the LandConnect technical evaluation only; see [License](#license).

A React Native prototype of a land marketplace for buyers, sellers and brokers: browse geotagged land,
manage listings, chat, hold meeting rooms, and place **in-app audio and video calls without ever exchanging phone numbers**.

Built for the LandConnect technical assignment (Mobile Developer).

| | |
|---|---|
| **Android APK** | [landconnect.apk](https://github.com/Prabhas249/landconnect/releases/download/v1.0/landconnect.apk) (Android 7+, arm64) |
| **Demo video** | [LandConnect-demo.mp4](https://github.com/Prabhas249/landconnect/releases/download/v1.0/LandConnect-demo.mp4) (1:30, screen recording) |
| **Demo login** | One tap on the sign-in screen (Buyer, Seller or Broker), or see [Demo accounts](#demo-accounts) |

## Features

| Requirement (from the brief) | How it is met | Where |
|---|---|---|
| User authentication and role management | Email sign-up and login; Buyer, Seller or Broker chosen at sign-up and fixed by the database | `src/app/(auth)`, `src/stores/session.ts` |
| Community and land listings | Explore feed with photos, price, area, location, filters, search and saved land | `src/app/(app)/(tabs)/index.tsx`, `src/features/listings` |
| Property listing management | Sellers and brokers create, edit, pause and delete listings with photos, price, area and location | `src/features/listing-editor`, `(tabs)/land.tsx` |
| Maps and geolocation | Map of all listings, pin and parcel-boundary picker, "hide exact location" | `src/features/map`, `listing/pick-location.tsx` |
| Messaging and meeting rooms | WhatsApp-style chats (ticks, typing, date separators, call cards) and multi-party rooms with an agenda | `src/features/chat`, `room/*` |
| **In-app audio and video calling** | Initiate, receive, accept, reject and end; switch voice to video mid-call; minimise to a floating bar; decline with a quick message; call history | `src/features/calls` (see its README) |
| Privacy and access control | Row level security, owner-only contact details, anonymous handle, "who can call me", block list | `supabase/migrations`, `src/features/profile` |

### Calling in detail

- **Start** a voice or video call from any chat header, a call card or the Calls tab.
- **Receive** a full-screen incoming call with ringtone and vibration, and **accept**, **reject** or **reject with a quick message**
  ("Can't talk now, call you back").
- **During the call**: mute, speaker, camera on/off, flip camera, a draggable self-view that snaps to corners and swaps on tap,
  signal-strength bars, "Reconnecting…" and weak-network warnings, and a "Muted" badge when the other person mutes.
- **Voice ↔ video**: either side turns the camera on and both phones switch to the video layout.
- **Minimise**: keep using the app while a floating call bar shows the timer, mute and end.
- **End** from either side; an end summary shows the duration with "Call again" and "Message".
- Every call is logged in the chat ("Missed video call", "Voice call · 3:12") and in the Calls tab.
- A "Number hidden · LandConnect call" chip is on every call screen: no phone number is used or shown anywhere.

## Stack

- **Expo SDK 58**, React Native 0.88 (New Architecture), React 19 with React Compiler, TypeScript strict
- **expo-router** for file-based navigation
- **Supabase** — Postgres with row level security, Auth, Realtime, Storage, Edge Functions
- **LiveKit** — WebRTC media (SFU) for 1:1 calls and multi-party rooms
- **MapLibre** + OpenFreeMap tiles — keyless, fully styleable maps
- Reanimated 4, Gesture Handler, Skia and SVG for motion and code-drawn graphics
- React Query for server state, Zustand for session and call state

## Architecture

```
┌──────────────────────────── React Native app ────────────────────────────┐
│ src/app            routes only (thin)                                    │
│ src/features/*     screens + components per feature                      │
│ src/data/*         typed data API (main path to Supabase)                │
│ src/stores/*       session, call state machine, editor↔map hand-off      │
│ src/ui + src/theme design system: tokens and primitives                  │
└──────────────┬───────────────────────────────┬──────────────────────────┘
               │ HTTPS + websocket             │ WebRTC (SRTP)
        ┌──────▼───────┐                 ┌─────▼──────┐
        │   Supabase   │  mints token    │  LiveKit   │
        │ Postgres+RLS │◄── edge fn ────►│   Cloud    │
        │ Auth Realtime│                 │   (SFU)    │
        │ Storage      │                 └────────────┘
        └──────────────┘
```

### How a call works

1. The caller taps call inside a chat. `start_call` (a Postgres function) checks membership, blocks and the
   callee's "who can call me" setting, then inserts a row in `calls` with status `ringing`.
2. The callee's app is subscribed to `calls` over Supabase Realtime and shows the incoming-call screen.
3. Accept or decline is a status update on that row; both apps follow the row, so either side can end the call.
4. On accept, each app asks the `livekit-token` edge function for a room token. The function runs as the user,
   so row level security decides whether they belong to the call. The LiveKit secret never leaves the server.
5. Both join the LiveKit room and exchange audio/video. Meeting rooms use the same path with more participants.

A call is addressed by conversation, never by phone number. The only identity sent to the other side is the
public display name (or the anonymous handle, if the user turned real names off).

### Roles and privacy

- The role is chosen at sign-up, written by a database trigger, and cannot be changed by the client.
- RLS policies: only sellers and brokers can insert or modify listings, and only their own; buyers browse and save.
- Email and phone live in `profile_private`, readable only by their owner. No other query path can return them.
- Messages, conversations and calls are visible to members only.
- User controls: show real name or anonymous handle, last seen, read receipts, who can call me, block list.
- Sellers can hide a parcel's exact location; other users get a deterministically offset "approximate area".

## Run it

Requires Node 22.13+ (24 recommended) and the Android SDK.

```bash
npm install
cp .env.example .env          # add your Supabase URL and publishable key
npx expo run:android          # builds the dev client and installs it
```

Calls need a real Android device or two (emulator cameras work, the iOS Simulator cannot publish media).

### Backend setup

1. Create a Supabase project and apply `supabase/migrations/*.sql` in order.
2. Create a free LiveKit Cloud project, then set the function secrets and deploy:
   ```bash
   supabase secrets set LIVEKIT_URL=wss://<project>.livekit.cloud LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
   supabase functions deploy livekit-token
   ```
   Alternatively store the three values in Supabase Vault (see `0005_livekit_config_vault.sql`); the function
   falls back to Vault when the secrets are not set.

### Testing calls with one phone

`scripts/call-partner` plays the other side of a call from a laptop (Node 22+):

```bash
node scripts/call-partner/index.mjs                   # signs in as the demo seller and waits; press a / r to accept or reject
node scripts/call-partner/index.mjs --call video      # rings the phone instead
node scripts/call-partner/index.mjs --auto accept     # answers automatically
node scripts/call-partner/index.mjs --media camera    # joins in Chrome with the laptop camera (microphone off)
node scripts/call-partner/index.mjs --media test      # joins in headless Chrome with a test pattern and tone
```

Without `--media`, an accepted call prints a LiveKit Meet link: open it in a browser to talk to the phone with the
laptop's camera and microphone.

### Demo accounts

All use the password `landconnect123`.

| Role | Email |
|---|---|
| Buyer | `buyer@landconnect.demo`, `buyer2@landconnect.demo` |
| Seller | `seller@landconnect.demo`, `seller2@landconnect.demo` |
| Broker | `broker@landconnect.demo`, `broker2@landconnect.demo` |

To demo a call: sign in as the buyer on one device and the seller on another, open their chat, and tap the call button.

## Key decisions

- **Supabase instead of a hand-written FastAPI / Node.js server.** Supabase is PostgreSQL with an auto-generated
  REST API (PostgREST), authentication, realtime and storage. That covered the brief's backend list (REST APIs,
  PostgreSQL, authentication and authorization) without spending the five days on boilerplate, and left the time for
  calling. Custom server logic lives in Postgres functions (`start_call`, `open_direct_conversation`, `create_room`) and
  one TypeScript edge function (`livekit-token`). Authorization is enforced in the database (row level security
  decides which rows, column grants decide which fields), so a modified client cannot bypass it.
- **LiveKit over raw WebRTC.** A hosted SFU removes TURN, reconnection and multi-party mesh problems, and one code
  path serves both 1:1 calls and meeting rooms. Reliability in a live demo mattered more than owning the media layer.
- **Signalling in Postgres.** The `calls` table is the single source of truth for call state. It gives ringing,
  accept, reject and end for free through Realtime, leaves an auditable call log, and lets RLS guard every transition.
- **Security in the database, not the client.** Role checks, membership checks and contact-detail isolation are
  RLS policies and `security definer` functions, so a modified client cannot bypass them.
- **MapLibre over Google Maps.** No API key or billing, full control of map styling, GeoJSON parcels and clustering.
- **A small design system first.** Tokens and primitives were written before any screen so every screen shares
  spacing, radii, shadows, type and motion.

## Development approach

1. **Read the brief and fix the priorities.** Calling is the key requirement, so the call architecture (signalling in
   Postgres, media through LiveKit) was decided on day one and built before the secondary screens.
2. **Schema and security first.** Tables, row level security and Postgres functions were written and tested against
   the live project before any UI, so every screen sat on a backend that already enforced roles and privacy.
3. **A small design system next.** Tokens (colour, spacing, radii, type, motion) and primitives (buttons, cards,
   fields, sheets) came before screens, so the app looks like one product.
4. **Features in vertical slices.** Auth → listings → editor and map → chat → calls → rooms, each finished end to end
   (data API, screen, empty and error states) before the next.
5. **Test on a real phone throughout.** Calls were tested on an Android device against a second client
   (`scripts/call-partner`). Smoothness was measured with `adb shell dumpsys gfxinfo` and fixed screen by screen.
6. **Review and harden.** A final pass went through the call flow from both sides, looking for race conditions, and
   removed unused code.

## Challenges and how they were solved

- **Call state across two phones.** Ringing, accept, reject and end must agree on both devices even when a realtime
  message is lost. The `calls` row is the single source of truth. Each phone follows it over Realtime and also
  re-reads it on a timer and when the app returns to the foreground. Conflicting writes are resolved by re-reading
  the row: for example, the caller's ring timeout and the callee's accept arriving together.
- **Never exposing phone numbers.** Contact details live in a separate `profile_private` table that only the owner can
  read. Calls are addressed by conversation, and the media token carries only a user id and a public name.
- **Testing calls with one device.** I wrote a small Node script that signs in as another demo user, answers or
  places calls, and hands the laptop browser a LiveKit token, so a full two-way call can be tested with one phone.
- **Keeping secrets off the device.** The app never holds the LiveKit secret. An edge function mints a short-lived
  token only for a call that row level security says the user belongs to.
- **Smoothness on a mid-range Android phone.** Debug builds dropped about 35% of frames when opening a listing. Release
  builds, delaying the photos, map and parcel drawing until the screen transition finishes,
  and stopping the 360° preview from spinning forever brought listing scroll down to about 5% janky frames.
- **Maps without API keys or billing.** MapLibre with OpenFreeMap tiles, GeoJSON parcels, and a deterministic offset
  for sellers who hide their exact location.

## Known limits (prototype scope)

- Incoming calls ring while the app is open or backgrounded-but-alive. Ringing a killed app needs push
  (FCM + ConnectionService / CallKit), which is the next step.
- Sign-ups are auto-confirmed (`0002_auto_confirm.sql`) to avoid an email round trip during the demo.
- The anonymous-handle setting is enforced in the UI and in call tokens; a production build would also mask the
  name column server-side through a view.
- "Hide exact location" is applied in the app (other users get a fuzzed point and a 750 m disc, never the
  boundary). The API still returns the true coordinates; a production build would mask them in a database view.
- A busy callee currently shows as "Declined" to the caller (both write the same status).
- "Who can call me" enforces *Nobody*; *My contacts* currently behaves like *Everyone*.
- Blocking prevents new chats and calls, but messages in an already-open chat are not blocked yet.
- Lists are not paginated yet: chats load the latest 80 messages and the feed the first 200 listings.
- No automated tests yet; the call state machine in `call-store.ts` is the first candidate.
- No payments, document vault or KYC — out of scope for this assignment.

## AI tools usage

**Tool:** Claude Code (Anthropic's Claude models), used as a pair programmer in the terminal.

How it contributed:

- **Research.** Checking APIs against the current Expo SDK 58, React Native 0.88, LiveKit and Supabase docs
  instead of relying on outdated examples.
- **Architecture and schema.** Drafting the Postgres schema, row level security policies and the call signalling
  design, which I then reviewed and adjusted.
- **Implementation.** Writing screens and components under a shared brief (`docs/BUILD_BRIEF.md`) so the design
  system stayed consistent, with independent features built in parallel.
- **Review and debugging.** A dedicated review of the call flow found and fixed six race conditions, including the
  ring timeout racing an accept and a double tap placing two calls. It also diagnosed a misconfigured call server
  during device testing.
- **Performance.** Reading frame-time measurements from the device and suggesting fixes, such as staged mounting
  and a release build.

My part: the product and design direction, every design review on the device, deciding what to build and what to
cut, testing on a real phone, and checking each change. Every change was type-checked (`tsc --noEmit`) and tested
against the live backend, and I can walk through any part of the code.

## License

© 2026 Prabhas Raju. **All rights reserved.** This repository is shared only for the LandConnect technical
evaluation. No permission is granted to copy, modify, distribute or use this code or any part of it without
written permission. See [LICENSE](LICENSE).

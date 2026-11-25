# LandConnect — build brief (master prompt)

Paste this whole file into any coding agent to give it full context on the project.

## 1. The job

Technical assignment for **LandConnect** (landconnect.si), due **Wed 25 Nov 2026, 11:59 PM IST**.
Build a functional prototype of a **land marketplace mobile app** with a clean, WhatsApp-inspired UI.

Required features:

1. Sign up / log in with three roles — **Buyer, Seller, Broker** — and role-based permissions.
2. **Community page** where buyers explore land listings (images, description, price, location).
3. Sellers and brokers **create, edit, manage** listings: images, description, pricing, location.
4. **Maps and geotagging**: show land on a map, pick a location when listing.
5. **Chat** between users, plus basic **meeting rooms**.
6. **In-app audio and video calling — the key requirement.** Initiate, receive, accept, reject, end.
   No personal phone numbers are ever shared.
7. **Privacy and access control**: role-based permissions, basic privacy controls, no exposed contact details.

Evaluated on: functional completeness, code organisation, UI/UX, and above all working calls.
Deliverables: GitHub repo, working APK, demo video, technical write-up, AI-tools summary.

## 2. Who LandConnect is (use this to look domain-aware)

- Confidential land platform for **Bengaluru and Karnataka**. Tone: calm, discreet, institutional. No hype.
- Site tagline: "Acquire Land with Confidence." and "Discretion is designed in, not bolted on."
- Brand: forest `#10201C`, green `#0F6E56`, mint `#5DCAA5`, amber `#EF9F27`, pale mint `#E8F1ED`. Typeface: Geist (UI) and Geist Mono (labels, figures), only via `tokens.ts`.
- Their model: anonymous participant IDs, approximate location until trust is established, verified badges.
- Indian land conventions: **acres / guntas (40 guntas = 1 acre) / cents**, prices in **lakh and crore**
  ("₹2.4 Cr", "₹48 L / acre"), documents **RTC/Pahani, EC, Mutation, Khata, survey sketch, DC conversion**,
  survey numbers. Real places: Devanahalli, Doddaballapura, Hoskote, Kanakapura, Nelamangala, Sarjapur, Anekal, Ramanagara.

## 3. Stack (already installed — do not add or upgrade packages)

- **Expo SDK 58**, React Native 0.88, React 19.3, TypeScript, **New Architecture**, **React Compiler on**.
- Routing: **expo-router** (`src/app`). `Stack` from `expo-router`, `Tabs` from `expo-router/js-tabs`.
- Backend: **Supabase** (Postgres + RLS, Auth, Realtime, Storage, Edge Functions). Schema: `supabase/migrations/0001_init.sql`.
- Calls: **LiveKit** (`@livekit/react-native` 3.2, `livekit-client` 2.25). Signalling = `calls` table over Supabase Realtime.
- Maps: **MapLibre** (`@maplibre/maplibre-react-native` v11 — `Map`, `Camera`, `GeoJSONSource`, `Layer`, `ViewAnnotation`; old v10 names do not exist).
  Free keyless style: `https://tiles.openfreemap.org/styles/positron`.
- Animation: `react-native-reanimated` 4, `react-native-gesture-handler` 3, `@shopify/react-native-skia` 2, `react-native-svg`.
- Also: `@tanstack/react-query`, `zustand`, `expo-image`, `expo-image-picker`, `expo-location`, `expo-haptics`,
  `expo-linear-gradient`, `expo-blur`, `expo-audio`, `@shopify/flash-list` v2, `react-native-keyboard-controller`, `lucide-react-native`.
- Node 24 is required: prefix shell commands with `export PATH="$HOME/.nvm/versions/node/v24.22.3/bin:$PATH"`.
- APIs change between SDKs. **Read the installed typings in `node_modules` before using a library API** rather than trusting memory.

## 4. What already exists (read these first, reuse, do not rewrite)

| Path | What |
|---|---|
| `src/theme/tokens.ts` | colours, 4pt `space`, `radius`, two-layer `shadow`, `type` scale, `spring`, `stagger` |
| `src/ui/*` | `Text`/`Label`, `PressableScale`, `Button`, `IconButton`, `Card`/`Divider`, `Segmented`, `Chip`, `Avatar`, `Field`, `Enter`, `ProgressSegments`, `Screen`/`Header`/`LargeTitle`/`useScreenInsets`, `FloatingTabBar` |
| `src/lib/types.ts` | all domain types and option lists |
| `src/lib/format.ts` | price (L/Cr), area, time, presence, duration, `publicName`, `polygonAcres`, `fuzzLocation` |
| `src/lib/supabase.ts` | client, `isBackendConfigured`, `errorMessage` |
| `src/stores/session.ts` | `useSession` (auth + own profile), `canManageListings`, `currentUserId` |
| `src/stores/listing-draft.ts` | hand-off between listing editor and map picker |
| `src/data/{listings,chat,calls,profiles}.ts`, `src/data/keys.ts` | the whole data API + React Query keys |
| `src/features/calls/actions.ts` | `placeCall(conversationId, kind)`, `joinRoom(conversationId)` |
| `src/app/_layout.tsx`, `src/app/(app)/_layout.tsx`, `src/app/(app)/(tabs)/_layout.tsx` | navigation shell |

Routes: `(auth)/welcome|sign-in|sign-up`, `(app)/(tabs)/index|map|chats|land|profile`, `(app)/listing/[id]`,
`(app)/listing/edit` (`?id=` to edit), `(app)/listing/pick-location`, `(app)/chat/[id]`, `(app)/room/new`, `(app)/room/[id]`,
`(app)/user/[id]`, `(app)/privacy`, `(app)/blocked`, `(app)/call/[id]`.

## 5. Design direction

Reference bar: the craft of Rehan Ahmed (@rehanxahmed, deslopify.studio). **Not** his layouts or style — his obsessive detail:
custom illustrated "smart graphics", soft floating surfaces, one calm system across every screen.
Structure is WhatsApp-familiar (chat list, bubbles, call screens); the finish is premium.

Rules — every screen must pass all of them:

1. Every spacing, radius, colour, shadow and font comes from `tokens.ts`. No stray numbers, no new colours.
2. One canvas (`colors.canvas`). Cards are white on it. No borders on cards; depth is the tinted two-layer shadow.
3. Nested radii: inner radius = outer radius − padding. Always `borderCurve: 'continuous'`.
4. At most four text sizes on a screen; one dominant element. Hierarchy from weight and tone, not size.
5. All numbers tabular (`type.figure*`). Micro-labels are `Label` (sans semibold, uppercase, tracked); mono is only for code-like strings such as handles.
6. One accent (green). Amber only for highlight/state. Red only for destructive/decline.
7. One icon family (lucide), stroke 1.9–2.3, optically matched to the text beside it.
8. Touch targets ≥ 44pt. Everything tappable uses `PressableScale` (spring to 0.97 + haptic).
9. Entrances stagger with `Enter` (50 ms steps, capped). Springs do not bounce unless celebrating.
10. Animate only `transform` and `opacity`. Scroll-linked motion uses shared values, never `useState`.
11. Segmented controls and tab highlights slide; nothing snaps.
12. Hero graphics bleed to the edges and fade into the canvas with a gradient — never sit in a visible box.
13. **Smart graphics are drawn in code** (Skia or react-native-svg): isometric land parcels, contour lines, survey grids,
    parcel outlines, compass roses, route lines. They must be real, data-driven where possible, and subtly animated.
14. Every screen has designed loading (skeletons with matching radii), empty, and error states.
15. Progress is segmented (`ProgressSegments`), not a plain bar.
16. Copy is calm and specific. Sentence case. No exclamation marks, no emoji, no lorem ipsum, no "Oops".
17. Lists use FlashList. Images use `expo-image` with a transition. Never `{value && <X/>}` with a possibly-falsy non-boolean.
18. With React Compiler on, read and write shared values with `.get()` / `.set()`.
19. Respect safe areas with `useScreenInsets`; tab screens pass `{ tabBar: true }` so content clears the floating bar.
20. Privacy is visible in the UI: show `publicName(profile)` everywhere, never an email or phone number.

## 6. Engineering rules

- TypeScript strict. Run `npx tsc --noEmit` and fix every error in files you own before finishing.
- Feature code lives in `src/features/<feature>/`; route files in `src/app` stay thin.
- Use React Query for reads (`qk` keys) and invalidate the right keys after writes. Subscribe to realtime where the data API offers it.
- Do not edit files outside your assignment. If a shared file needs a change, say so in your report instead.
- Never create or edit `android/` or `ios/` by hand.
- Comments explain why, not what.

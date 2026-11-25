# Calls

1:1 audio/video calls and meeting-room sessions. No phone numbers: a call is addressed by
conversation, and the LiveKit token carries only the user's public name.

## Pieces

| File | Role |
|---|---|
| `signal.ts` | Signalling on the `calls` table: compare-and-set transitions, a row follower (realtime + re-read on subscribe / foreground / 4 s poll), ring listener with cold-open catch-up. |
| `media.ts` | Permissions, the native audio session (ref-counted), one LiveKit `Room` per call, camera flip, speaker routing. |
| `call-store.ts` | The state machine (zustand). Owns the active call, its follower, timers and media. |
| `tones.ts` | Ringtone / ringback (WAVs synthesised by `scripts/generate-call-tones.mjs`) + ring vibration. |
| `call-host.tsx` | Root listener + full-screen incoming overlay (native `Modal`, above the router stack) + the in-call bar. |
| `call-bar.tsx` | Floating in-call bar shown over every screen while a call is minimized. |
| `actions.ts` | `placeCall` / `joinRoom` (refuse while another call is up, offer to return to it), `redial`, `openActiveCall`. |
| `call-screen.tsx` | Route shell: opens the call, picks the view for the phase, minimize / close / summary actions. |
| `ui/direct-call.tsx`, `ui/room-call.tsx` | Live 1:1 (audio stage ↔ video stage) and meeting-room views. |
| `ui/live-header.tsx` | Minimize button, privacy chip, signal bars, reconnecting / weak-link notice. |
| `ui/*` (rest) | Controls, PiP video stage, incoming + quick replies, end summary, shared primitives. Decide nothing. |

## Sequence (1:1)

```
Caller                       calls row                Callee (CallHost)
placeCall → start_call RPC → INSERT ringing  ──realtime──▶ ringIn(): phase incoming, ringtone
/call/[id] → openCall(): outgoing, ringback               Accept → CAS ringing→accepted
            ◀──realtime UPDATE accepted──                  navigate /call/[id], enterConnecting()
enterConnecting(): permissions → audio session → livekit-token(callId) → Room.connect → mic (+camera)
              both sides join LiveKit room `call-<uuid>`; media flows; phase connected
hangUp(): CAS accepted→ended ──realtime──▶ other side finish('ended'); caller posts the chat log
```

Rooms: the row has `callee_id = null`, starts `accepted`, room `room-<conversationId>`. Anyone in
the conversation joins via `/call/[id]`. Leaving never ends it for others; the last one out
marks the row `ended`. A later join simply creates a new row for the same LiveKit room.

## State machine

```
idle → incoming → connecting → connected → ended → idle
idle → outgoing → connecting ↗        (incoming that ends → idle: the overlay just vanishes)
```

`finish()` is the only way into `ended`; it is idempotent and tears down follower, timers and
media (mic, camera, audio session). Ringtone, ringback and keep-awake are derived from `phase`.

## Features

- **Minimize**: the chevron (or Android back) on a live call sets `minimized` and pops the screen;
  media lives in the store, so it keeps running. `call-bar.tsx` floats above every screen (avatar,
  name, signal, live timer, mute, end; drag to the top or bottom edge). Tap pushes `/call/[id]`
  again; `registerCallScreen` clears `minimized`, and `openCall` reuses the active call. Unmounting
  a screen hangs up only when the call was *not* minimized. If the call ends while minimized, the
  bar shows the outcome and the store dismisses it after `END_BAR_MS`.
- **Link state**: `media.ts` forwards LiveKit `Reconnecting` / `SignalReconnecting` / `Reconnected`
  and `ConnectionQualityChanged` into the store (`reconnecting`, `quality`, `peerQuality`). The UI
  shows signal bars, "Reconnecting…", and whose connection is weak.
- **Peer state**: audio stage — speaking halo driven by the remote voice level (UI thread), "Muted"
  chip. Video stage — a peer with the camera off is their avatar (with the halo) in the same slot.
- **Audio ↔ video**: the Camera control exists on audio calls; publishing a camera on either side
  switches both phones to the video stage (and turns the speaker on locally); both cameras off
  hands back to the audio stage. No signalling needed: it follows the LiveKit tracks.
- **PiP**: draggable self-view, velocity-projected snap to a corner on a critically damped spring;
  tap swaps main and PiP.
- **Decline with a message**: the ringing screen offers `QUICK_REPLIES`; picking one declines and
  posts the text into the conversation with `sendMessage` (the caller still posts the call log).
- **End summary**: 1:1 calls show the outcome, the duration, and "Call again" (`redial` replaces
  the finished screen with the new call) / "Message" (`router.dismissTo` the chat). It closes back
  to the chat by itself after 5 s.
- **Privacy**: every call surface carries "Number hidden · LandConnect call".

## Races handled

- **Accept vs cancel / both hang up**: every write is `update … where status in (from)`, so one
  side wins; the loser re-reads the row and shows the real outcome.
- **Hang up mid-connect / unmount**: each async step checks a generation counter and
  `CallMedia.dispose()` state, so nothing starts after teardown.
- **Second incoming call**: auto-rejected (busy) while anything is live, minimized or not.
- **Starting a call while one is minimized**: `placeCall` / `joinRoom` refuse and offer to return.
- **Missed websocket frames**: the follower re-reads the row; both sides time out a ring at 40 s.
- **Peer vanishes**: a 1:1 ends when the remote leaves LiveKit, or if they never join within 30 s.
- **Already-finished call opened**: shows how it ended, then goes back.
- **StrictMode / Fast Refresh**: per-subscription channel topics; screen unmount handling is
  ref-counted and deferred one tick.

## Limits

No ringing while the app is killed or backgrounded for long (needs FCM / VoIP push + CallKit /
ConnectionService). A declined ring and a busy auto-reject both write `rejected`, so the caller
sees "Declined" for both. The server has no stale-call sweeper; a crashed client leaves its row
until the 40 s ring timeout on the other side, or until the next `start_call` in that chat.

---
tags: [cardly, spec]
date: 2026-09-28
status: draft
---

# Cardly — Spec and Phase Plan

Online multiplayer web app for two Portuguese card games, **Sueca** and **Gringo**, played with friends in private rooms.

Full rule sources: [docs/rules/sueca.md](rules/sueca.md), [docs/rules/gringo.md](rules/gringo.md).
This spec records the decisions and clarifications on top of those files. Where they differ, this spec wins.

---

## 1. Objective

- Friends create a private room, share an invite code/link, pick a game, and play in real time.
- Server is authoritative: it shuffles, validates every action, owns all state.
- Each client receives only what that player is allowed to see.
- Players survive refresh / network drops (reconnection).
- Later: login and match history via Supabase.

Non-goals (v1): public matchmaking, spectators, chat during active hands, cumulative Gringo scoring.

## 2. Users and language

- UI in Portuguese (Portugal). Code, identifiers, and docs in English.
- Mobile-first (portrait phone), also tablet and desktop.

## 3. Tech stack

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces |
| Game engine | `packages/engine` — pure TypeScript, no I/O, Vitest tests |
| Protocol | `packages/protocol` — shared event names, payload types, error codes |
| Server | `apps/server` — Cloudflare Worker + one Durable Object per room (`partyserver`), state saved to Durable Object storage |
| Web | `apps/web` — React + TypeScript + Vite, `partysocket` client (auto-reconnect), hosted on Vercel |
| Auth / history (phase 3) | Supabase Auth + Postgres; server verifies Supabase JWT |

Realtime backend decision: see section 9.

## 4. Architecture

```
apps/web  ──WebSocket──►  Room Durable Object  ──uses──►  packages/engine (pure rules)
   │                          │
   └── Supabase Auth (ph.3)   └── Supabase Postgres: write results (ph.3)
```

- Engine = pure functions `(state, action) -> { state, events } | error`. No randomness inside; shuffle takes an injected RNG so tests are deterministic.
- Each room is one Durable Object holding one engine state. A Durable Object handles one message at a time, so races (e.g. two Gringo match-discards) resolve by server arrival order.
- After every accepted action the state is written to Durable Object storage, so it survives eviction and restarts.
- Server builds a **per-player view** (`publicState + ownPrivateState`) for every broadcast and reconnect. The full state never leaves the server.
- Sueca actions carry the game `version`; stale actions are rejected. Gringo actions name stable slot ids (a slot keeps its id while cards swap in and out of it), and the time-critical ones (match, claim ability) carry the discard event id they answer, so a late one is rejected without blocking unrelated moves.
- Timers (turn timer, ability window) live on the server only, via the Durable Object Alarms API. One alarm per object, so the room stores all deadlines and sets the alarm to the earliest one.

### Rooms

- Host creates room, gets 6-character code + link `/sala/<CODE>`.
- Host picks game (Sueca or Gringo) and game settings in the lobby. Settings lock at start.
- Players pick a nickname (phase 1–2), later tied to login (phase 3).
- Ready check; only host starts.
- Sueca needs exactly 4 players. Gringo needs 3–6.
- The host can remove players in the lobby.
- Any player can leave the table mid-match. The game pauses (all timers stop) and the host chooses: put a bot in each empty seat and continue, or end the match and return everyone to the lobby. Leaving is final. Bots play legal cards with a simple heuristic (cheapest winning card, feed a winning partner when playing last) after a short delay, and stay seated in the lobby until kicked.

### Reconnection

- On join, server issues a `sessionToken` stored in `localStorage`.
- On reconnect, the token restores the same seat and sends a fresh per-player view.
- Disconnected players keep their seat; indicator shown to others.
- Turn timer keeps running while disconnected; on expiry, auto-play happens (so the table never stalls).
- After 20 minutes with no action (and no running timer), the server closes the room's connections so the Durable Object can be evicted; the client shows "Mesa em pausa" with a button to reconnect. Finished or abandoned rooms are deleted after 24h of inactivity.
- WebSocket Hibernation is off. In local testing it made each message cost ~90ms and a burst of messages froze the Worker. The idle close above bounds compute time instead (a forgotten tab costs at most ~150 GB-s of the 13,000 GB-s daily free allowance).
- Each connection is limited to 15 messages per second; rejected actions do not write to storage.

## 5. Sueca — rules as implemented

Everything in [rules/sueca.md](rules/sueca.md), including: 40-card deck, A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2, points A11 7=10 K4 J3 Q2, forced follow-suit, trump optional, teams on opposite seats, counter-clockwise play, trump = last card of shuffled deck given to dealer, riscos 1 / 2 / 4 (capote at 120 points), bandeira tracked separately, 60–60 rule configurable, match target 3 / 4 / 7 (default 4), no in-hand chat, no signaling features.

Clarifications:

- **Turn timer**: 30s default. On expiry the server auto-plays the **lowest-point legal card** (tie: weakest by Sueca strength).
- **Renúncia**: disabled. Illegal cards are not selectable and the server rejects them, so renúncia cannot happen.

## 6. Gringo — rules as implemented

### Setup
- Deck: 52 cards + 2 Jokers = 54 cards.
- Players: 3–6. Play goes right (counter-clockwise).
- Each player gets 4 face-down cards.
- **Peek phase**: each player picks 2 of their own 4 cards to see. Only they see them. 30s timer; on expiry the server picks 2 at random.
- First player: random in the first round, then rotates to the right each round.
- The discard pile starts empty. The first player draws and makes their choice.

### Card values
A = 1, 2–10 = face value, J = 13, Q = 13, black K = 13, **red K = −2**, Joker = 0.

### Normal turn
1. Active player draws one card. Only they see it.
2. Then either:
   - **Discard** the drawn card face-up. If it is a Queen, Jack or black King, they may use its ability (section below) instead of a plain discard.
   - **Swap** it with one of their own cards (known or unknown). The drawn card goes into that slot and they know it. The replaced card goes face-up to the discard pile. If the replaced card is a Queen, Jack or black King, the player may use its ability (whether the card was dealt or received through a swap).
3. Turn passes right.

### Matching discard
- Every card that lands on top of the discard pile opens a **discard event**.
- Any player may place a matching card on top, even outside their turn, once per discard event.
- **Match rule**: same rank, any suit. Exceptions: a red King matches only a red King and a black King only a black King. Joker matches Joker. Queens match any Queen.
- The player does **not** receive a replacement card, so they may have fewer than 4 cards.
- A player who reaches **0 cards wins immediately**; round ends and all cards are revealed.
- Races: first valid action to reach the server wins; the rest are rejected with "Outro jogador foi mais rápido."
- **Wrong match**: the attempted card is revealed to everyone, returns to its slot (now known to all players), and the player draws a penalty card from the pile face-down, which they do not see.

### Ability window
- If the card on top is a Queen, Jack or black King placed via matching, the player who placed it owns its ability.
- To stop auto-clicked draws from stealing that chance, after **every** discard the next player's draw is **locked for 3 seconds** (configurable). Everyone sees a short countdown.
- During that window, the ability owner sees a **"Usar habilidade"** button. Clicking it pauses play until the ability resolves (with its own 30s timer). Not clicking before the window closes forfeits the ability.

### Abilities
- **Queen**: pick one of your own cards; only you see it. Queen goes to discard.
- **Jack**: blind swap: one of your cards with one card of any other player. Nothing is revealed.
- **Black King**: pick one of your cards and one card of another player. You see their card, then choose **Trocar** or **Ficar com a minha**. On swap, the other player learns the card they received.
- **Red King**, Joker, and number cards: no ability.
- Knowing you hold a special card never grants its ability while it stays in your hand. Abilities come only from drawing it, match-placing it, or swapping it out for a drawn card.

### Calling Gringo
- Any player may call Gringo **at any time**, once per round (one caller per round). Confirmation dialog required.
- Play continues normally from where it is. The round ends when the turn would pass to the caller. The caller gets no further turn.
- After calling, the caller can still match-discard and can still be targeted by Jack / black King.
- If the draw pile runs out at any point, the round ends immediately.

### End of round
- All remaining cards revealed. Totals calculated. Lowest total wins; ties shown as ties. A player who emptied their hand wins outright.
- Rounds are standalone. No cumulative score, no target.

### Timers
- Turn timer 60s by default; host picks 30, 45, 60, 90 or no limit. The same length applies to the peek and to finishing a claimed ability.
- Turn expiry: draw (if not drawn) and discard the drawn card, no ability, no swap.
- Peek expiry: 2 random cards for whoever has not picked.
- Pending ability on expiry: cancelled (Black King: declined).
- The draw lock after a discard is 3s by default (host picks 2, 3 or 5). A turn's timer starts when the lock ends; a match that reopens the lock mid-turn leaves the player at least 5s after it.
- Round result stays 30s, then the next round deals. Everyone pressing "Próxima ronda" deals it early; the host can instead return everyone to the lobby.

### Implementation decisions
- **Knowledge follows the card.** Whoever knew a card still knows it after a Jack or black King moves it (everyone sees which slots are swapped). A received card is unknown unless the receiver already knew it.
- **Black King declined:** the user does not keep the viewed card as known.
- **Calling Gringo on your own turn before drawing** counts as your turn; play passes right. Called at any other moment, the current turn finishes normally.
- **End checks** (Gringo cycle back to the caller, empty draw pile) happen when the player on turn could next draw: after the draw lock closes and no ability is pending. So the last discard still gets its match window and ability.
- **Wrong match with an empty pile:** no penalty card; the round then ends at the next draw point.
- **Matching is blocked while an ability is being resolved**, so the chosen slots cannot change under it.
- **Match attempts count once per player per discard event**, right or wrong.
- **Leaving:** any leave while a Gringo game is running pauses it (rounds never end the game by themselves). Bots peek at once, draw, swap into their worst known card if the drawn card is lower, take a low card (≤ 4) into an unknown slot, otherwise discard. Bots never match, use abilities or call Gringo.

### Knowledge tracking
Each card carries `knownTo: playerId[]`. Updated on peek, draw, swap, Queen, Jack, black King, wrong match, and every move. It drives bots only.

**Cards are seen once.** Views never show a hand card face during play. A peek, a Queen, a wrong match (everyone) and the card received from a black King swap are sent as a one-time `glimpse` in the state right after that action; the client shows it for 5 seconds, then the card is face down again and the player must remember it. The drawn card stays visible to its holder until it is discarded or swapped in. Everything is revealed at the end of the round.

**Only the last play is visible**, in both games. Gringo sends only the latest log entry; Sueca sends only the last finished round of cards ("Última ronda") plus who played the trump card.

## 7. UI direction

- Feel: **Portuguese café card table**. Warm, lived-in, not a casino. Materials: worn green felt or marble tabletop, dark wood rim, cream card stock, azulejo-blue accents, espresso-brown text.
- Readable cards: big rank + suit corners, suit also shown by shape (not color only). Four-color suits as an option.
- Mobile portrait first: own hand at bottom, large tap targets, no drag-and-drop, tap to select, tap again or button to confirm.
- Restraint: subtle card motion, no glow/gradient overload, no generic dashboard look.
- Accessibility: keyboard play, visible focus, screen-reader labels, trump and turn stated in text.
- A design pass (typography, palette, card face) happens at the start of the UI work in phase 1, before components.

## 8. Phase plan

### Phase 1 — Sueca online (done)
1. Monorepo scaffold, lint, typecheck, Vitest. → verify: `npm test` and `npm run typecheck` green.
2. Sueca engine + all tests from rules §46, §68, §69. → verify: tests pass.
3. Server: rooms, invite code, lobby, seats/teams, ready, host start, per-player views, error codes. → verify: room-logic tests in Node plus scripted runs against `wrangler dev` with 4 WebSocket clients; no client ever receives another hand.
4. Timer + auto-play, reconnection. → verify: tests for timeout and reconnect payload.
5. Web: landing, create/join, lobby, table, hand/trick/match screens, rules modal. → verify: 4 browser tabs play a full match.

### Phase 2 — Gringo + game choice (done)
1. Gringo engine + knowledge model + tests from rules §33. → verify: tests pass, including leak tests on per-player views.
2. Server: discard events, match races, ability window, Gringo call flow. → verify: race and stale-action tests.
3. Lobby game selector; Gringo table UI. → verify: 3–6 tabs play full rounds.

### Phase 3 — Supabase login + history
1. Supabase project, Google Auth, guest (nickname-only) play still allowed, `profiles`, `matches`, `match_players` tables with RLS. → verify: RLS tests.
2. Server verifies Supabase JWT on connect; writes finished Sueca matches and Gringo rounds. → verify: rows written after a game.
3. Web: login, profile, history page. → verify: history visible after playing.

Implementation decisions:
- Login is optional. The access token is sent only with a new `HELLO`; a reconnect by session token keeps the user already linked to the seat. An invalid token is rejected with `AUTH_FAILED` instead of silently joining as a guest.
- The Worker verifies tokens locally against `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (issuer and `authenticated` audience checked).
- One `matches` row per finished Sueca match or finished Gringo round, with one `match_players` row per seat (name at the time, user id for signed-in players, bots flagged). Sueca score = team riscos; Gringo score = card total.
- Nothing is saved when no signed-in player sat at the table: nobody could read it.
- Only the `record_match` function (granted to `service_role` only) writes. Clients read their own games and their table mates' rows through RLS; they cannot write anything.
- The history write runs after the game state is saved and never blocks or fails the game.
- "Profile" = the Google name and a history page. No editable profile yet.

## 9. Realtime backend decision

Hard constraint: **zero cost**, no credit card.

**Decision: Cloudflare Workers Free plan + Durable Objects**, with `partyserver` on the server and `partysocket` on the client. Supabase only for Google login and history. Web on Vercel.

| Option | Verdict |
|---|---|
| Cloudflare Durable Objects | Free, no card, no sleep during play. One object per room = serialized actions, alarms for timers, state persisted. |
| Supabase Realtime + functions | Workable but worse: every action is a function call + DB write with locking (~100–300ms), timers need polling or client-triggered checks, private channels per player, rules split across functions and SQL. Free project pauses after ~1 week unused. |
| Node + Socket.IO on Render free | Sleeps after 15 min without messages, 50–60s cold start. |
| Node on Koyeb free | Possible fallback. Not verified in depth. |
| Fly.io, Railway | Not free. |

Free-plan limits for Durable Objects (re-check at deploy time): 100,000 requests/day, 13,000 GB-s/day, 5 GB SQLite storage, 100,000 row writes/day. Incoming WebSocket messages count 20:1 as requests; outgoing messages are free. Without hibernation, a room uses duration while sockets are open (about 0.125 GB × seconds); a 4-hour evening is about 1,800 GB-s. A Sueca hand is about 40 actions, so requests and writes stay well under 1% of the daily limits; duration for a 4-hour evening is about 14%.

Sources: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [cloudflare/partykit](https://github.com/cloudflare/partykit), [Render free](https://render.com/docs/free), [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts).

## 10. Open questions

None open. Waiting for approval.

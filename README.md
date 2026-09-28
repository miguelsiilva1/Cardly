# Cardly

Online multiplayer Portuguese card games for friends in private rooms. **Sueca** and **Gringo** are playable; the host picks the game in the lobby. Login and match history follow (see [docs/SPEC.md](docs/SPEC.md)).

## Layout

```
packages/engine     Pure TypeScript rules (no I/O). Sueca and Gringo engines, per-player views, tests.
packages/protocol   Message types, error codes and constants shared by server and web.
apps/server         Cloudflare Worker. One Durable Object per room (partyserver), WebSockets.
apps/web            React + Vite client (Portuguese UI).
docs/               Spec, phase plan and the full rule sources.
```

## How it works

- The server is authoritative. It shuffles, deals, validates every action and owns all state.
- Each room is one Durable Object. It handles one message at a time, so simultaneous actions resolve in arrival order.
- Every broadcast is built per player (`stateFor` → `viewFor`): public state plus that player's own hand. In Gringo every hand card stays face down; a card a player may look at is sent once and shown for a few seconds, so players must remember their cards. Only the last play is visible in either game. Hidden cards, the draw pile and the reconnect token never leave the server.
- Sueca actions carry the state `version`; Gringo match and ability actions carry the discard event they answer. Stale or duplicate actions are rejected, so two players racing to match the same card resolve in arrival order.
- Timers run on the server through the Durable Object alarm: turn auto-play (Sueca: lowest-point legal card; Gringo: draw and discard), the Gringo draw lock after each discard, and the delay before the next hand or round.
- Room state is saved to Durable Object storage after every change, so games survive eviction and restarts.
- After 20 minutes without any action, the server closes the room's connections so it stops using free-plan compute time; players tap "Voltar à mesa" to reconnect. Idle rooms are deleted after 24 hours.
- Each connection may send at most 15 messages per second.
- A player can leave mid-match; the game pauses and the host either puts a bot in the seat or ends the match.
- Reconnection: on joining, the player gets a token stored in `localStorage`. Refreshing the page sends it back and restores the same seat and hand.

## Requirements

- Node.js 24+
- npm 12+

## Local development

```sh
npm install
```

Terminal 1, game server on http://127.0.0.1:8787:

```sh
npm run dev -w @cardly/server
```

Terminal 2, web app on http://localhost:5173:

```sh
cp apps/web/.env.example apps/web/.env.local   # first time only
npm run dev -w @cardly/web
```

Open http://localhost:5173, create a room and open the invite link in three more tabs or browsers (each tab of the same browser shares `localStorage`, so use private windows or other browsers to get separate players).

## Tests

```sh
npm test            # engine + server room logic
npm run typecheck   # all packages
```

- `packages/engine/src/sueca/sueca.test.ts`: deck, ranking, points, trump, follow suit, trick winner, scoring (61/90/91/119/120), capote, bandeira, 60–60 rules, match end, full random matches, view leak checks.
- `apps/server/src/room.test.ts`: lobby, host rules, start locking, stale actions, hidden-hand leak checks, reconnect, timers, message parsing.

## Environment variables

| Where | Name | Meaning |
|---|---|---|
| `apps/web/.env.local` | `VITE_SERVER_URL` | Origin of the game server, e.g. `https://cardly-server.<account>.workers.dev` |
| `apps/server/wrangler.jsonc` | `ALLOWED_ORIGINS` | Comma-separated web origins allowed to create rooms (CORS) |

## Deployment (free tiers)

### Game server: Cloudflare Workers

1. Create a free Cloudflare account (no card needed).
2. In `apps/server/wrangler.jsonc`, set `ALLOWED_ORIGINS` to your Vercel URL, e.g. `https://cardly.vercel.app`.
3. Deploy:

   ```sh
   cd apps/server
   npx wrangler login
   npx wrangler deploy
   ```

4. Note the `*.workers.dev` URL it prints.

### Web: Vercel

1. Import the repository in Vercel.
2. Root directory: `apps/web`. Framework: Vite. Build command `npm run build`, output `dist`. Install command: `npm install` (run from the repository root so workspaces resolve; set "Include files outside the root directory" on).
3. Environment variable `VITE_SERVER_URL` = the Worker URL from above.
4. `apps/web/vercel.json` rewrites all paths to `index.html` so `/sala/<code>` links work.

## Sueca rules implemented

Full rules: [docs/rules/sueca.md](docs/rules/sueca.md). Summary: 40 cards, 4 players in 2 teams sitting opposite, 10 cards each, A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2, points A 11, 7 10, K 4, J 3, Q 2. The last card of the shuffled deck is trump and belongs to the dealer. Follow suit if you can; otherwise any card, trump optional. 61–90 = 1 risco, 91–119 = 2, 120 = capote (4). Bandeira (all 10 tricks) is tracked separately. 60–60 rule, match target (3/4/7), capote rule and turn timer are set by the host in the lobby and locked at start. Play goes counter-clockwise.

## Gringo rules implemented

Full rules: [docs/rules/gringo.md](docs/rules/gringo.md); decisions on top of them in [docs/SPEC.md](docs/SPEC.md) section 6. Summary: 3 to 6 players, 52 cards + 2 Jokers, 4 face-down cards each, everyone picks 2 to look at. On your turn draw, then discard it or swap it into one of your slots. Anyone may match the top discard at any time (same rank, Kings by colour, Jokers together); a wrong match is shown to all and costs an unseen penalty card; emptying your hand wins at once. A Queen, Jack or black King that you discard gives its ability (look at your card, blind swap, look and decide to swap); after every discard the next draw is locked for a few seconds so the owner can press "Usar habilidade". Calling Gringo gives everyone else one more turn. A 1, 2–10 face value, J/Q/black K 13, red K −2, Joker 0; lowest total wins, ties stay ties. Rounds are standalone.

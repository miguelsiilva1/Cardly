# Cardly

Online multiplayer Portuguese card games for friends in private rooms. Phase 1 ships **Sueca**; Gringo, login and match history follow (see [docs/SPEC.md](docs/SPEC.md)).

## Layout

```
packages/engine     Pure TypeScript rules (no I/O). Sueca engine + per-player views + tests.
packages/protocol   Message types, error codes and constants shared by server and web.
apps/server         Cloudflare Worker. One Durable Object per room (partyserver), WebSockets.
apps/web            React + Vite client (Portuguese UI).
docs/               Spec, phase plan and the full rule sources.
```

## How it works

- The server is authoritative. It shuffles, deals, validates every action and owns all state.
- Each room is one Durable Object. It handles one message at a time, so simultaneous actions resolve in arrival order.
- Every broadcast is built per player (`stateFor` → `viewFor`): public state plus that player's own hand. Other hands and the reconnect token never leave the server.
- Every game action carries the state `version`; stale or duplicate actions are rejected.
- Timers run on the server through the Durable Object alarm: turn auto-play (lowest-point legal card) and the delay before the next hand.
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

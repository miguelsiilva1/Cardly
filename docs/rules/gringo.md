# Gringo — Claude Code Implementation Prompt

## 1. Goal

Build a complete multiplayer web implementation of the card game **Gringo** for playing with friends online.

The implementation must be server-authoritative, real-time, and resistant to information leaks. The most important rule is that cards are hidden information: players must only see cards they are explicitly allowed to see.

Do not invent additional Gringo rules. The rules in this document are the source of truth.

The game supports multiple players, with turns moving to the right (counter-clockwise).

---

## 2. Initial Setup

Each player receives exactly **4 cards**, all face down.

At the beginning of the game:
- Every player's 4 cards are hidden.
- Every player may look at exactly 2 of their own cards.
- The other 2 remain unknown.
- No player may see another player's cards.

A player does **not** have to maintain exactly 4 cards throughout the round.

A player can have fewer than 4 cards because of the matching-discard mechanic described below. When a player places a matching card directly onto the top of the discard pile, they do **not** draw or receive a replacement card.

Therefore, the number of cards a player owns can decrease during the round.

If a player reaches **0 cards**, that player wins the round immediately and the round ends.

The server must track card knowledge explicitly. The client must only receive information that the current player is entitled to know.

---

## 3. Objective

The objective is to finish the round with the **lowest possible number of points**.

When the round ends:
1. All players' 4 cards are revealed.
2. Every player's total is calculated.
3. The player(s) with the lowest total win the round.
4. Ties must be displayed as ties, not resolved arbitrarily.

---

## 4. Card Values

| Card | Value |
|---|---:|
| Ace | 1 |
| 2 | 2 |
| 3 | 3 |
| 4 | 4 |
| 5 | 5 |
| 6 | 6 |
| 7 | 7 |
| 8 | 8 |
| 9 | 9 |
| 10 | 10 |
| Jack | 13 |
| Queen | 13 |
| Black King | 13 |
| Red King | -2 |
| Joker | 0 |

The goal is to have as few points as possible.

Important:
- All face cards are worth 13 points if they remain in the player's cards at the final count, **except red Kings**.
- Red Kings are worth **-2 points** each at the final count.
- A red King has no special ability.
- Black Kings are worth 13 points at the final count.
- Jacks and Queens are worth 13 points at the final count.
- A Queen that is used for its ability is discarded and therefore does not remain in the player's cards for scoring.

Do not use Sueca scoring, Blackjack scoring, or any other card-game scoring system.

---

## 5. Turn Order

Play always proceeds to the player on the **right / counter-clockwise**.

A normal turn is:

1. The active player draws one card from the draw pile.
2. The player decides what to do with the drawn card.
3. The player may use an applicable special ability or complete the normal discard/exchange flow.
4. The resulting card is placed in the discard pile when appropriate.
5. The turn passes to the next player on the right.

The server must authoritatively control the turn.

---

## 6. Discard Pile and Matching Cards

The top card of the discard pile is visible to everyone.

A player who has a card **identical to the current top discard** may place that card on top of the discard pile even when it is not their normal turn.

Rules:

- The matching card is removed from that player's cards and becomes the new top discard.
- **The player does not draw or receive a replacement card.**
- Therefore, a player can have fewer than 4 cards during the round.
- If this causes the player to have **0 cards, that player wins immediately and the round ends.**
- A player can use this matching-discard action only **once for a given discard event**.
- The server validates that the submitted card really matches the current top discard.
- Multiple players may race to place a matching card.
- The server decides atomically which valid action arrived first.
- Once a new card becomes the top discard, old actions targeting the previous discard event are invalid.

### Special-card interaction

If the latest card placed on the discard pile has a special ability, the ability belongs to the player who **placed that latest card**.

For example, if a Queen is placed on top of another matching Queen, the Queen functionality belongs to the player who placed the latest Queen.

The server must explicitly model the current top discard and its associated owner/action rights.

---

## 7. When Special Abilities Can Be Used

Special abilities may only be activated when the relevant card is legitimately obtained through one of these mechanisms:

1. The player draws the card from the draw pile.
2. The player receives/obtains the card through an allowed exchange.
3. The player places the card onto the discard pile as the latest matching card.

A player **cannot** activate a special ability simply because one of their four face-down cards is known to be a special card.

This rule is mandatory.

---

## 8. Queen — Look at One Own Card

When a player legitimately obtains a Queen and chooses to use its ability:

1. The player chooses one of their own cards.
2. That card is revealed **only to the player who used the Queen**.
3. The player learns the card's identity.
4. No other player sees that card.
5. The Queen itself is discarded.
6. The Queen does not replace one of the player's cards when its ability is used.

Therefore, if a player draws a Queen and uses it for its ability, the Queen goes directly to the discard pile.

The revealed card remains private to the player who used the Queen.

The server must record this newly acquired knowledge and must never broadcast the revealed card to other players.

---

## 9. Jack — Blind Swap

The Jack allows a **blind swap**.

When activated:

1. The active player selects one of their own 4 cards.
2. The active player selects any other player.
3. The active player selects one of that player's 4 cards.
4. Neither selected card is revealed before the exchange.
5. The cards are swapped.
6. The exchange does not reveal the target card to the active player.

The server must never leak the hidden card identities involved in the blind swap.

Knowledge must be updated correctly:

- If a player knew the identity of a card they give away, they no longer have that card.
- A received card remains unknown unless the rules explicitly reveal it.
- Moving a card must not accidentally preserve knowledge at the wrong position/player.

---

## 10. Black King — See and Decide Whether to Swap

A **black King** has a different swap ability.

When activated:

1. The active player chooses one of their own 4 cards.
2. The active player chooses another player's card.
3. The selected card belonging to the other player is temporarily revealed to the active player.
4. The active player can see that card.
5. The active player decides whether to swap.
6. If the player accepts:
   - the two cards are exchanged;
   - the other player receives the active player's selected card;
   - the other player can see the new card they received.
7. If the player declines:
   - no ownership changes;
   - the viewed card is no longer revealed;
   - the temporary information must not become public.

The temporarily viewed card is visible only to the active player.

It must not leak through:
- WebSocket messages;
- serialized global game state;
- browser state sent to other clients;
- logs exposed to clients;
- spectator views.

---

## 11. Red King

The red King has no special ability.

It is worth **-2 points** at the final scoring.

This is the only face card that does not have a final value of 13.

If a red King remains among a player's cards when the round ends, it contributes -2 to that player's total.

---

## 12. Other Cards

No other cards have special abilities.

- Ace: 1 point.
- 2–10: their numerical value.
- Jack: blind swap; 13 points if left in the player's cards at the final count.
- Queen: look at one own card privately; 13 points if left in the player's cards at the final count.
- Black King: see another player's selected card and decide whether to swap; 13 points if left in the player's cards at the final count.
- Red King: no special ability; -2 points if left in the player's cards at the final count.
- Joker: 0 points, no special ability.

Do not add additional abilities.

---

## 13. Suits and Card Identity

Cards should have a unique internal ID.

Example:

```ts
type Card = {
  id: string;
  rank: Rank;
  suit?: Suit;
};
```

Suits are relevant to distinguishing physical cards and to determining black versus red Kings.

For matching-discard purposes, cards are identical only when their complete configured identity matches.

Do not match cards only by rank if the configured deck contains multiple cards of the same rank.

---

## 14. Deck

Support a configurable deck containing:

- Ace
- 2–10
- Jack
- Queen
- King
- Joker

The exact deck composition should be configurable.

The implementation must distinguish black Kings from red Kings.

Every physical card needs a unique ID.

---

## 15. Calling “GRINGO”

When a player believes they have the lowest score, they may call:

**GRINGO**

Calling Gringo does **not** immediately end the round.

Instead:

1. The player calls Gringo.
2. The game enters a `GRINGO_CALLED` phase.
3. The remaining players continue taking their final turns.
4. The final turn cycle continues until it reaches the player who called Gringo again.
5. The player who called Gringo does not take another normal turn.
6. The round ends.
7. All cards are revealed.
8. Scores are calculated.
9. The lowest score wins.

Store the caller explicitly, for example:

```ts
gringoCallerId
```

The server, not the client, determines when the final cycle ends.

### Example

Turn order:

```text
Alice -> Bob -> Carlos -> Diana -> Alice
```

If Carlos calls Gringo:

```text
Carlos calls GRINGO
        |
        v
Diana final turn
        |
        v
Alice final turn
        |
        v
Bob final turn
        |
        v
Carlos would be next
        |
        v
ROUND ENDS
```

Carlos does not take another turn.

---

## 16. End-of-Round Reveal

When the final turn cycle returns to the Gringo caller:

1. Freeze normal gameplay.
2. Reveal all 4 cards of every player.
3. Calculate all totals.
4. Display every player's cards and total.
5. Determine the lowest total.
6. Display the winner(s).
7. Allow the game to start another round if the application supports multiple rounds.

At this point there is no hidden card information.

---

## 17. Knowledge Tracking

Explicitly track which player knows which card.

A possible model:

```ts
type PlayerCardKnowledge = {
  cardId: string;
  knownTo: string[];
};
```

Important knowledge events:

### Initial setup
Each player knows 2 of their own cards.

### Card count
Players are allowed to have fewer than 4 cards after using the matching-discard mechanic because no replacement card is drawn.

If a player reaches 0 cards, they immediately win and the round ends.

### Queen
The Queen user learns one own card.

### Jack
A blind swap reveals nothing.

### Black King
The active player temporarily sees the target card.

If the black King swap is accepted, the player receiving the card can see the new card they received.

### Card movement
Whenever a card changes owner or position, knowledge must be recalculated/updated correctly.

Never assume that a player knows a card merely because it occupies a position they previously knew.

---

## 18. Server-Authoritative State

The server must be authoritative.

Never send the complete deck or hidden card identities to every client.

Each client must receive a player-specific view.

Example:

```json
{
  "players": [
    {
      "id": "p1",
      "cards": [
        {"hidden": true},
        {"rank": "7", "suit": "hearts", "known": true},
        {"hidden": true},
        {"hidden": true}
      ]
    }
  ]
}
```

The exact representation can differ, but the security property is mandatory.

---

## 19. Suggested Game State

Adapt this to the existing project:

```ts
type GamePhase =
  | "WAITING"
  | "DEALING"
  | "PLAYING"
  | "GRINGO_CALLED"
  | "ROUND_REVEAL"
  | "ROUND_COMPLETE";

type Player = {
  id: string;
  name: string;
  seatIndex: number;
  cardIds: string[];
};

type GameState = {
  gameId: string;
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  activePlayerId: string;
  phase: GamePhase;
  gringoCallerId?: string;
  roundNumber: number;
  cardKnowledge: Record<string, string[]>;
};
```

Do not copy this blindly if the existing application has a better architecture.

---

## 20. Server Actions

Use explicit server actions, for example:

```text
DRAW_CARD
DISCARD_CARD
USE_QUEEN
USE_JACK
USE_BLACK_KING
CONFIRM_BLACK_KING_SWAP
DECLINE_BLACK_KING_SWAP
MATCH_DISCARD
CALL_GRINGO
```

Every action must be validated server-side.

Validate:

- authenticated player;
- game phase;
- turn ownership when required;
- card ownership;
- card identity;
- special-card eligibility;
- target player;
- target card;
- action freshness;
- current discard event;
- hidden-information permissions.

---

## 21. Queen Action State

Use a temporary server-side action state.

Conceptually:

```ts
type QueenAction = {
  playerId: string;
  drawnCardId: string;
  awaitingCardSelection: boolean;
};
```

After selection:

1. Privately reveal the selected own card.
2. Record knowledge.
3. Put the Queen into the discard pile.
4. Finish the turn.
5. Move to the next player.

---

## 22. Jack Action State

Conceptually:

```ts
type JackAction = {
  playerId: string;
  jackCardId: string;
  sourceCardId: string;
  targetPlayerId?: string;
  targetCardId?: string;
};
```

The server must verify that all selected cards belong to the correct players and that the swap is still valid.

Do not expose hidden identities.

---

## 23. Black King Action State

Conceptually:

```ts
type BlackKingAction = {
  playerId: string;
  kingCardId: string;
  sourceCardId: string;
  targetPlayerId: string;
  targetCardId: string;
  viewed: boolean;
  decision: "pending" | "accept" | "decline";
};
```

Flow:

1. Validate action.
2. Privately reveal the target card to the active player.
3. Wait for accept/decline.
4. If accepted, perform the swap.
5. Give the receiving player visibility of the card they received.
6. If declined, restore normal state without public revelation.
7. Finish the turn.

---

## 24. Matching-Discard Race Conditions

This mechanic is real-time and can produce race conditions.

Example:

```text
Top discard = 7 of Hearts

Player A has 7 of Hearts
Player B has 7 of Hearts

Both attempt to play it.

The server receives A's valid action first.

A's card becomes the new top discard.

B's action for the previous discard event is rejected.
```

The server must use an atomic state transition.

Never rely on client timestamps.

---

## 25. UI

Build a clean multiplayer card-table interface.

Show:

- players around the table;
- names;
- whose turn it is;
- each player's 4 cards;
- local player's known cards;
- hidden card backs;
- draw pile;
- discard pile;
- current top discard;
- current phase;
- special-action controls;
- Gringo button.

The interface should make hidden information visually clear without leaking it.

### Local player

For the local player:
- known cards show their faces;
- unknown cards show backs.

### Other players

Normally:
- all 4 cards show backs;
- only explicitly permitted temporary reveals may show a face.

---

## 26. Special-Action UX

Queen:

```text
Queen
Choose one of your cards to look at.
```

Jack:

```text
Jack
Choose one of your cards and another player's card.
This is a blind swap.
```

Black King:

```text
Black King
Choose one of your cards and one card from another player.
You will see their card before deciding whether to swap.
```

After viewing:

```text
You saw the selected card.

[Swap] [Keep My Card]
```

The viewed card must remain private.

---

## 27. Gringo UI

The Gringo button should:

- be available when the player can call Gringo;
- require confirmation to avoid accidental calls;
- explain that calling Gringo starts the final turn cycle.

After calling:

```text
Gringo called by Carlos.
Final turns remaining...
```

The server controls the actual end condition.

---

## 28. Multiplayer Architecture

Use real-time multiplayer, preferably reusing the application's existing WebSocket/Socket.IO infrastructure.

The application should support:

1. Creating a game.
2. Joining with a room code/link.
3. Seeing connected players.
4. Starting the game.
5. Real-time turns.
6. Real-time card updates.
7. Reconnection.

Use room-based authoritative game instances.

---

## 29. Reconnection

A disconnected player must be able to reconnect to the same game.

On reconnect:

- restore their seat;
- restore their game;
- send only their permitted information;
- restore known-card information;
- restore any valid pending action.

Never resend hidden information merely because the player reconnected.

---

## 30. Anti-Cheat

Never trust the client with authoritative hidden card information.

The client must not be able to request:

- another player's hidden cards;
- the full draw pile;
- future cards;
- another player's private reveal;
- hidden cards involved in a blind swap.

The server must validate every action.

Reject:

- invalid card IDs;
- actions from the wrong player;
- duplicate actions;
- stale actions;
- invalid swaps;
- invalid matching cards;
- actions after the round ended;
- Gringo calls made on behalf of another player.

---

## 31. Suggested Events

Possible server-to-client events:

```text
GAME_STATE_UPDATED
CARD_DRAWN
CARD_REVEALED_PRIVATELY
QUEEN_ACTION_STARTED
JACK_ACTION_STARTED
BLACK_KING_CARD_REVEALED
BLACK_KING_DECISION_REQUIRED
SWAP_COMPLETED
DISCARD_UPDATED
MATCH_DISCARD_ACCEPTED
MATCH_DISCARD_REJECTED
GRINGO_CALLED
FINAL_TURN_STARTED
ROUND_REVEAL
ROUND_COMPLETE
PLAYER_CONNECTED
PLAYER_DISCONNECTED
ERROR
```

Adapt to the project's existing event architecture.

---

## 32. Error Handling

Examples:

```text
It is not your turn.
```

```text
You cannot use that card's ability.
```

```text
That card is no longer available.
```

```text
Another player placed a matching card first.
```

```text
This action is no longer valid.
```

Errors must be handled gracefully without corrupting game state.

---

## 33. Tests

Create automated tests for:

### Setup
- 4 cards per player.
- Exactly 2 initially known cards per player.
- No unauthorized hidden-card visibility.

### Scoring
- Ace = 1.
- 2–10 = face value.
- Jack = 13.
- Queen = 13.
- Black King = 13.
- Red King = -2.
- Joker = 0.
- A player can have fewer than 4 cards.
- Only cards still owned by the player at final scoring are counted.

### Queen
- Can reveal one own card.
- Revelation is private to the player who used the Queen.
- No other player receives the revealed card identity.
- Queen is discarded when used.
- Queen is not added to the player's card set when used for its ability.
- Cannot activate merely because the player knows a Queen already in their hand.

### Jack
- Can target any other player.
- Swap is blind.
- No hidden card is leaked.
- Knowledge updates correctly.

### Black King
- Target card is visible only to the active player.
- Active player can accept.
- Active player can decline.
- Accepted swap changes ownership.
- Receiving player can see the new card.
- Declined swap changes nothing.

### Matching discard
- Matching card is accepted.
- Non-matching card is rejected.
- The player does not receive a replacement card.
- A player can therefore have fewer than 4 cards.
- If a player reaches 0 cards, they immediately win and the round ends.
- A player cannot use the mechanism twice for the same discard event.
- Concurrent matching attempts are resolved atomically.
- Latest card becomes the active top discard.
- Latest special card's ability belongs to the player who placed it.

### Gringo
- Calling Gringo changes phase.
- Caller does not immediately end the round.
- Remaining players receive their final turns.
- Round ends when turn order returns to caller.
- Caller does not receive another turn.
- All cards are revealed.
- Scores are calculated.
- Lowest score is identified.
- Ties are handled.

### Security
- No client can request another player's hidden card.
- No client can request the draw pile.
- No client can activate another player's special action.
- No client can swap arbitrary cards.
- No client can call Gringo for another player.
- Stale actions are rejected.
- Post-round actions are rejected.

---

## 34. Project Integration

Before coding:

1. Inspect the existing project architecture.
2. Reuse existing authentication, rooms, WebSockets, UI components, and styling.
3. Check whether a reusable card/deck abstraction already exists.
4. Avoid duplicating multiplayer infrastructure.
5. Add Gringo as a separate game module while keeping shared infrastructure reusable.

Then implement:

1. Card/deck model.
2. Player model.
3. Hidden-information model.
4. Initial dealing.
5. Initial 2-card knowledge.
6. Draw pile.
7. Discard pile.
8. Normal turns.
9. Matching-discard mechanic.
10. Queen ability.
11. Jack blind swap.
12. Black King reveal-and-decide swap.
13. Scoring.
14. Gringo call.
15. Final turn cycle.
16. End-of-round reveal.
17. Winner/tie detection.
18. Real-time synchronization.
19. Reconnection.
20. Anti-cheat validation.
21. Automated tests.
22. Polished UI.

---

## 35. Core Architecture Principle

Do not put game rules only inside UI components.

The game engine should expose deterministic rule functions such as:

```ts
canDrawCard(state, playerId)
canUseQueen(state, playerId, cardId)
canUseJack(state, playerId, cardId)
canUseBlackKing(state, playerId, cardId)
canMatchDiscard(state, playerId, cardId)
canCallGringo(state, playerId)
```

and transitions such as:

```ts
drawCard(...)
useQueen(...)
useJack(...)
useBlackKing(...)
matchDiscard(...)
callGringo(...)
finishTurn(...)
finishRound(...)
```

The core game engine should be testable without a browser.

---

## 36. Do Not Invent Rules

Do not silently add:

- standard Cabo rules;
- standard Golf rules;
- UNO penalties;
- penalties for an incorrect Gringo call;
- extra special cards;
- special combinations;
- automatic swaps;
- bonuses;
- teams;
- fixed round counts;
- target scores.

If a technical implementation requires a decision that changes gameplay, ask for clarification rather than inventing a gameplay rule.

---

## 37. Acceptance Criteria

The implementation is complete when:

- Multiple players can join the same Gringo room.
- Each player starts with exactly 4 face-down cards.
- Each player can initially see exactly 2 of their own cards.
- Turns proceed right / counter-clockwise.
- Players draw and resolve turns correctly.
- Matching cards can be placed on the discard pile according to the matching rule.
- Special abilities only work when legitimately activated.
- Queens reveal one own card.
- Jacks perform blind swaps.
- Black Kings reveal a target card before the swap decision.
- Red Kings score 13.
- Jokers score 0.
- All other values are correct.
- Players can call Gringo.
- The final turn cycle completes correctly.
- The caller does not take another turn when the cycle returns to them.
- All cards are revealed at the end.
- Lowest score is correctly identified.
- Ties are displayed correctly.
- Hidden information is never leaked.
- Reconnection works.
- Matching-discard race conditions are server-authoritative.
- Automated tests cover the important gameplay and security rules.

---

## 38. Final Instruction to Claude Code

Treat this document as the authoritative gameplay specification for Gringo.

First inspect the existing codebase and briefly explain how Gringo should integrate with the current architecture.

Then implement the game fully.

Do not replace working shared infrastructure unnecessarily.

Do not invent missing gameplay rules.

Prioritize:

1. Correct rules.
2. Hidden-information security.
3. Server authority.
4. Deterministic state transitions.
5. Real-time multiplayer reliability.
6. Good player experience.
7. Automated testing.

If existing code conflicts with this specification, modify the implementation so that the behavior matches this specification.

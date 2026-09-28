# Claude Code Prompt — Portuguese Sueca Multiplayer Web App

You are an expert full-stack engineer and multiplayer game developer.

I want you to build a complete, production-quality multiplayer web application for playing **Sueca**, the traditional Portuguese 4-player partnership trick-taking card game, with friends online.

Do not simplify the rules. Do not replace the game with a generic trick-taking implementation. The application must implement the actual Portuguese rules described below, including the unusual card ranking, mandatory suit following, trump mechanics, partnerships, scoring, capote/bandeira, game progression, and all relevant edge cases.

The application should be designed for real-time play between four human players who join the same private room.

---

# 1. GAME IDENTITY

Game name:

**Sueca**

Language of the application:

- Portuguese (Portugal) for the player-facing UI.
- Code, variable names, database fields, API names, and technical documentation should preferably be in English.

The game is a traditional Portuguese trick-taking game for:

- exactly 4 players;
- 2 fixed teams;
- 2 players per team;
- teammates sitting opposite each other.

The four seats around the table should therefore be:

- Seat 0: Team A
- Seat 1: Team B
- Seat 2: Team A
- Seat 3: Team B

Never place teammates adjacent to each other.

The standard game is NOT an individual free-for-all. Every scoring calculation is performed at team level.

---

# 2. OBJECTIVE

The objective of each hand is to collect more card points than the opposing team.

There are exactly:

**120 card points** in the complete deck.

A team needs at least:

**61 points**

to win a normal hand.

The match is composed of multiple hands.

The default match objective is:

**first team to reach 4 game points ("riscos") wins the match.**

The application architecture should make the target configurable so that later we can support games to 3, 4, 7, etc., but the default must be 4.

---

# 3. DECK

Use exactly 40 cards.

Start conceptually from a standard 52-card French deck and remove:

- all 8s;
- all 9s;
- all 10s;
- jokers.

The remaining cards are:

### Suits

- Hearts
- Diamonds
- Clubs
- Spades

### Ranks

Each suit contains:

- Ace
- 7
- King
- Jack
- Queen
- 6
- 5
- 4
- 3
- 2

There are therefore:

4 suits × 10 cards = 40 cards.

Every card must have:

- unique ID;
- suit;
- rank;
- point value;
- trick-taking strength/rank.

---

# 4. CARD POINT VALUES

Sueca does NOT use normal poker/bridge card values.

| Card | Points |
|---|---:|
| Ace | 11 |
| 7 | 10 |
| King | 4 |
| Jack | 3 |
| Queen | 2 |
| 6 | 0 |
| 5 | 0 |
| 4 | 0 |
| 3 | 0 |
| 2 | 0 |

Total:

**120 points**

---

# 5. CARD STRENGTH / RANKING

The ranking of cards within a suit is NOT normal poker order.

From strongest to weakest:

1. Ace
2. 7
3. King
4. Jack
5. Queen
6. 6
7. 5
8. 4
9. 3
10. 2

So:

**A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2**

The fact that the 7 is stronger than the King is fundamental to Sueca.

Do NOT use standard card ordering.

---

# 6. TEAMS / PARTNERSHIPS

There are always two teams.

Example:

Player 1 + Player 3 = Team A

Player 2 + Player 4 = Team B

Partners are opposite each other around the virtual table.

Teams remain fixed for the entire match.

Players must never be able to accidentally change teams in the middle of a match.

The lobby should make the team positions visually obvious.

---

# 7. PRIVATE INFORMATION

Each player must only see their own cards.

A player must NOT see:

- teammates' cards;
- opponents' cards;
- undealt cards;
- cards remaining in opponents' hands.

The server must never trust the client regarding hidden information.

The server should be authoritative.

The client sends something equivalent to:

`Play card X`

The server verifies:

1. it is this player's turn;
2. card X belongs to that player;
3. card X is currently in that player's hand;
4. card X is legal according to Sueca rules;
5. the game state has not changed;
6. the player has not already played a card for this trick.

Only then should the server accept the move.

---

# 8. MATCH / HAND / TRICK TERMINOLOGY

Implement the following conceptual hierarchy:

MATCH  
→ consists of HANDS  
→ each HAND consists of exactly 10 TRICKS  
→ each TRICK contains exactly 4 PLAYED CARDS

At the end of each hand:

- all 40 cards have been played;
- each player has 0 cards;
- the teams' card points are calculated;
- game points ("riscos") are awarded;
- if no team has reached the match target, a new hand begins.

---

# 9. DEALING

Each player receives exactly:

**10 cards**

The complete 40-card deck is therefore dealt.

The trump suit is determined by a card belonging to the dealer.

Use the following standard implementation:

1. Shuffle the complete 40-card deck server-side.
2. Determine the trump card.
3. The dealer receives the trump card.
4. Deal the remaining cards so that every player ends with exactly 10 cards.

The trump card may be revealed to everyone.

A convenient implementation is:

- reveal the last card of the shuffled deck;
- its suit becomes trump;
- that card belongs to the dealer;
- deal the remaining 39 cards around the table so that the dealer has that trump card plus 9 additional cards.

The application should clearly display the trump suit.

The trump card itself must remain a normal playable card in the dealer's hand.

---

# 10. DEALER ROTATION

The dealer changes after every completed hand.

Rotate the dealer by one seat in the direction of play.

The first dealer may be randomly selected.

After that:

`dealer → next player in rotation`

The UI should clearly show the dealer.

---

# 11. DIRECTION OF PLAY

Use the Portuguese convention:

**counter-clockwise**

The game engine must have an explicit seat-order function.

Do not hard-code direction into UI components.

---

# 12. WHO STARTS THE FIRST TRICK

The player immediately to the dealer's right starts the first trick.

After the first trick, the winner of the previous trick always starts the next trick.

Therefore:

First trick:
dealer's right → leads.

Tricks 2–10:
previous trick winner → leads.

---

# 13. PLAYING A TRICK

A trick consists of exactly four cards, one from each player.

The leader may play any card.

The suit of the leader's card becomes the:

**led suit**

Every subsequent player must follow that suit if they have at least one card of that suit.

---

# 14. FOLLOW-SUIT RULE

If the led suit is Hearts and a player has at least one Heart:

They MUST play a Heart.

They may NOT:

- play a trump;
- play another suit;
- discard another card.

If the player has no cards of the led suit:

They may play ANY card in their hand.

There is NO requirement to trump when the player cannot follow suit.

Example:

Led suit = Hearts.

Player has:

- Ace of Clubs
- 7 of Spades
- 3 of Hearts

The player MUST play the 3 of Hearts.

The client must prevent the other cards from being selectable.

---

# 15. TRUMP RULE

One suit is the trump suit for the entire hand.

A trump card beats any card from a non-trump suit.

However:

**Playing trump is NOT mandatory.**

A player can only choose a trump when they do not have the led suit.

Example:

Trump = Spades.

Leader plays Ace of Hearts.

A player has no Hearts but has:

- 2 Spades
- King Clubs
- 5 Diamonds

They may choose any of those three cards.

They are NOT forced to play Spades.

---

# 16. TRICK WINNER ALGORITHM

Given:

- led suit;
- trump suit;
- four played cards;

winner is determined as follows:

### Case A — At least one trump was played

The highest-ranked trump wins.

Compare trumps using:

**A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2**

### Case B — No trump was played

The highest-ranked card of the led suit wins.

Cards from other non-trump suits cannot beat a card from the led suit.

---

# 17. WINNING PLAYER STARTS NEXT TRICK

After determining the winner:

- award all four cards to the winning player's team;
- record the trick winner;
- record all four cards in the trick history;
- add the point values of the four cards to the winning team's hand total;
- make the winner the leader of the next trick.

---

# 18. TRICK COLLECTION

For each team, maintain:

```text
capturedCards[]
capturedPoints
tricksWon
```

For each trick, record:

```text
trickNumber
leader
ledSuit
plays[]
winner
points
```

---

# 19. CARD LEGALITY FUNCTION

Implement a single authoritative function similar to:

```text
getLegalCards(playerHand, ledSuit, trumpSuit)
```

Rules:

If there is no led suit:

```text
return every card in player's hand
```

Otherwise:

```text
cardsOfLedSuit = cards in hand matching ledSuit

if cardsOfLedSuit.length > 0:
    return cardsOfLedSuit

return entire hand
```

Use this logic both:

- server-side for validation;
- client-side for highlighting/selectability.

The server is authoritative.

---

# 20. NO TABLE TALK / PARTNER COMMUNICATION

Traditional Sueca is played without verbal communication between partners about the cards they hold.

For the online version:

Players should NOT have access to gameplay chat that allows them to communicate strategically while a hand is active.

If chat is implemented, make it disabled during active hands by default and optionally available in lobby/intermission.

Do not implement private team chat during an active hand.

---

# 21. NO CARD SIGNALING FEATURES

Do not implement:

- partner hints;
- suggested plays;
- automated strategic advice;
- "tell partner" buttons;
- card emojis directed at teammates;
- private team indicators.

The game should preserve the information structure of physical Sueca.

---

# 22. SCORING A HAND

At the end of 10 tricks:

Sum the card points captured by each team.

Because the complete deck contains 120 points:

```text
teamA_points + teamB_points = 120
```

This should be asserted by the server.

Default scoring:

### 61–90 points

Winning team receives:

**1 risco**

### 91–119 points

Winning team receives:

**2 riscos**

### 120 points

Under the default ruleset:

**4 riscos (capote)**

Track whether one team won all 10 tricks separately as:

**bandeira**

Do NOT infer bandeira from 120 points.

---

# 23. 120-POINT EDGE CASE

A team can theoretically capture all 120 points while the opponents win a zero-point trick.

Therefore track:

```text
team.capturedPoints === 120
```

separately from:

```text
team.tricksWon === 10
```

Under the default ruleset, 120 points is enough for the 4-risk capote.

---

# 24. BANDEIRA / ALL TEN TRICKS

Track:

```text
team.tricksWon === 10
```

as a separate achievement/statistic.

The default ruleset does not require all 10 tricks for the 120-point capote.

---

# 25. 60–60 TIE

There are regional/house-rule differences.

Make this configurable:

```text
tieAt60Rule
```

Supported values:

```text
EACH_TEAM_GETS_ONE
NO_POINTS
CARRY_TO_NEXT_HAND
```

Default:

```text
EACH_TEAM_GETS_ONE
```

Under the default:

Team A = 60  
Team B = 60

Both teams receive:

**+1 risco**

No team wins the hand.

If both teams reach the match target simultaneously, do NOT randomly select a winner.

Continue playing hands until one team has a strictly higher final risk total.

---

# 26. MATCH END

Default:

```text
targetRisks = 4
```

After every hand, check whether the match has ended.

If both teams are at or above the target simultaneously, continue until one team has a strictly higher score.

Do not start another hand after a team has definitively won.

---

# 27. DEALER / HAND PROGRESSION

After a hand ends:

1. Show the hand result.
2. Show each team's card points.
3. Show tricks won.
4. Show risks awarded.
5. Show updated match score.
6. If match is not finished, prepare the next hand.
7. Rotate dealer.
8. Shuffle a fresh 40-card deck.
9. Determine new trump.
10. Deal 10 cards to each player.
11. Determine the first player.
12. Start trick 1.

Every hand uses a fresh complete 40-card deck.

---

# 28. GAME STATE MACHINE

Use explicit states such as:

```text
LOBBY
WAITING_FOR_PLAYERS
READY
DEALING
PLAYING_TRICK
TRICK_RESOLUTION
HAND_RESULT
MATCH_RESULT
```

Potentially:

```text
PAUSED
DISCONNECTED
ABANDONED
```

Every server action must validate that the action is legal for the current state.

---

# 29. REAL-TIME MULTIPLAYER

Use:

- WebSockets;
- Socket.IO;
- or another robust real-time transport.

The server must be authoritative.

Possible server events:

```text
ROOM_UPDATED
PLAYER_JOINED
PLAYER_READY
GAME_STARTED
HAND_STARTED
CARD_PLAYED
TRICK_COMPLETED
HAND_COMPLETED
SCORE_UPDATED
GAME_COMPLETED
PLAYER_DISCONNECTED
PLAYER_RECONNECTED
```

---

# 30. ROOM SYSTEM

Users should be able to:

1. Create a private room.
2. Receive a shareable room code/link.
3. Friends join the room.
4. Four players occupy four seats.
5. The game starts when all four players are ready.

The room should display:

- room code;
- players;
- seats;
- teams;
- ready state;
- host;
- start button.

Only the host should start the game once all four players are present and ready.

---

# 31. PLAYER RECONNECTION

If a player refreshes or temporarily loses connection:

- preserve their seat;
- preserve their team;
- preserve their hand;
- preserve the match;
- preserve the current game state.

After reconnecting, send the player's current private state.

Never reveal other players' hidden cards.

---

# 32. DISCONNECT HANDLING

If a player disconnects:

- preserve the game state;
- show a disconnected indicator;
- allow reconnection.

Do not automatically reveal their cards.

Do not immediately forfeit unless a configurable timeout exists.

---

# 33. TURN TIMER

Implement an optional server-authoritative turn timer.

Default:

```text
turnTimerEnabled = true
turnDurationSeconds = 30
```

The client displays the countdown.

The server decides when the timer expires.

Do not automatically make a strategic play unless explicitly configured later.

---

# 34. LOBBY SETTINGS

Before starting:

### Match target

Default:

**4 riscos**

Options:

- 3
- 4
- 7

### 60–60 rule

Options:

- Each team gets 1 risco
- Nobody gets a risco
- Carry risco to next hand

Default:

**Each team gets 1 risco**

### Capote rule

Default:

**120 card points = 4 riscos**

Rules cannot change after the match starts.

---

# 35. UI TABLE

Build a polished virtual card table showing:

- four player positions;
- player names;
- team;
- whose turn it is;
- trump;
- current trick;
- played cards;
- match score;
- current hand score;
- trick number;
- connection status.

The local player's cards appear at the bottom.

Opponent and partner cards appear as card backs.

---

# 36. PLAYER HAND UX

Cards must be:

- easy to tap on mobile;
- easy to click on desktop;
- clearly distinguish legal from illegal;
- non-clickable when illegal.

Avoid drag-and-drop as the primary interaction.

Prevent accidental double plays.

---

# 37. TRICK ANIMATION

When a card is played:

- animate it from the player's hand to the center;
- display it clearly;
- update turn indicator.

After four cards:

1. briefly show the complete trick;
2. highlight the winner;
3. identify the winning player;
4. move the trick to the winning team's captured area;
5. begin the next trick.

Animations must never alter game correctness.

---

# 38. CURRENT TRICK INFORMATION

Display:

```text
Trick 4 / 10
Trump: Hearts
Led suit: Clubs
```

once the first card is played.

Also show whose turn it is.

---

# 39. SCOREBOARD

Display:

```text
TEAM A
Hand: 63
Riscos: 2

TEAM B
Hand: 57
Riscos: 1
```

The current hand's accumulated points may be shown.

Never show hidden cards.

---

# 40. CARD HISTORY

Provide an optional history panel showing completed tricks.

Example:

```text
Trick 1
Player A: A♥
Player B: 3♥
Player C: K♥
Player D: 7♥
Winner: Player A
Points: 25
```

Only already-played cards may appear.

---

# 41. RULES HELP

Include an in-game rules modal explaining:

- 40-card deck;
- 4 players;
- 2 teams;
- teammates opposite;
- card order;
- card points;
- trump;
- following suit;
- no obligation to trump;
- trick winner;
- scoring;
- 60–60;
- capote;
- match target.

Make it accessible without leaving the game.

---

# 42. NEW PLAYER EXPLANATION

For first-time players, clearly explain:

"Follow the suit that was led if you can. If you cannot follow suit, you may play any card, including trump. Trump is not mandatory."

Also prominently explain:

**7 beats King.**

---

# 43. SERVER-AUTHORITATIVE GAME ENGINE

Suggested domain model:

```typescript
type Suit = "hearts" | "diamonds" | "clubs" | "spades";

type Rank =
  | "A"
  | "7"
  | "K"
  | "J"
  | "Q"
  | "6"
  | "5"
  | "4"
  | "3"
  | "2";

interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  points: number;
  strength: number;
}

interface Player {
  id: string;
  name: string;
  seat: number;
  team: "A" | "B";
  connected: boolean;
}

interface PlayedCard {
  playerId: string;
  cardId: string;
}

interface Trick {
  number: number;
  leaderSeat: number;
  ledSuit: Suit;
  plays: PlayedCard[];
  winnerSeat?: number;
  points: number;
}

interface HandState {
  dealerSeat: number;
  trumpSuit: Suit;
  trumpCardId: string;
  hands: Record<string, string[]>;
  currentTrick: Trick;
  completedTricks: Trick[];
  currentTurnSeat: number;
  teamPoints: {
    A: number;
    B: number;
  };
  teamTricks: {
    A: number;
    B: number;
  };
}

interface MatchState {
  targetRisks: number;
  risks: {
    A: number;
    B: number;
  };
  handNumber: number;
  currentHand: HandState;
}
```

Adapt this to the selected stack.

---

# 44. PURE GAME FUNCTIONS

Keep rules isolated from networking/UI.

Implement pure/testable functions such as:

```text
createDeck()
shuffleDeck()
determineTrump()
dealCards()
getLegalCards()
isLegalPlay()
compareCards()
determineTrickWinner()
calculateTrickPoints()
calculateHandScore()
calculateRiskAward()
isCapote()
isBandeira()
isMatchOver()
getNextPlayer()
getFirstPlayer()
getNextDealer()
```

The game engine must be testable without a browser.

---

# 45. CARD COMPARISON

Implement:

```text
compareCards(cardA, cardB, ledSuit, trumpSuit)
```

It must understand:

1. trump beats non-trump;
2. both trump → compare Sueca strength;
3. neither trump → led suit beats unrelated suits;
4. both led suit → compare Sueca strength;
5. unrelated non-led suits cannot beat a led-suit card.

Do not use generic card ordering without trick context.

---

# 46. TESTING

Write extensive automated tests.

At minimum:

### Deck

- exactly 40 cards;
- no 8, 9, 10;
- no duplicate IDs;
- 10 cards per suit;
- total points = 120.

### Ranking

Verify:

```text
A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2
```

### Points

Verify:

```text
A = 11
7 = 10
K = 4
J = 3
Q = 2
2-6 = 0
```

### Trump

Verify:

```text
2 of trump > Ace of non-trump
7 of trump > Ace of non-trump
Ace trump > 7 trump
```

### Follow suit

If player has led suit:
only led-suit cards are legal.

If player has no led suit:
every card is legal.

### No forced trump

If player cannot follow suit:
both trump and non-trump cards are legal.

### Scoring

Verify:

```text
61 → 1 risk
90 → 1 risk
91 → 2 risks
119 → 2 risks
120 → 4 risks under default capote rule
60–60 → +1 each under default rule
```

### Bandeira

Verify 10 tricks won is tracked independently from 120 points.

### Match

Verify target, capote, simultaneous target scores, and match termination.

---

# 47. SECURITY

Assume malicious clients.

Never trust:

- card IDs;
- turn information;
- scores;
- teams;
- trump;
- hand contents;
- winner information.

The server owns all game state.

The client requests an action such as:

```text
PLAY_CARD(cardId)
```

The server validates it.

---

# 48. INFORMATION LEAK PREVENTION

Do not broadcast complete game state to every player.

For each player construct:

```text
publicState + thatPlayerPrivateHand
```

Never send all players' private hands to any client.

The same applies to reconnect payloads.

---

# 49. GAME LOGGING

Maintain an event log for debugging:

```text
HAND_STARTED
TRUMP_REVEALED
CARD_PLAYED
TRICK_COMPLETED
HAND_COMPLETED
RISKS_AWARDED
MATCH_COMPLETED
```

Include relevant timestamps and IDs.

Do not unnecessarily log hidden information.

---

# 50. ANTI-CHEAT

Prevent:

- playing out of turn;
- playing cards not owned;
- failing to follow suit;
- playing a card twice;
- client-side score manipulation;
- changing teams mid-match;
- changing trump;
- replaying stale actions;
- duplicate PLAY_CARD requests.

Use server-side state transitions and idempotency where appropriate.

---

# 51. RECONNECT STATE

On reconnect, send only:

- player's own hand;
- public cards already played;
- trump;
- scores;
- teams;
- current turn;
- current trick;
- game state;
- timer;
- match status.

Never send opponents' cards or undealt cards.

---

# 52. MOBILE-FIRST DESIGN

The game must work well on:

- iPhone;
- Android;
- tablet;
- desktop.

Cards should be large enough for touch.

Avoid requiring drag-and-drop.

The table must adapt to portrait mobile screens.

---

# 53. VISUAL DESIGN

Aim for a polished Portuguese card-table aesthetic.

Use:

- dark/green felt-style table;
- clean card designs;
- clear Portuguese typography;
- subtle animations;
- strong contrast;
- obvious team positioning;
- elegant score display.

Avoid excessive visual effects.

---

# 54. ACCESSIBILITY

Support:

- keyboard navigation;
- visible focus states;
- sufficient contrast;
- screen-reader labels where possible;
- non-color-only team indicators;
- clear text for trump;
- clear turn indication.

Do not rely exclusively on red/black suit colors.

---

# 55. ROOM CREATION UX

Flow:

1. Landing page.
2. Create room.
3. Enter nickname.
4. Create private room.
5. Show room code/link.
6. Friends join.
7. Players occupy seats.
8. Host starts.

With fewer than four players:

"Waiting for X more players."

Do not start normal Sueca with fewer than four players.

---

# 56. TEAM ASSIGNMENT

When four players join:

```text
Seat 0 → Team A
Seat 1 → Team B
Seat 2 → Team A
Seat 3 → Team B
```

Optionally allow host to swap seats before start.

Once the match starts:

team assignments are locked.

---

# 57. HOST BEHAVIOR

The host may:

- configure the room before starting;
- start the match;
- close/restart the room where appropriate.

The host must NOT be able to:

- see hidden cards;
- change scores;
- play for other players;
- change trump;
- change teams mid-hand.

---

# 58. GAME START

Show a concise rules summary:

```text
4 players
2 teams
10 cards each
7 beats King
Follow suit when possible
Trump beats all other suits
Trump is optional when you cannot follow suit
61+ points wins the hand
91+ = 2 risks
120 = capote = 4 risks
First to 4 risks wins
```

Then start the first hand.

---

# 59. END-OF-HAND SCREEN

Show:

```text
HAND COMPLETE

Team A
67 points
1 risk

Team B
53 points
0 risks

MATCH SCORE
Team A: 2
Team B: 1
```

Also show:

- tricks won;
- trump;
- optional trick history.

If capote:

```text
CAPOTE!
Team A captured all 120 points.
+4 riscos
```

If bandeira:

```text
BANDEIRA!
Team A won all 10 tricks.
```

---

# 60. END-OF-MATCH SCREEN

Show:

```text
GAME OVER

TEAM A WINS

Final score:
Team A: 4
Team B: 2
```

Offer "Play Again".

A new match must reset cards, tricks, hand scores, and match score appropriately.

---

# 61. RULE VARIANTS ARCHITECTURE

Do not hard-code house rules directly into the engine.

Create:

```typescript
interface SuecaRules {
  targetRisks: number;
  direction: "COUNTER_CLOCKWISE";
  tieAt60Rule:
    | "EACH_TEAM_GETS_ONE"
    | "NO_POINTS"
    | "CARRY_TO_NEXT_HAND";
  capoteRule:
    | "120_POINTS"
    | "ALL_TEN_TRICKS";
  renunciaRule:
    | "DISABLED"
    | "OPPONENTS_GET_4_RISKS";
  turnTimerSeconds?: number;
}
```

Default:

```typescript
{
  targetRisks: 4,
  direction: "COUNTER_CLOCKWISE",
  tieAt60Rule: "EACH_TEAM_GETS_ONE",
  capoteRule: "120_POINTS",
  renunciaRule: "DISABLED",
  turnTimerSeconds: 30
}
```

Do not allow rules to change after the match starts.

---

# 62. TRUMP CARD

The trump card is public.

The player who receives it sees it in their hand like every other card.

It is a normal playable card.

Do not create a separate unavailable "trump indicator card".

---

# 63. TRUMP CARD POINTS

Trump changes trick-taking strength, NOT point value.

Examples:

- Ace trump = 11 points;
- 7 trump = 10 points;
- 2 trump = 0 points.

No bonus points for trump.

---

# 64. TRICK WINNING VS POINTS

Winning a trick and winning points are separate concepts.

A player may win a trick worth 0 points.

Therefore track independently:

```text
tricksWon
capturedPoints
```

Never infer one from the other.

---

# 65. TEAM SCORE

A trick belongs to its winning player.

Its card points belong to that player's team.

For example:

Seat 0 wins → Team A receives the trick points.

Seat 1 wins → Team B receives the trick points.

---

# 66. CURRENT TURN

The server maintains:

```text
currentTurnSeat
```

After a successful play:

```text
currentTurnSeat = nextSeat(currentTurnSeat)
```

After four cards:

```text
currentTurnSeat = trick.winnerSeat
```

The UI never determines the turn.

---

# 67. ATOMIC MOVES

Playing a card must be atomic.

Server process:

1. validate game state;
2. validate player turn;
3. validate card ownership;
4. validate legality;
5. remove card;
6. append play;
7. calculate next state;
8. broadcast event.

Prevent race conditions and duplicate plays.

---

# 68. DETERMINISTIC TEST HAND

Create deterministic fixed-deck tests that verify:

- dealing;
- trump;
- first player;
- legal moves;
- illegal moves;
- trick winner;
- points;
- completion after 10 tricks;
- risk calculation.

---

# 69. SPECIAL-CASE TESTS

Test:

### Case 1
Led suit = Hearts.
Player has Hearts.
Only Hearts legal.

### Case 2
Led suit = Hearts.
Player has no Hearts.
All cards legal.

### Case 3
Player cannot follow and plays trump.
Trump wins unless beaten by a stronger trump.

### Case 4
Player cannot follow and plays non-trump.
That card cannot beat a led-suit card.

### Case 5
Two trumps.
Highest trump wins.

### Case 6
Ace vs 7 same suit.
Ace wins.

### Case 7
7 vs King same suit.
7 wins.

### Case 8
Jack vs Queen.
Jack wins.

### Case 9
120 points but fewer than 10 tricks.
Capote follows selected configuration.

### Case 10
10 tricks and 120 points.
Bandeira + capote.

### Case 11
60–60.
Apply configured tie rule.

### Case 12
Team reaches 4 risks via capote.
Match ends.

---

# 70. ERROR HANDLING

Use meaningful codes:

```text
NOT_YOUR_TURN
CARD_NOT_IN_HAND
INVALID_CARD
MUST_FOLLOW_SUIT
GAME_NOT_ACTIVE
HAND_NOT_ACTIVE
ROOM_FULL
MATCH_ALREADY_STARTED
PLAYER_NOT_FOUND
INVALID_ROOM
```

Map these to friendly Portuguese messages.

Example:

"Não podes jogar essa carta porque tens cartas do naipe pedido."

---

# 71. DEVELOPMENT APPROACH

Before decorative UI:

1. Implement game engine.
2. Write unit tests.
3. Verify rules.
4. Implement authoritative multiplayer.
5. Implement room/lobby.
6. Implement private state.
7. Implement table UI.
8. Implement animations.
9. Implement reconnect.
10. Polish.

Do not build a decorative mockup first.

The rules engine is the source of truth.

---

# 72. DELIVERABLES

Deliver:

- frontend;
- backend/server;
- multiplayer rooms;
- real-time synchronization;
- authoritative game engine;
- complete Sueca rules;
- scoring;
- match system;
- reconnect support;
- responsive UI;
- tests;
- README;
- local development instructions;
- production deployment instructions.

This must be a working application, not a mockup.

---

# 73. README

Document:

- installation;
- local development;
- frontend;
- server;
- environment variables;
- multiplayer rooms;
- game engine;
- Sueca rules;
- tests;
- deployment.

---

# 74. FINAL QUALITY REQUIREMENT

Do not build a toy implementation.

I want something that four Portuguese friends can actually use to play a full game of Sueca remotely.

Do not accidentally implement normal card-game rules.

The default core rules are:

```text
40 cards
4 players
2 teams
10 cards each

A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2

A = 11
7 = 10
K = 4
J = 3
Q = 2
others = 0

120 points total

Trump beats every non-trump suit.

Players MUST follow the led suit if they have it.

If they do NOT have the led suit, they may play ANY card.

They are NOT required to trump.

Partners are opposite each other.

Play is counter-clockwise.

Winner of the trick leads the next trick.

61–90 = 1 risco.
91–119 = 2 riscos.
120 = 4 riscos under the default capote rule.
60–60 = 1 risco for each team under the default rule.

First team to reach 4 riscos wins.

The 7 is stronger than the King.

The server is authoritative.

Hidden cards must remain private.
```

Build around these rules and verify them with automated tests before considering the implementation complete.

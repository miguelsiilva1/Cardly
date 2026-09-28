export interface GringoRules {
  /** Seconds to act on a turn, to peek, and to finish an ability. 0 disables them. */
  turnTimerSeconds: number;
  /** After every discard the next draw is locked this long, so the ability owner can claim it. */
  abilityWindowSeconds: number;
}

export const DEFAULT_GRINGO_RULES: GringoRules = {
  turnTimerSeconds: 60,
  abilityWindowSeconds: 3,
};

/** Gringo turns take longer than a Sueca play: remembering cards, deciding to swap. */
export const TURN_TIMER_OPTIONS = [0, 30, 45, 60, 90] as const;

export const ABILITY_WINDOW_OPTIONS = [2, 3, 5] as const;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const HAND_SIZE = 4;
export const PEEK_COUNT = 2;

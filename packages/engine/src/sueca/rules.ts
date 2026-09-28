export interface SuecaRules {
  targetRisks: number;
  direction: "COUNTER_CLOCKWISE";
  tieAt60Rule: "EACH_TEAM_GETS_ONE" | "NO_POINTS" | "CARRY_TO_NEXT_HAND";
  capoteRule: "120_POINTS" | "ALL_TEN_TRICKS";
  /** Illegal plays are blocked, so renúncia cannot happen. Kept for completeness. */
  renunciaRule: "DISABLED";
  /** 0 disables the turn timer. */
  turnTimerSeconds: number;
}

export const DEFAULT_SUECA_RULES: SuecaRules = {
  targetRisks: 4,
  direction: "COUNTER_CLOCKWISE",
  tieAt60Rule: "EACH_TEAM_GETS_ONE",
  capoteRule: "120_POINTS",
  renunciaRule: "DISABLED",
  turnTimerSeconds: 30,
};

export const TARGET_RISK_OPTIONS = [3, 4, 7] as const;

import { createRemoteJWKSet, jwtVerify } from "jose";

export interface SupabaseEnv {
  /** Project URL, e.g. https://<ref>.supabase.co. Empty disables login and history. */
  SUPABASE_URL?: string;
  /** Secret (service_role) key. Only used to call record_match. */
  SUPABASE_SECRET_KEY?: string;
}

/** Per isolate; jose caches the fetched keys and refetches on an unknown key id. */
let jwks: { url: string; keys: ReturnType<typeof createRemoteJWKSet> } | null = null;

/** Returns the Supabase user id of a valid session JWT, or null. */
export async function verifyAccessToken(env: SupabaseEnv, token: string): Promise<string | null> {
  if (!env.SUPABASE_URL) return null;
  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  if (jwks?.url !== issuer) {
    jwks = { url: issuer, keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) };
  }
  try {
    const { payload } = await jwtVerify(token, jwks.keys, { issuer, audience: "authenticated" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * A free Supabase project pauses after a week without activity. One small
 * query from the Worker's cron keeps it awake.
 */
export async function keepAlive(env: SupabaseEnv): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/matches?select=id&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      ...(env.SUPABASE_SECRET_KEY.startsWith("eyJ") ? { Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } : {}),
    },
  });
  if (!res.ok) console.error(`keep-alive failed: ${res.status}`);
}

export interface MatchRecord {
  game: "sueca" | "gringo";
  room_code: string;
  summary: Record<string, unknown>;
  players: {
    seat: number;
    name: string;
    user_id: string | null;
    bot: boolean;
    team: "A" | "B" | null;
    score: number;
    won: boolean;
  }[];
}

export async function recordMatch(env: SupabaseEnv, record: MatchRecord): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_match`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys do not.
      ...(env.SUPABASE_SECRET_KEY.startsWith("eyJ") ? { Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p: record }),
  });
  if (!res.ok) console.error(`record_match failed: ${res.status} ${await res.text()}`);
}

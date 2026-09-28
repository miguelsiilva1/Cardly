import { useEffect, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null when Supabase is not configured: everyone plays as a guest. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

/** `undefined` while the stored session loads, `null` when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export function displayName(session: Session): string {
  const meta = session.user.user_metadata as { full_name?: string; name?: string };
  return meta.full_name ?? meta.name ?? session.user.email ?? "";
}

export function signIn(): void {
  void supabase?.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
}

export function signOut(): void {
  void supabase?.auth.signOut();
}

/** A fresh access token (refreshed if expired), or null for guests. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

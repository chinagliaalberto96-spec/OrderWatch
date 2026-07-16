import { createClient } from "@supabase/supabase-js";

export const AUTH_MODE = import.meta.env.VITE_AUTH_MODE === "supabase" ? "supabase" : "legacy";

let authClient;

export function getAuthClient() {
  if (AUTH_MODE !== "supabase") return null;
  if (authClient) return authClient;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error("Configurazione autenticazione del pilota incompleta.");
  }

  authClient = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  return authClient;
}

export async function getAccessToken() {
  const client = getAuthClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token || null;
}

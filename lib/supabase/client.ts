import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (!browserClient) {
    // trim(): env di Vercel pernah tersimpan dengan newline di ujung. REST
    // aman (header di-trim browser), tapi realtime menaruh apikey di query
    // URL websocket → "...%0A" → Kong 401 dan notifikasi realtime mati.
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!.trim(),
    );
  }

  return browserClient;
}

import { createBrowserClient } from "@supabase/ssr";

type BrowserClient = ReturnType<typeof createBrowserClient>;

declare global {
  var __supabase_browser_client__: BrowserClient | undefined;
}

let browserClient: BrowserClient | null = null;

export function createClient() {
  if (!browserClient && globalThis.__supabase_browser_client__) {
    browserClient = globalThis.__supabase_browser_client__;
  }

  if (browserClient) {
    return browserClient;
  }

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY!,
  );

  globalThis.__supabase_browser_client__ = browserClient;

  return browserClient;
}

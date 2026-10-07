// Status "admin" modul Periodic Maintenance (moderator / service) dibagi ke
// semua halaman /maintenance lewat context, dicek sekali di layout.
// Cuma UX - penjaga sebenarnya RLS & RPC di DB.

"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { fetchHmIsAdmin } from "@/services/hm-maintenance-client";

const HmAdminContext = createContext<{ isAdmin: boolean; checked: boolean }>({
  isAdmin: false,
  checked: false,
});

export function HmAdminProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ isAdmin: false, checked: false });

  useEffect(() => {
    let cancelled = false;
    fetchHmIsAdmin().then((isAdmin) => {
      if (!cancelled) setState({ isAdmin, checked: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <HmAdminContext.Provider value={state}>{children}</HmAdminContext.Provider>;
}

export function useHmAdmin() {
  return useContext(HmAdminContext);
}

// Guard halaman /update-web/buat & /update-web/edit/[id]: hanya moderator
// yang juga punya role "it". Non-publisher dilempar balik ke /update-web.
// Cuma UX - penjaga sebenarnya RLS & RPC di DB.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  fetchUpdateWebViewer,
  UpdateWebViewer,
} from "@/services/update-web-client";

export function useUpdateWebPublisher() {
  const router = useRouter();
  const [viewer, setViewer] = useState<UpdateWebViewer | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUpdateWebViewer()
      .then((v) => {
        if (cancelled) return;
        if (!v?.isPublisher) {
          toast.error(
            "Hanya moderator dengan role IT yang bisa membuat/mengedit Update Web.",
          );
          router.replace("/update-web");
          return;
        }
        setViewer(v);
      })
      .catch(() => {
        if (!cancelled) router.replace("/update-web");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return { viewer, checking: !viewer };
}

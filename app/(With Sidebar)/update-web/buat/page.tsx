// Halaman buat postingan Update Web (khusus publisher). Isian otomatis
// tersimpan sebagai draft, lihat components/update-web/UpdatePostForm.tsx.

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { UpdatePostForm } from "@/components/update-web/UpdatePostForm";
import { useUpdateWebPublisher } from "@/hooks/use-update-web-publisher";
import { fetchHighestUpdateWebVersion } from "@/services/update-web-client";
import { UpdateWebVersion } from "@/type/update-web";

export default function BuatUpdateWebPage() {
  const { viewer, checking } = useUpdateWebPublisher();
  const [latestVersion, setLatestVersion] = useState<UpdateWebVersion | null>(
    null,
  );
  const [loadingLatest, setLoadingLatest] = useState(true);

  useEffect(() => {
    fetchHighestUpdateWebVersion()
      .then(setLatestVersion)
      .catch((error) =>
        toast.error("Gagal memuat versi terakhir", {
          description: error.message,
        }),
      )
      .finally(() => setLoadingLatest(false));
  }, []);

  if (checking || loadingLatest || !viewer) {
    return <Skeleton className="col-span-12 h-[70vh] w-full rounded-xl" />;
  }

  return (
    <UpdatePostForm
      mode="create"
      userId={viewer.userId}
      viewerName={viewer.nama}
      latestVersion={latestVersion}
    />
  );
}

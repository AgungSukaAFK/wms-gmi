// Tombol "Ekspor CSV" (hm.md §8): mengekspor riwayat seluruh unit di site
// terpilih (atau semua site), di halaman mana pun tombolnya berada. Hanya
// dirender untuk admin.

"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildCsvFilename, buildHistoryCsv } from "@/lib/hm";
import { fetchHmHistory } from "@/services/hm-maintenance-client";
import { useHmSite } from "./hm-site-context";

export function HmExportCsvButton() {
  const [busy, setBusy] = useState(false);
  const { siteId } = useHmSite();

  async function handleExport() {
    setBusy(true);
    try {
      const rows = await fetchHmHistory(siteId);
      if (rows.length === 0) {
        toast.info("Tidak ada riwayat untuk diekspor");
        return;
      }
      const blob = new Blob([buildHistoryCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildCsvFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Riwayat diekspor ke CSV");
    } catch {
      toast.error("Gagal mengekspor riwayat. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={busy}>
      <Download className="h-4 w-4" />
      {busy ? "Menyiapkan…" : "Ekspor CSV"}
    </Button>
  );
}

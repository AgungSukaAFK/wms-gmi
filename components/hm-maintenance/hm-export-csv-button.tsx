// Tombol "Ekspor Excel" (hm.md §8, dulu CSV): mengekspor riwayat seluruh unit
// di site terpilih (atau semua site), di halaman mana pun tombolnya berada.
// Hanya dirender untuk admin. Style Excel seragam (lib/excel-styled.ts).

"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { downloadHistoryExcel } from "@/lib/hm-history-export";
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
      await downloadHistoryExcel(rows);
      toast.success(`Riwayat diekspor ke Excel (${rows.length.toLocaleString("id-ID")} baris)`);
    } catch {
      toast.error("Gagal mengekspor riwayat. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={busy}>
      <Download className="h-4 w-4" />
      {busy ? "Menyiapkan…" : "Ekspor Excel"}
    </Button>
  );
}

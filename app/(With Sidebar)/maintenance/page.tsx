// Periodic Maintenance — Jadwal (hm.md §9.2): semua part dari semua unit,
// paling mendesak di atas (status_rank, remaining_hm, id), + ringkasan unit.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Content } from "@/components/content";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatHm, formatRemaining, HmPartView, HmUnitSummary } from "@/lib/hm";
import { fetchHmSchedule, fetchHmUnits } from "@/services/hm-maintenance-client";
import { useHmAdmin } from "@/components/hm-maintenance/hm-admin-context";
import { useHmSite } from "@/components/hm-maintenance/hm-site-context";
import { HmExportCsvButton } from "@/components/hm-maintenance/hm-export-csv-button";
import { HmLoadError, HmPageHeading, HmReloadButton } from "@/components/hm-maintenance/hm-page-heading";
import {
  RailCell,
  ReplacementBadge,
  STATUS_TEXT,
  StatusBadge,
  SummaryStrip,
} from "@/components/hm-maintenance/hm-status";
import { HmUnitGrid } from "@/components/hm-maintenance/hm-unit-grid";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";

export default function MaintenanceSchedulePage() {
  const { isAdmin } = useHmAdmin();
  const { siteId, site, ready } = useHmSite();
  const [schedule, setSchedule] = useState<HmPartView[]>([]);
  const [units, setUnits] = useState<HmUnitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!ready) return;
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    try {
      const [s, u] = await Promise.all([fetchHmSchedule(siteId), fetchHmUnits(siteId)]);
      if (id !== requestId.current) return;
      setSchedule(s);
      setUnits(u);
    } catch {
      if (id === requestId.current) setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [siteId, ready]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      total: schedule.length,
      lewat: schedule.filter((p) => p.status === "lewat").length,
      segera: schedule.filter((p) => p.status === "segera").length,
      aman: schedule.filter((p) => p.status === "aman").length,
    }),
    [schedule],
  );

  return (
    <>
      <HmPageHeading
        label="Jadwal Periodic Maintenance"
        title="Prioritas Penggantian Part"
        subtitle={site ? `Site ${site.nama_cabang}` : "Semua site"}
        description="Part paling mendesak ditampilkan paling atas. Jatuh tempo dihitung dari HM ganti terakhir ditambah interval part."
        actions={
          <>
            {isAdmin && <HmExportCsvButton />}
            <HmReloadButton onClick={load} loading={loading} />
          </>
        }
      />

      <div className="col-span-12">
        <SummaryStrip
          loading={loading}
          stats={[
            { label: "Total Part", value: counts.total },
            { label: "Lewat", value: counts.lewat, status: "lewat" },
            { label: "Segera", value: counts.segera, status: "segera" },
            { label: "Aman", value: counts.aman, status: "aman" },
          ]}
        />
      </div>

      {failed && (
        <HmLoadError message="Gagal memuat jadwal dari backend. Periksa koneksi lalu coba lagi." onRetry={load} />
      )}

      <Content
        title="Tabel Jadwal"
        cardAction={
          <Link href="/maintenance/unit" className="text-sm font-medium text-primary hover:underline">
            Lihat semua unit →
          </Link>
        }
      >
        <div className="rounded-lg border">
          <Table containerClassName="max-h-[65vh] overflow-y-auto">
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
              <TableRow>
                <TableHead className="w-[3px] min-w-[3px] p-0" />
                <TableHead>Part Number</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Interval</TableHead>
                <TableHead className="text-right">HM Ganti Terakhir</TableHead>
                <TableHead className="text-right">HM Jatuh Tempo</TableHead>
                <TableHead className="text-right">Sisa HM</TableHead>
                <TableHead className="text-right">Stock on Hand</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Penggantian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={11}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {!loading && schedule.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center">
                    <CalendarClock className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <div className="font-semibold">Belum ada part terjadwal</div>
                    <div className="text-sm text-muted-foreground">
                      Tambahkan part pada halaman detail unit untuk mulai memantau jatuh tempo.
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                schedule.map((p) => (
                  <TableRow key={p.id}>
                    <RailCell status={p.status} />
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={`/maintenance/unit/${p.unit_id}`}
                        className="font-mono text-sm font-semibold hover:underline"
                      >
                        {p.code || "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="min-w-40 text-muted-foreground">{p.name}</TableCell>
                    <TableCell className="whitespace-nowrap font-medium">{p.unit_code ?? "—"}</TableCell>
                    <TableCell className={NUM}>{formatHm(p.interval_hm)}</TableCell>
                    <TableCell className={NUM}>{formatHm(p.last_replacement_hm)}</TableCell>
                    <TableCell className={NUM}>{formatHm(p.due_hm)}</TableCell>
                    <TableCell className={cn(NUM, "font-semibold", STATUS_TEXT[p.status])}>
                      {formatRemaining(p.remaining_hm)}
                    </TableCell>
                    <TableCell className={NUM}>
                      {p.stock_on_hand === null ? "—" : formatCount(p.stock_on_hand)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell>
                      <ReplacementBadge part={p} />
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Content title="Ringkasan Unit" description={`${formatCount(units.length)} unit`}>
        <HmUnitGrid units={units} loading={loading} />
      </Content>
    </>
  );
}

"use client";

// Dashboard utama. Urutan: sapaan + filter -> yang perlu tindakan ->
// section sesuai role -> ringkasan perusahaan (khusus atasan).
// Semua data datang dari satu RPC (get_main_dashboard_summary) yang dirender
// server; komponen ini hanya menyusun tampilan + interaksi.

import { useMemo } from "react";
import { Building2, CalendarDays, Hourglass, RefreshCw } from "lucide-react";
import { Content } from "@/components/content";
import { QUEUE_CARDS } from "@/components/dashboard/main/config";
import {
  DashboardProvider,
  useDashboard,
} from "@/components/dashboard/main/dashboard-context";
import { DrilldownDialog } from "@/components/dashboard/main/drilldown-dialog";
import { DashboardFilterBar } from "@/components/dashboard/main/filter-bar";
import {
  AgingMatrix,
  ApproverPanel,
  FulfillmentTile,
  LeadTimeTiles,
  MrLocationPanel,
  MrStatusPanel,
  MyApprovalsPanel,
  PipelinePanel,
  PoReceivePanel,
  PoValueTiles,
  RankedPanel,
  StageFlow,
  StockLocationPanel,
  TopPartsPanel,
  TopVendorsPanel,
} from "@/components/dashboard/main/panels";
import {
  num,
  PeriodTile,
  QueueTile,
  SectionHeading,
  StatTile,
  SubCount,
} from "@/components/dashboard/main/primitives";
import { TrendChart } from "@/components/dashboard/main/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UpdateWebDashboardBanner } from "@/components/update-web/UpdateWebDashboardBanner";
import { focusGroupsForRoles } from "@/lib/dashboard/access";
import { formatRangeLabel, type DashboardFilters } from "@/lib/dashboard/filters";
import type { DashboardSummary, ListScope, QueueKey } from "@/lib/dashboard/types";
import { cn, formatDate } from "@/lib/utils";

/** Kartu di dalam grid 2 kolom (bukan grid 12 kolom halaman). */
const IN_GRID = "col-span-1 sm:col-span-1 lg:col-span-1 xl:col-span-1";

/** Hal yang paling mendesak; selalu tampil walau nol supaya "aman" terlihat. */
const ALERT_BASE: QueueKey[] = ["mr_overdue", "po_overdue", "stock_low"];
/** Tampil hanya kalau ada isinya. */
const ALERT_EXTRA: QueueKey[] = [
  "supply_overdue",
  "so_overdue",
  "freeze_open",
  "mr_frozen",
  "invoice_unpaid",
];

function greeting(hour: number) {
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 18) return "Selamat sore";
  return "Selamat malam";
}

function wibHour() {
  return Number(
    new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Jakarta" }),
  ) % 24;
}

export function MainDashboard({
  summary,
  filters,
  scope,
}: {
  summary: DashboardSummary;
  filters: DashboardFilters;
  scope: ListScope;
}) {
  return (
    <DashboardProvider
      filters={filters}
      scope={scope}
      canValue={!!summary.viewer?.can_value}
    >
      <DashboardBody summary={summary} />
      <DrilldownDialog />
    </DashboardProvider>
  );
}

function DashboardBody({ summary }: { summary: DashboardSummary }) {
  const { pending, refresh, scope } = useDashboard();
  const viewer = summary.viewer;
  const isExec = !!viewer?.is_exec;
  const roles = useMemo(() => viewer?.roles ?? [], [viewer]);
  const focusGroups = useMemo(() => focusGroupsForRoles(roles), [roles]);
  const { queue, approval, exec } = summary;

  const cabangNames = useMemo(() => {
    const byId = new Map(summary.cabang_options.map((c) => [c.id, c.nama]));
    return scope.cabangIds.map((id) => byId.get(id) ?? `#${id}`);
  }, [summary.cabang_options, scope.cabangIds]);
  const scopeLabel =
    cabangNames.length === 0
      ? "Semua lokasi"
      : cabangNames.length <= 2
        ? cabangNames.join(", ")
        : `${cabangNames.length} lokasi`;

  const alertKeys = [
    ...ALERT_BASE,
    ...ALERT_EXTRA.filter((k) => (queue[k] ?? 0) > 0),
  ];

  return (
    <>
      {/* ---------- Sapaan + filter ---------- */}
      <Content>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                {greeting(wibHour())},
              </p>
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {viewer?.nama || "Pengguna"}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {viewer?.cabang && (
                  <Badge variant="outline" className="gap-1 font-medium">
                    <Building2 className="h-3 w-3" /> {viewer.cabang}
                  </Badge>
                )}
                {roles.map((r) => (
                  <Badge key={r.name} variant="secondary" className="font-medium">
                    {r.label}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className="h-9 gap-1.5 px-3 font-medium">
                <CalendarDays className="h-3.5 w-3.5" /> {formatDate(summary.today)}
              </Badge>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={refresh}
                disabled={pending}
                aria-label="Muat ulang data"
                title="Muat ulang data"
              >
                <RefreshCw className={cn(pending && "animate-spin")} />
              </Button>
            </div>
          </div>
          <DashboardFilterBar cabangOptions={summary.cabang_options} isExec={isExec} />
        </div>
      </Content>

      <UpdateWebDashboardBanner userId={viewer?.id ?? null} />

      {/* Isi diredupkan selama data baru dimuat (bukan diganti skeleton). */}
      <div
        aria-busy={pending}
        className={cn(
          "col-span-12 grid min-w-0 grid-cols-12 items-start gap-4 transition-opacity md:gap-6 [&>*]:min-w-0",
          pending && "pointer-events-none opacity-60",
        )}
      >
        {/* ---------- Perlu tindakan ---------- */}
        <SectionHeading
          title="Perlu tindakan"
          description={`Kondisi saat ini · ${scopeLabel}. Klik angka untuk melihat daftarnya.`}
        />
        <Content
          size="md"
          title="Menunggu approval Anda"
          description={
            approval.mine > 0
              ? `${num(approval.mine)} dokumen, paling lama menunggu di atas.`
              : "Dokumen yang gilirannya Anda setujui."
          }
        >
          <MyApprovalsPanel rows={approval.mine_rows} total={approval.mine} />
        </Content>
        <div className="col-span-12 grid grid-cols-2 gap-4 lg:col-span-6">
          <ApprovalStaleTile total={approval.total} stale={approval.stale} />
          {alertKeys.map((key) => (
            <QueueTile key={key} queueKey={key} queue={queue} className={IN_GRID} />
          ))}
        </div>

        {/* ---------- Section per role ---------- */}
        {focusGroups.map((group) => (
          <FocusSection key={group.key} group={group} summary={summary} isExec={isExec} />
        ))}

        {/* ---------- Alur procurement (semua user) ---------- */}
        <SectionHeading
          title="Alur procurement"
          description="Dokumen yang sedang tertahan di tiap tahap MR sampai barang diterima."
        />
        <Content>
          <StageFlow queue={queue} />
        </Content>

        {exec ? (
          <ExecutiveSections summary={summary} />
        ) : focusGroups.length === 0 ? (
          <GeneralTiles summary={summary} />
        ) : null}
      </div>
    </>
  );
}

function ApprovalStaleTile({ total, stale }: { total: number; stale: number }) {
  const { openList } = useDashboard();
  return (
    <StatTile
      className={IN_GRID}
      label="Approval tertahan > 7 hari"
      value={num(stale)}
      hint={`Dari ${num(total)} dokumen yang menunggu approval`}
      icon={Hourglass}
      tone="critical"
      active={stale > 0}
      onClick={() =>
        openList(
          "approval_pending",
          stale > 0 ? { stale: "1" } : {},
          stale > 0 ? "Approval tertahan lebih dari 7 hari" : undefined,
        )
      }
      actionLabel={stale > 0 ? "Lihat daftar" : "Lihat semua antrian"}
    />
  );
}

function FocusSection({
  group,
  summary,
  isExec,
}: {
  group: ReturnType<typeof focusGroupsForRoles>[number];
  summary: DashboardSummary;
  isExec: boolean;
}) {
  const { queue, period } = summary;
  return (
    <>
      <SectionHeading
        id={`fokus-${group.key}`}
        title={`Fokus ${group.title}`}
        description={group.description}
      />
      {group.cards.map((key) => (
        <QueueTile key={key} queueKey={key} queue={queue}>
          {key === "it_active" && (
            <>
              <SubCount label="Packing" value={queue.it_packing} />
              <SubCount label="Dalam perjalanan" value={queue.it_in_transit} />
              <SubCount label="Sampai, belum diterima" value={queue.it_delivered} />
            </>
          )}
        </QueueTile>
      ))}
      {group.period.map((key) => (
        <PeriodTile key={key} periodKey={key} period={period} />
      ))}
      {/* Nilai PO hanya untuk purchasing; atasan melihatnya di ringkasan. */}
      {group.key === "purchasing" && summary.po_value && !isExec && (
        <PoValueTiles rows={summary.po_value} />
      )}
    </>
  );
}

/** User tanpa role berfokus (mis. IT, vendor): ringkasan umum lokasinya. */
function GeneralTiles({ summary }: { summary: DashboardSummary }) {
  const { queue, period } = summary;
  return (
    <>
      <SectionHeading title="Ringkasan" description="Aktivitas dan antrian di lokasi Anda." />
      <PeriodTile periodKey="mr" period={period} />
      <PeriodTile periodKey="po" period={period} />
      <QueueTile queueKey="it_active" queue={queue} />
      <QueueTile queueKey="stock_low" queue={queue} />
    </>
  );
}

function ExecutiveSections({ summary }: { summary: DashboardSummary }) {
  const { filters } = useDashboard();
  const { queue, approval, period, po_value } = summary;
  const exec = summary.exec!;

  return (
    <>
      {/* ---------- Kinerja periode ---------- */}
      <SectionHeading
        id="kinerja"
        title="Kinerja periode"
        description={`${formatRangeLabel(summary.date_from, summary.date_to)}, dibanding periode sebelumnya.`}
      />
      <PeriodTile periodKey="mr" period={period} />
      <PeriodTile periodKey="pr" period={period} />
      <PeriodTile periodKey="po" period={period} />
      <PeriodTile periodKey="ri" period={period} />
      <LeadTimeTiles data={exec.lead_time} />
      <FulfillmentTile data={period.mr_fulfillment} />
      {po_value && <PoValueTiles rows={po_value} />}

      <Content
        size="md"
        className="lg:col-span-7"
        title="Tren dokumen"
        description={`Jumlah dokumen per tanggal dokumen, ${formatRangeLabel(exec.trend_from, summary.date_to)}. Klik legend untuk sembunyikan seri.`}
      >
        <TrendChart points={exec.trend} from={exec.trend_from} to={summary.date_to} />
      </Content>
      <Content
        size="md"
        className="lg:col-span-5"
        title="Level MR aktif"
        description="Posisi semua MR yang masih berjalan. Klik level untuk melihat MR-nya."
      >
        <PipelinePanel pipeline={exec.mr_pipeline} />
      </Content>

      <Content size="md" title="Status MR periode ini" description="Klik baris untuk melihat MR-nya.">
        <MrStatusPanel data={period.mr_status} />
      </Content>
      <Content
        size="md"
        title="Penerimaan PO periode ini"
        description="PO (tanpa yang ditolak) menurut status penerimaan barangnya."
      >
        <PoReceivePanel data={period.po_receive} />
      </Content>

      {/* ---------- Bottleneck approval ---------- */}
      <SectionHeading
        id="approval"
        title="Bottleneck approval"
        description="Dokumen yang menunggu approval, menurut umur dan orang yang gilirannya menyetujui."
      />
      <Content
        size="md"
        className="lg:col-span-7"
        title="Umur antrian approval"
        description="Dihitung sejak langkah approval sebelumnya selesai. Klik angka untuk melihat dokumennya."
      >
        <AgingMatrix rows={approval.aging ?? []} />
      </Content>
      <Content
        size="md"
        className="lg:col-span-5"
        title="Approver dengan antrian terbanyak"
        description="Klik nama untuk melihat dokumen yang menunggunya."
      >
        <ApproverPanel rows={approval.approvers ?? []} />
      </Content>

      {/* ---------- Lokasi & stok ---------- */}
      <SectionHeading
        id="lokasi"
        title="Lokasi & stok"
        description="Klik nama lokasi untuk memfilter seluruh dashboard ke lokasi itu."
      />
      <Content size="md" title="MR aktif per lokasi" description="MR open/approved, dipisah yang sudah lewat due date.">
        <MrLocationPanel rows={exec.mr_by_cabang} />
      </Content>
      <Content
        size="md"
        title="Kondisi stok per lokasi"
        description="Hanya barang yang sudah punya batas min/max."
      >
        <StockLocationPanel rows={exec.stock_by_cabang} />
      </Content>
      <QueueTile queueKey="stock_low" queue={queue}>
        <SubCount label="Barang ber-min/max" value={queue.stock_tracked} />
      </QueueTile>
      <QueueTile queueKey="stock_over" queue={queue} />
      <QueueTile queueKey="it_active" queue={queue}>
        <SubCount label="Packing" value={queue.it_packing} />
        <SubCount label="Dalam perjalanan" value={queue.it_in_transit} />
        <SubCount label="Sampai, belum diterima" value={queue.it_delivered} />
      </QueueTile>
      <QueueTile queueKey="supply_in_transit" queue={queue}>
        <SubCount label="Lewat deadline" value={queue.supply_overdue} />
      </QueueTile>

      {/* ---------- Permintaan & pembelian ---------- */}
      <SectionHeading
        id="analisis"
        title="Permintaan & pembelian"
        description={`Periode ${formatRangeLabel(summary.date_from, summary.date_to)}.`}
      />
      <Content size="sm" title="MR per kategori" description="Klik untuk memfilter dashboard.">
        <RankedPanel
          rows={exec.mr_by_kategori}
          unit="MR"
          emptyText="Tidak ada MR pada periode ini."
          filterKey="kategori"
          selected={filters.kategori}
        />
      </Content>
      <Content size="sm" title="Item MR per prioritas" description="Klik untuk memfilter dashboard.">
        <RankedPanel
          rows={exec.mr_by_priority}
          unit="item"
          emptyText="Tidak ada item MR pada periode ini."
          filterKey="prioritas"
          selected={filters.priorities}
        />
      </Content>
      <Content size="sm" title="Vendor teratas" description="Berdasarkan jumlah PO.">
        <TopVendorsPanel rows={exec.top_vendors} />
      </Content>
      <Content
        size="md"
        title="Barang paling sering diminta"
        description="Berdasarkan jumlah MR yang memuat barang tersebut."
      >
        <TopPartsPanel rows={exec.top_parts} />
      </Content>
      <Content size="md" title="Produksi" description="Working Order dan Job Costing yang masih berjalan.">
        <div className="grid grid-cols-3 gap-2">
          <MiniStat queueKey="wo_pending" value={queue.wo_pending} label="WO menunggu approval" />
          <MiniStat queueKey="wo_on_process" value={queue.wo_on_process} label="WO dikerjakan" />
          <MiniStat queueKey="jc_open" value={queue.jc_open} label="Job Costing terbuka" />
        </div>
      </Content>

      {/* ---------- Penjualan ---------- */}
      <SectionHeading
        id="penjualan"
        title="Penjualan & stock out"
        description="SPB project, SO/DO Reguler, dan penagihan."
      />
      <PeriodTile periodKey="spb" period={period} />
      <QueueTile queueKey="spb_belum_po" queue={queue}>
        <SubCount label="Sudah PO, belum DO" value={queue.spb_po_belum_do} />
        <SubCount label="Sudah DO, belum invoice" value={queue.spb_do_belum_invoice} />
      </QueueTile>
      <QueueTile queueKey="invoice_unpaid" queue={queue}>
        <SubCount label="Menunggu approval" value={queue.invoice_open} />
      </QueueTile>
      <QueueTile queueKey="so_active" queue={queue}>
        <SubCount label="Lewat due date" value={queue.so_overdue} />
        <SubCount label="DO Reguler berjalan" value={queue.do_active} />
      </QueueTile>
    </>
  );
}

function MiniStat({ queueKey, value, label }: { queueKey: QueueKey; value: number; label: string }) {
  const { openList } = useDashboard();
  const Icon = QUEUE_CARDS[queueKey].icon;
  return (
    <button
      type="button"
      onClick={() => openList(queueKey)}
      className="flex cursor-pointer flex-col items-start gap-1 rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className={cn("text-xl font-semibold", value === 0 && "text-muted-foreground")}>
        {num(value)}
      </span>
      <span className="text-xs leading-snug text-muted-foreground">{label}</span>
    </button>
  );
}

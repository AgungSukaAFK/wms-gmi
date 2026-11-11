"use client";

// Dashboard utama. Urutan: sapaan + filter -> yang perlu tindakan ->
// section sesuai role -> ringkasan perusahaan (khusus atasan).
//
// Data datang per bagian: "core" sudah ada saat halaman dirender; "period",
// "exec_a", "exec_b" berupa promise yang dibaca dengan use() di dalam
// <Suspense>, jadi bagian atas tampil duluan dan bagian yang gagal hanya
// menampilkan error di kartunya sendiri.

import { Suspense, use, useMemo } from "react";
import { Building2, CalendarDays, Hourglass, RefreshCw } from "lucide-react";
import { Content } from "@/components/content";
import {
  DashboardProvider,
  useDashboard,
  type DashboardParts,
} from "@/components/dashboard/main/dashboard-context";
import { DrilldownDialog } from "@/components/dashboard/main/drilldown-dialog";
import { DashboardFilterBar } from "@/components/dashboard/main/filter-bar";
import {
  AgingMatrix,
  ApproverPanel,
  FulfillmentCell,
  LeadTimeCells,
  MrLocationPanel,
  MrStatusPanel,
  MyApprovalsPanel,
  PipelinePanel,
  PoReceivePanel,
  PoValueCells,
  RankedPanel,
  StageFlow,
  StockLocationPanel,
  TopPartsPanel,
  TopVendorsPanel,
} from "@/components/dashboard/main/panels";
import {
  CellSkeleton,
  MetricCell,
  MetricGrid,
  num,
  Panel,
  PanelSkeleton,
  PartError,
  PeriodCell,
  QueueCell,
  SectionHeading,
  SubCount,
} from "@/components/dashboard/main/primitives";
import { TrendChart } from "@/components/dashboard/main/trend-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UpdateWebDashboardBanner } from "@/components/update-web/UpdateWebDashboardBanner";
import { focusGroupsForRoles, type FocusGroup } from "@/lib/dashboard/access";
import { formatRangeLabel, type DashboardFilters } from "@/lib/dashboard/filters";
import type {
  DashboardCore,
  DashboardExecA,
  DashboardExecB,
  DashboardPeriodPart,
  ListScope,
  PartResult,
  QueueKey,
} from "@/lib/dashboard/types";
import { cn, formatDate } from "@/lib/utils";

/** Peringatan "Perlu tindakan": selalu 6 sel (nol = aman, tetap tampil). */
const ALERTS: QueueKey[] = ["mr_overdue", "po_overdue", "stock_low", "supply_overdue", "mr_frozen"];

function greeting(hour: number) {
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 18) return "Selamat sore";
  return "Selamat malam";
}

function wibHour() {
  return (
    Number(
      new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Jakarta" }),
    ) % 24
  );
}

export function MainDashboard({
  core,
  filters,
  scope,
  parts,
}: {
  core: DashboardCore;
  filters: DashboardFilters;
  scope: ListScope;
  parts: DashboardParts;
}) {
  return (
    <DashboardProvider
      filters={filters}
      scope={scope}
      canValue={!!core.viewer?.can_value}
      parts={parts}
    >
      <DashboardBody core={core} />
      <DrilldownDialog />
    </DashboardProvider>
  );
}

// ------------------------------------------------------------------
// Pemuat bagian yang menyusul
// ------------------------------------------------------------------

/** Suspense yang di-reset tiap filter berubah (skeleton tampil lagi). */
function Deferred({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  const { dataKey } = useDashboard();
  return (
    <Suspense key={dataKey} fallback={fallback}>
      {children}
    </Suspense>
  );
}

type PanelProps = React.ComponentProps<typeof Panel>;

/** Panel yang isinya menunggu satu bagian data. */
function PartPanel<T>({
  promise,
  render,
  skeletonRows = 5,
  ...panel
}: Omit<PanelProps, "children"> & {
  promise: Promise<PartResult<T>>;
  render: (data: T) => React.ReactNode;
  skeletonRows?: number;
}) {
  return (
    <Deferred fallback={<PanelSkeleton span={panel.span} title={panel.title} rows={skeletonRows} />}>
      <PartPanelBody promise={promise} render={render} {...panel} />
    </Deferred>
  );
}

function PartPanelBody<T>({
  promise,
  render,
  ...panel
}: Omit<PanelProps, "children"> & {
  promise: Promise<PartResult<T>>;
  render: (data: T) => React.ReactNode;
}) {
  const result = use(promise);
  return (
    <Panel {...panel}>
      {result.error || !result.data ? (
        <PartError message={result.error ?? "Data tidak tersedia."} />
      ) : (
        render(result.data)
      )}
    </Panel>
  );
}

/** Sel-sel grid yang menunggu satu bagian data. */
function PartCells<T>({
  promise,
  count,
  render,
}: {
  promise: Promise<PartResult<T>>;
  count: number;
  render: (data: T) => React.ReactNode;
}) {
  const skeleton = Array.from({ length: count }).map((_, i) => <CellSkeleton key={i} />);
  return (
    <Deferred fallback={<>{skeleton}</>}>
      <PartCellsBody promise={promise} count={count} render={render} />
    </Deferred>
  );
}

function PartCellsBody<T>({
  promise,
  count,
  render,
}: {
  promise: Promise<PartResult<T>>;
  count: number;
  render: (data: T) => React.ReactNode;
}) {
  const result = use(promise);
  if (result.error || !result.data) {
    return (
      <>
        {Array.from({ length: count }).map((_, i) => (
          <MetricCell key={i} label="Gagal dimuat" value="-" hint={result.error ?? undefined} active={false} />
        ))}
      </>
    );
  }
  return <>{render(result.data)}</>;
}

// Ambil isi exec dari hasil bagian (null untuk non-atasan).
const execA = (d: { exec: DashboardExecA | null }) => d.exec;
const execB = (d: { exec: DashboardExecB | null }) => d.exec;

// ------------------------------------------------------------------
// Halaman
// ------------------------------------------------------------------

function DashboardBody({ core }: { core: DashboardCore }) {
  const { pending, refresh, scope, parts } = useDashboard();
  const viewer = core.viewer;
  const isExec = !!viewer?.is_exec;
  const roles = useMemo(() => viewer?.roles ?? [], [viewer]);
  const focusGroups = useMemo(() => focusGroupsForRoles(roles), [roles]);
  const { queue, approval } = core;

  const scopeLabel = useMemo(() => {
    const byId = new Map(core.cabang_options.map((c) => [c.id, c.nama]));
    const names = scope.cabangIds.map((id) => byId.get(id) ?? `#${id}`);
    if (names.length === 0) return "Semua lokasi";
    if (names.length <= 2) return names.join(", ");
    return `${names.length} lokasi`;
  }, [core.cabang_options, scope.cabangIds]);

  return (
    <>
      {/* ---------- Sapaan + filter ---------- */}
      <Content className="gap-0 py-4 sm:py-5 [&>[data-slot=card-content]]:px-4 sm:[&>[data-slot=card-content]]:px-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                <span className="font-normal text-muted-foreground" suppressHydrationWarning>
                  {greeting(wibHour())},{" "}
                </span>
                {viewer?.nama || "Pengguna"}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
                <CalendarDays className="h-3.5 w-3.5" /> {formatDate(core.today)}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={refresh}
                disabled={pending}
                aria-label="Muat ulang data"
                title="Muat ulang data"
              >
                <RefreshCw className={cn(pending && "animate-spin")} />
                <span className="hidden sm:inline">Muat ulang</span>
              </Button>
            </div>
          </div>
          <DashboardFilterBar cabangOptions={core.cabang_options} isExec={isExec} />
        </div>
      </Content>

      <UpdateWebDashboardBanner userId={viewer?.id ?? null} />

      {/* Isi diredupkan selama data baru dimuat (bukan diganti skeleton). */}
      <div
        aria-busy={pending}
        className={cn(
          "col-span-12 grid min-w-0 grid-cols-12 items-stretch gap-4 transition-opacity md:gap-5 *:min-w-0",
          pending && "pointer-events-none opacity-60",
        )}
      >
        {/* ---------- Perlu tindakan ---------- */}
        <SectionHeading
          title="Perlu tindakan"
          description={`Kondisi saat ini · ${scopeLabel}. Klik angka untuk melihat daftarnya.`}
        />
        <Panel
          span={5}
          title="Menunggu approval Anda"
          description={
            approval.mine > 0
              ? `${num(approval.mine)} dokumen, paling lama di atas.`
              : "Dokumen yang gilirannya Anda setujui."
          }
        >
          <MyApprovalsPanel rows={approval.mine_rows} total={approval.mine} />
        </Panel>
        <Panel span={7} fill title="Peringatan" description="Hal yang sudah lewat batas waktu atau batas stok.">
          <MetricGrid fill count={ALERTS.length + 1}>
            <ApprovalStaleCell total={approval.total} stale={approval.stale} />
            {ALERTS.map((key) => (
              <QueueCell key={key} queueKey={key} queue={queue} />
            ))}
          </MetricGrid>
        </Panel>

        {/* ---------- Section per role ---------- */}
        {focusGroups.map((group) => (
          <FocusPanel key={group.key} group={group} core={core} parts={parts} isExec={isExec} />
        ))}

        {/* ---------- Alur procurement (semua user) ---------- */}
        <Panel
          title="Alur procurement"
          description="Dokumen yang sedang tertahan di tiap tahap, dari MR sampai barang diterima."
        >
          <StageFlow queue={queue} />
        </Panel>

        {isExec && parts.execA && parts.execB ? (
          <ExecutiveSections core={core} parts={{ period: parts.period, execA: parts.execA, execB: parts.execB }} />
        ) : focusGroups.length === 0 ? (
          <GeneralPanel core={core} />
        ) : null}
      </div>
    </>
  );
}

function ApprovalStaleCell({ total, stale }: { total: number; stale: number }) {
  const { openList } = useDashboard();
  return (
    <MetricCell
      label="Approval tertahan > 7 hari"
      value={num(stale)}
      hint={`Dari ${num(total)} dokumen menunggu`}
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
    />
  );
}

function FocusPanel({
  group,
  core,
  parts,
  isExec,
}: {
  group: FocusGroup;
  core: DashboardCore;
  parts: DashboardParts;
  isExec: boolean;
}) {
  const { canValue } = useDashboard();
  // Nilai PO hanya untuk purchasing; atasan melihatnya di "Kinerja periode".
  const withValue = group.key === "purchasing" && canValue && !isExec;
  const count = group.cards.length + group.period.length + (withValue ? 2 : 0);
  const { queue } = core;

  return (
    <Panel title={`Fokus ${group.title}`} description={group.description}>
      <MetricGrid count={count}>
        {group.cards.map((key) => (
          <QueueCell key={key} queueKey={key} queue={queue}>
            {key === "it_active" && (
              <>
                <SubCount label="Packing" value={queue.it_packing} />
                <SubCount label="Dalam perjalanan" value={queue.it_in_transit} />
                <SubCount label="Sampai, belum diterima" value={queue.it_delivered} />
              </>
            )}
          </QueueCell>
        ))}
        {group.period.map((key) => (
          <Deferred key={key} fallback={<CellSkeleton />}>
            <PeriodCell periodKey={key} />
          </Deferred>
        ))}
        {withValue && (
          <PartCells
            promise={parts.period}
            count={2}
            render={(d: DashboardPeriodPart) => <PoValueCells rows={d.po_value ?? []} />}
          />
        )}
      </MetricGrid>
    </Panel>
  );
}

/** User tanpa role berfokus (mis. IT, vendor): ringkasan umum lokasinya. */
function GeneralPanel({ core }: { core: DashboardCore }) {
  return (
    <Panel title="Ringkasan" description="Aktivitas dan antrian di lokasi Anda.">
      <MetricGrid count={4}>
        <Deferred fallback={<CellSkeleton />}>
          <PeriodCell periodKey="mr" />
        </Deferred>
        <Deferred fallback={<CellSkeleton />}>
          <PeriodCell periodKey="po" />
        </Deferred>
        <QueueCell queueKey="it_active" queue={core.queue} />
        <QueueCell queueKey="stock_low" queue={core.queue} />
      </MetricGrid>
    </Panel>
  );
}

function ExecutiveSections({
  core,
  parts,
}: {
  core: DashboardCore;
  parts: {
    period: DashboardParts["period"];
    execA: NonNullable<DashboardParts["execA"]>;
    execB: NonNullable<DashboardParts["execB"]>;
  };
}) {
  const { filters, canValue } = useDashboard();
  const { queue } = core;
  const range = formatRangeLabel(core.date_from, core.date_to);

  return (
    <>
      {/* ---------- Kinerja periode ---------- */}
      <SectionHeading
        id="kinerja"
        title="Kinerja periode"
        description={`${range}, dibanding periode sebelumnya.`}
      />
      <Panel>
        <MetricGrid count={canValue ? 10 : 8}>
          {(["mr", "pr", "po", "ri"] as const).map((key) => (
            <Deferred key={key} fallback={<CellSkeleton />}>
              <PeriodCell periodKey={key} />
            </Deferred>
          ))}
          <PartCells
            promise={parts.execA}
            count={3}
            render={(d) => {
              const exec = execA(d);
              return exec ? <LeadTimeCells data={exec.lead_time} /> : null;
            }}
          />
          <PartCells
            promise={parts.period}
            count={1}
            render={(d) => <FulfillmentCell data={d.period.mr_fulfillment} />}
          />
          {canValue && (
            <PartCells
              promise={parts.period}
              count={2}
              render={(d) => <PoValueCells rows={d.po_value ?? []} />}
            />
          )}
        </MetricGrid>
      </Panel>

      <PartPanel
        span={7}
        title="Tren dokumen"
        description="Jumlah dokumen per tanggal dokumen. Klik legend untuk menyembunyikan seri."
        promise={parts.execA}
        skeletonRows={6}
        render={(d) => {
          const exec = execA(d);
          return exec ? (
            <TrendChart points={exec.trend} from={exec.trend_from ?? d.trend_from} to={d.date_to} />
          ) : null;
        }}
      />
      <PartPanel
        span={5}
        title="Level MR aktif"
        description="Posisi semua MR yang masih berjalan. Klik level untuk melihat MR-nya."
        promise={parts.execA}
        skeletonRows={6}
        render={(d) => {
          const exec = execA(d);
          return exec ? <PipelinePanel pipeline={exec.mr_pipeline} /> : null;
        }}
      />

      <PartPanel
        span={6}
        title="Status MR periode ini"
        description="Klik baris untuk melihat MR-nya."
        promise={parts.period}
        skeletonRows={4}
        render={(d) => <MrStatusPanel data={d.period.mr_status} />}
      />
      <PartPanel
        span={6}
        title="Penerimaan PO periode ini"
        description="PO (tanpa yang ditolak) menurut status penerimaan barangnya."
        promise={parts.period}
        skeletonRows={4}
        render={(d) => <PoReceivePanel data={d.period.po_receive} />}
      />

      {/* ---------- Bottleneck approval ---------- */}
      <SectionHeading
        id="approval"
        title="Bottleneck approval"
        description="Dokumen yang menunggu approval, menurut umur dan orang yang gilirannya menyetujui."
      />
      <PartPanel
        span={7}
        title="Umur antrian approval"
        description="Dihitung sejak langkah approval sebelumnya selesai. Klik angka untuk melihat dokumennya."
        promise={parts.execA}
        render={(d) => <AgingMatrix rows={execA(d)?.approval.aging ?? []} />}
      />
      <PartPanel
        span={5}
        title="Approver dengan antrian terbanyak"
        description="Klik nama untuk melihat dokumen yang menunggunya."
        promise={parts.execA}
        render={(d) => <ApproverPanel rows={execA(d)?.approval.approvers ?? []} />}
      />

      {/* ---------- Lokasi & stok ---------- */}
      <SectionHeading
        id="lokasi"
        title="Lokasi & stok"
        description="Klik nama lokasi untuk memfilter seluruh dashboard ke lokasi itu."
      />
      <PartPanel
        span={6}
        title="MR aktif per lokasi"
        description="MR open/approved, dipisah yang sudah lewat due date."
        promise={parts.execB}
        skeletonRows={7}
        render={(d) => <MrLocationPanel rows={execB(d)?.mr_by_cabang ?? []} />}
      />
      <PartPanel
        span={6}
        title="Kondisi stok per lokasi"
        description="Hanya barang yang sudah punya batas min/max."
        promise={parts.execB}
        skeletonRows={7}
        render={(d) => <StockLocationPanel rows={execB(d)?.stock_by_cabang ?? []} />}
      />
      <Panel title="Stok & pengiriman" description="Kondisi saat ini.">
        <MetricGrid count={6}>
          <QueueCell queueKey="stock_low" queue={queue}>
            <SubCount label="Barang ber-min/max" value={queue.stock_tracked} />
          </QueueCell>
          <QueueCell queueKey="stock_over" queue={queue} />
          <QueueCell queueKey="it_active" queue={queue}>
            <SubCount label="Dalam perjalanan" value={queue.it_in_transit} />
            <SubCount label="Sampai, belum diterima" value={queue.it_delivered} />
          </QueueCell>
          <QueueCell queueKey="dlv_ongoing" queue={queue} />
          <QueueCell queueKey="supply_in_transit" queue={queue}>
            <SubCount label="Lewat deadline" value={queue.supply_overdue} />
          </QueueCell>
          <QueueCell queueKey="stock_request_open" queue={queue} />
        </MetricGrid>
      </Panel>

      {/* ---------- Permintaan & pembelian ---------- */}
      <SectionHeading id="analisis" title="Permintaan & pembelian" description={`Periode ${range}.`} />
      <PartPanel
        span={6}
        title="MR per kategori"
        description="Klik untuk memfilter dashboard."
        promise={parts.execB}
        skeletonRows={4}
        render={(d) => (
          <RankedPanel
            rows={execB(d)?.mr_by_kategori ?? []}
            unit="MR"
            emptyText="Tidak ada MR pada periode ini."
            filterKey="kategori"
            selected={filters.kategori}
          />
        )}
      />
      <PartPanel
        span={6}
        title="Item MR per prioritas"
        description="Klik untuk memfilter dashboard."
        promise={parts.execB}
        skeletonRows={4}
        render={(d) => (
          <RankedPanel
            rows={execB(d)?.mr_by_priority ?? []}
            unit="item"
            emptyText="Tidak ada item MR pada periode ini."
            filterKey="prioritas"
            selected={filters.priorities}
          />
        )}
      />
      <PartPanel
        span={6}
        title="Barang paling sering diminta"
        description="Berdasarkan jumlah MR yang memuat barang tersebut."
        promise={parts.execB}
        skeletonRows={8}
        render={(d) => <TopPartsPanel rows={execB(d)?.top_parts ?? []} />}
      />
      <PartPanel
        span={6}
        title="Vendor teratas"
        description="Berdasarkan jumlah PO pada periode ini."
        promise={parts.execB}
        skeletonRows={8}
        render={(d) => <TopVendorsPanel rows={execB(d)?.top_vendors ?? []} />}
      />

      {/* ---------- Penjualan & produksi ---------- */}
      <SectionHeading
        id="penjualan"
        title="Penjualan & produksi"
        description="SPB project, SO/DO Reguler, penagihan, Working Order, dan Job Costing."
      />
      <Panel span={8} title="Penjualan & stock out">
        <MetricGrid count={6}>
          <Deferred fallback={<CellSkeleton />}>
            <PeriodCell periodKey="spb" />
          </Deferred>
          <QueueCell queueKey="spb_belum_po" queue={queue} />
          <QueueCell queueKey="spb_po_belum_do" queue={queue} />
          <QueueCell queueKey="spb_do_belum_invoice" queue={queue} />
          <QueueCell queueKey="invoice_unpaid" queue={queue}>
            <SubCount label="Menunggu approval" value={queue.invoice_open} />
          </QueueCell>
          <QueueCell queueKey="so_active" queue={queue}>
            <SubCount label="Lewat due date" value={queue.so_overdue} />
            <SubCount label="DO Reguler berjalan" value={queue.do_active} />
          </QueueCell>
        </MetricGrid>
      </Panel>
      <Panel span={4} title="Produksi">
        <MetricGrid count={4}>
          <Deferred fallback={<CellSkeleton />}>
            <PeriodCell periodKey="wo" />
          </Deferred>
          <QueueCell queueKey="wo_pending" queue={queue} label="WO menunggu approval" />
          <QueueCell queueKey="wo_on_process" queue={queue} label="WO dikerjakan" />
          <QueueCell queueKey="jc_open" queue={queue} />
        </MetricGrid>
      </Panel>
    </>
  );
}

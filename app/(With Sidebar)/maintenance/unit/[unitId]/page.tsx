// Periodic Maintenance — Detail Unit (hm.md §9.4): HM terkini, ringkasan
// status, daftar part & interval (urut id), riwayat penggantian per part,
// dan riwayat servis umum. Setelah mutasi apa pun, semua data dimuat ulang.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ClipboardList,
  Gauge,
  History,
  Package,
  Pencil,
  Plus,
  Trash2,
  Warehouse,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCount,
  formatDate,
  formatHm,
  formatRemaining,
  HmPartView,
  HmServiceRecord,
  HmUnit,
  SERVICE_KIND_LABEL,
} from "@/lib/hm";
import {
  deleteHmPart,
  deleteHmUnit,
  fetchHmServices,
  fetchHmUnitDetail,
} from "@/services/hm-maintenance-client";
import { useHmAdmin } from "@/components/hm-maintenance/hm-admin-context";
import { useHmSite } from "@/components/hm-maintenance/hm-site-context";
import {
  HmDeleteDialog,
  HmPartFormDialog,
  HmReplacementFormDialog,
  HmReplacementHistoryDialog,
  HmServiceFormDialog,
  HmUnitFormDialog,
  HmUpdateHmDialog,
} from "@/components/hm-maintenance/hm-dialogs";
import { HmExportCsvButton } from "@/components/hm-maintenance/hm-export-csv-button";
import { HmLoadError, HmPageHeading } from "@/components/hm-maintenance/hm-page-heading";
import {
  RailCell,
  ReplacementBadge,
  STATUS_TEXT,
  StatusBadge,
  SummaryStrip,
} from "@/components/hm-maintenance/hm-status";

const NUM = "text-right font-mono tabular-nums whitespace-nowrap";

type Detail = { unit: HmUnit; cabangName: string | null; parts: HmPartView[] };

export default function MaintenanceUnitDetailPage() {
  const params = useParams<{ unitId: string }>();
  const router = useRouter();
  const unitId = /^\d+$/.test(params.unitId ?? "") ? Number(params.unitId) : null;
  const { isAdmin } = useHmAdmin();
  const { reloadSites } = useHmSite();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [services, setServices] = useState<HmServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  // Dialog state
  const [unitFormOpen, setUnitFormOpen] = useState(false);
  const [hmOpen, setHmOpen] = useState(false);
  const [deleteUnitOpen, setDeleteUnitOpen] = useState(false);
  const [partFormOpen, setPartFormOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<HmPartView | null>(null);
  const [deletingPart, setDeletingPart] = useState<HmPartView | null>(null);
  const [historyPart, setHistoryPart] = useState<HmPartView | null>(null);
  const [replacingPart, setReplacingPart] = useState<HmPartView | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);

  const load = useCallback(async () => {
    if (unitId === null) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    try {
      const [d, s] = await Promise.all([fetchHmUnitDetail(unitId), fetchHmServices(unitId)]);
      if (id !== requestId.current) return;
      setDetail(d);
      setServices(s);
    } catch {
      if (id === requestId.current) setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const parts = detail?.parts ?? [];
    return {
      total: parts.length,
      lewat: parts.filter((p) => p.status === "lewat").length,
      segera: parts.filter((p) => p.status === "segera").length,
      aman: parts.filter((p) => p.status === "aman").length,
      notReplaced: parts.filter((p) => !p.replaced_this_interval).length,
    };
  }, [detail]);

  if (!loading && !failed && (unitId === null || !detail)) {
    return (
      <div className="col-span-12 flex flex-col items-center gap-2 rounded-lg border border-dashed bg-card py-16 text-center">
        <Package className="h-10 w-10 text-muted-foreground" />
        <div className="text-lg font-semibold">Unit tidak ditemukan</div>
        <div className="text-sm text-muted-foreground">Unit mungkin sudah dihapus atau tautan tidak valid.</div>
        <Button asChild variant="outline" className="mt-2">
          <Link href="/maintenance/unit">Kembali ke Daftar Unit</Link>
        </Button>
      </div>
    );
  }

  const unit = detail?.unit ?? null;

  return (
    <>
      <div className="col-span-12">
        <Link
          href="/maintenance/unit"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Semua Unit
        </Link>
      </div>

      {loading && !unit ? (
        <div className="col-span-12 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : unit ? (
        <HmPageHeading
          label={unit.model}
          title={unit.code}
          subtitle={unit.name}
          actions={
            isAdmin && (
              <>
                <HmExportCsvButton />
                <Button variant="outline" size="sm" onClick={() => setUnitFormOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  Ubah Unit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteUnitOpen(true)}>
                  <Trash2 className="h-4 w-4" />
                  Hapus Unit
                </Button>
              </>
            )
          }
        />
      ) : null}

      {failed && <HmLoadError message="Gagal memuat detail unit dari backend." onRetry={load} />}

      {/* Panel HM terkini */}
      <div className="col-span-12 grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col justify-between gap-3 rounded-lg border bg-card p-4">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              HM Terkini Unit
            </div>
            {loading && !unit ? (
              <Skeleton className="mt-2 h-9 w-36" />
            ) : (
              <div className="mt-1 font-mono text-3xl font-bold tabular-nums">
                {unit ? formatHm(unit.current_hm) : "—"}
              </div>
            )}
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Warehouse className="h-3.5 w-3.5" />
              Site / Gudang: {detail?.cabangName ?? "Belum ditentukan (stok = total semua gudang)"}
            </div>
          </div>
          {isAdmin ? (
            <Button size="sm" className="self-start" onClick={() => setHmOpen(true)} disabled={!unit}>
              Perbarui HM
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Masuk sebagai admin untuk memperbarui HM.</p>
          )}
        </div>
        <div className="lg:col-span-2">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">Ringkasan Status Part</div>
          <SummaryStrip
            loading={loading && !unit}
            stats={[
              { label: "Total Part", value: counts.total },
              { label: "Lewat", value: counts.lewat, status: "lewat" },
              { label: "Segera", value: counts.segera, status: "segera" },
              { label: "Aman", value: counts.aman, status: "aman" },
              { label: "Belum diganti", value: counts.notReplaced },
            ]}
          />
        </div>
      </div>

      {/* Daftar part */}
      <Content
        title="Daftar Part & Interval"
        description="Jatuh tempo = HM ganti terakhir + interval part"
        cardAction={
          isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setEditingPart(null);
                setPartFormOpen(true);
              }}
              disabled={!unit}
            >
              <Plus className="h-4 w-4" />
              Tambah Part
            </Button>
          )
        }
      >
        <div className="rounded-lg border">
          <Table containerClassName="max-h-[65vh] overflow-y-auto">
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
              <TableRow>
                <TableHead className="w-[3px] min-w-[3px] p-0" />
                <TableHead>Part Number</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead className="text-right">Interval</TableHead>
                <TableHead className="text-right">HM Ganti Terakhir</TableHead>
                <TableHead className="text-right">HM Jatuh Tempo</TableHead>
                <TableHead className="text-right">Sisa HM</TableHead>
                <TableHead className="text-right">Stock on Hand</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Penggantian</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                !detail &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={11}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {detail && detail.parts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center">
                    <Package className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <div className="font-semibold">Unit ini belum punya part</div>
                    <div className="text-sm text-muted-foreground">
                      {isAdmin
                        ? "Tambahkan part beserta interval HM untuk mulai memantau jatuh tempo."
                        : "Masuk sebagai admin untuk menambahkan part."}
                    </div>
                    {isAdmin && (
                      <Button
                        size="sm"
                        className="mt-3"
                        onClick={() => {
                          setEditingPart(null);
                          setPartFormOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        Tambah Part
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )}
              {detail?.parts.map((p) => (
                <TableRow key={p.id}>
                  <RailCell status={p.status} />
                  <TableCell className="whitespace-nowrap font-mono text-sm font-semibold">{p.code || "—"}</TableCell>
                  <TableCell className="min-w-40 text-muted-foreground">{p.name}</TableCell>
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
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Riwayat penggantian"
                        onClick={() => setHistoryPart(p)}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Ubah part"
                            onClick={() => {
                              setEditingPart(p);
                              setPartFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            title="Hapus part"
                            onClick={() => setDeletingPart(p)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Content>

      {/* Riwayat servis umum */}
      <Content
        title="Riwayat Servis Umum"
        description="Servis rutin, perbaikan, dan inspeksi unit"
        cardAction={
          isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setServiceOpen(true)} disabled={!unit}>
              <Wrench className="h-4 w-4" />
              Catat Servis
            </Button>
          )
        }
      >
        <div className="rounded-lg border">
          <Table containerClassName="max-h-[50vh] overflow-y-auto">
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
              <TableRow>
                <TableHead>Jenis</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">HM</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                !detail &&
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {detail && services.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center">
                    <ClipboardList className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <div className="font-semibold">Belum ada riwayat servis</div>
                    <div className="text-sm text-muted-foreground">
                      {isAdmin
                        ? "Catat servis rutin, perbaikan, atau inspeksi unit ini."
                        : "Masuk sebagai admin untuk mencatat servis."}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {detail &&
                services.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap font-medium">{SERVICE_KIND_LABEL[s.kind]}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                      {formatDate(s.date)}
                    </TableCell>
                    <TableCell className={NUM}>{formatHm(s.hm)}</TableCell>
                    <TableCell className="max-w-md truncate text-sm" title={s.note}>
                      {s.note || "—"}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </Content>

      {/* Dialog */}
      {unit && (
        <>
          <HmUnitFormDialog
            open={unitFormOpen}
            onOpenChange={setUnitFormOpen}
            unit={unit}
            onSaved={() => {
              void reloadSites();
              void load();
            }}
          />
          <HmUpdateHmDialog open={hmOpen} onOpenChange={setHmOpen} unit={unit} onSaved={load} />
          <HmPartFormDialog
            open={partFormOpen}
            onOpenChange={setPartFormOpen}
            unitId={unit.id}
            part={editingPart}
            onSaved={load}
          />
          <HmReplacementHistoryDialog
            open={historyPart !== null}
            onOpenChange={(o) => !o && setHistoryPart(null)}
            part={historyPart}
            isAdmin={isAdmin}
            onRecord={() => setReplacingPart(historyPart)}
          />
          <HmReplacementFormDialog
            open={replacingPart !== null}
            onOpenChange={(o) => !o && setReplacingPart(null)}
            unit={unit}
            part={replacingPart}
            onSaved={load}
          />
          <HmServiceFormDialog open={serviceOpen} onOpenChange={setServiceOpen} unit={unit} onSaved={load} />
          <HmDeleteDialog
            open={deletingPart !== null}
            onOpenChange={(o) => !o && setDeletingPart(null)}
            title="Hapus Part"
            description={`Part “${deletingPart?.name ?? ""}” beserta riwayat penggantiannya akan dihapus. Tindakan ini tidak dapat dibatalkan.`}
            confirmLabel="Hapus Part"
            onConfirm={async () => {
              if (!deletingPart) return;
              try {
                await deleteHmPart(deletingPart.id);
                toast.success("Part dihapus");
                void load();
              } catch (e) {
                toast.error("Gagal menghapus part");
                throw e;
              }
            }}
          />
          <HmDeleteDialog
            open={deleteUnitOpen}
            onOpenChange={setDeleteUnitOpen}
            title="Hapus Unit"
            description={`Unit ${unit.code} beserta seluruh part dan riwayatnya akan dihapus. Tindakan ini tidak dapat dibatalkan.`}
            confirmLabel="Hapus Unit"
            onConfirm={async () => {
              try {
                await deleteHmUnit(unit.id);
                toast.success("Unit dihapus");
                router.push("/maintenance/unit");
              } catch (e) {
                toast.error("Gagal menghapus unit");
                throw e;
              }
            }}
          />
        </>
      )}
    </>
  );
}

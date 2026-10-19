"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Search,
  ShieldCheck,
  TriangleAlert,
  User,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatDate, formatDateDocument, formatDateTime } from "@/lib/utils";
import {
  movementTypeMeta,
  type MovementDoc,
  type MovementTypeMeta,
} from "@/lib/stock-movement-docs";

export interface HistoryMovement {
  id: number;
  cabang_id: number;
  qty_change: number;
  type: string;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
  actor_name: string;
  cabang?: { nama_cabang: string } | null;
}

export interface HistoryLocation {
  cabang_id: number;
  nama_cabang: string;
  qty: number;
}

interface Props {
  movements: HistoryMovement[];
  locations: HistoryLocation[];
  docs: Map<string, MovementDoc>;
  satuan?: string | null;
}

interface Row extends HistoryMovement {
  before: number;
  after: number;
  totalAfter: number;
  doc: MovementDoc | null;
  meta: MovementTypeMeta;
  gudang: string;
}

const PAGE = 40;

const TONE: Record<MovementTypeMeta["tone"], string> = {
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
};

const fmt = (n: number) => n.toLocaleString("id-ID");

function dayKey(iso: string) {
  // Grup per hari kalender WIB.
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

export function StockMovementHistory({ movements, locations, docs, satuan }: Props) {
  const [gudang, setGudang] = useState("all");
  const [arah, setArah] = useState<"all" | "in" | "out">("all");
  const [jenis, setJenis] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  // Saldo dihitung mundur dari SOH saat ini: movements urut terbaru dulu,
  // jadi after = saldo berjalan, before = after - qty_change.
  const rows: Row[] = useMemo(() => {
    const running = new Map<number, number>();
    for (const loc of locations) running.set(loc.cabang_id, Number(loc.qty) || 0);
    let total = locations.reduce((s, l) => s + (Number(l.qty) || 0), 0);

    const out: Row[] = [];
    for (const m of movements) {
      const after = running.get(m.cabang_id) ?? 0;
      const before = after - m.qty_change;
      running.set(m.cabang_id, before);
      const totalAfter = total;
      total -= m.qty_change;
      out.push({
        ...m,
        before,
        after,
        totalAfter,
        doc: m.reference_id ? docs.get(`${m.type}|${m.reference_id}`) ?? null : null,
        meta: movementTypeMeta(m.type),
        gudang:
          m.cabang?.nama_cabang ||
          locations.find((l) => l.cabang_id === m.cabang_id)?.nama_cabang ||
          `Gudang #${m.cabang_id}`,
      });
    }
    return out;
  }, [movements, locations, docs]);

  const gudangOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const l of locations) map.set(l.cabang_id, l.nama_cabang);
    for (const r of rows) if (!map.has(r.cabang_id)) map.set(r.cabang_id, r.gudang);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [locations, rows]);

  const jenisOptions = useMemo(
    () => [...new Set(rows.map((r) => r.type))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (gudang !== "all" && String(r.cabang_id) !== gudang) return false;
      if (arah === "in" && r.qty_change <= 0) return false;
      if (arah === "out" && r.qty_change >= 0) return false;
      if (jenis !== "all" && r.type !== jenis) return false;
      if (needle) {
        const hay = `${r.reference_id ?? ""} ${r.notes ?? ""} ${r.actor_name} ${r.meta.label}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, gudang, arah, jenis, q]);

  const stats = useMemo(() => {
    let masuk = 0;
    let keluar = 0;
    for (const r of filtered) {
      if (r.qty_change > 0) masuk += r.qty_change;
      else keluar += -r.qty_change;
    }
    const soh =
      gudang === "all"
        ? locations.reduce((s, l) => s + (Number(l.qty) || 0), 0)
        : Number(locations.find((l) => String(l.cabang_id) === gudang)?.qty) || 0;
    return { masuk, keluar, soh };
  }, [filtered, gudang, locations]);

  // Titik grafik SOH: per gudang terpilih (saldo gudang) atau total semua gudang.
  const trend = useMemo(() => {
    const src = gudang === "all" ? rows : rows.filter((r) => String(r.cabang_id) === gudang);
    if (src.length === 0) return [];
    const pts = src
      .map((r) => ({ t: r.created_at, v: gudang === "all" ? r.totalAfter : r.after }))
      .reverse();
    const first = src[src.length - 1];
    pts.unshift({
      t: first.created_at,
      v: gudang === "all" ? first.totalAfter - first.qty_change : first.before,
    });
    return pts;
  }, [rows, gudang]);

  const visible = filtered.slice(0, shown);
  const groups = useMemo(() => {
    const out: { key: string; items: Row[] }[] = [];
    for (const r of visible) {
      const k = dayKey(r.created_at);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(r);
      else out.push({ key: k, items: [r] });
    }
    return out;
  }, [visible]);

  const hasMismatch = rows.some((r) => r.before < 0);
  const unit = satuan || "";

  if (movements.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-xs italic">
        Belum ada riwayat mutasi.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="grid grid-cols-2 gap-2">
        <Select value={gudang} onValueChange={(v) => { setGudang(v); setShown(PAGE); }}>
          <SelectTrigger className="h-8 text-xs w-full">
            <SelectValue placeholder="Gudang" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Semua gudang</SelectItem>
            {gudangOptions.map(([id, nama]) => (
              <SelectItem key={id} value={String(id)} className="text-xs">
                {nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={jenis} onValueChange={(v) => { setJenis(v); setShown(PAGE); }}>
          <SelectTrigger className="h-8 text-xs w-full">
            <SelectValue placeholder="Jenis" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Semua jenis</SelectItem>
            {jenisOptions.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                {movementTypeMeta(t).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
            placeholder="Cari kode / catatan / user"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex rounded-md border p-0.5 h-8">
          {([
            ["all", "Semua"],
            ["in", "Masuk"],
            ["out", "Keluar"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => { setArah(v); setShown(PAGE); }}
              className={cn(
                "flex-1 rounded text-[11px] font-bold transition-colors",
                arah === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-4 gap-2">
        <StatTile label="Transaksi" value={fmt(filtered.length)} />
        <StatTile label="Masuk" value={`+${fmt(stats.masuk)}`} className="text-emerald-600 dark:text-emerald-400" />
        <StatTile label="Keluar" value={`-${fmt(stats.keluar)}`} className="text-rose-600 dark:text-rose-400" />
        <StatTile label="SOH Saat Ini" value={fmt(stats.soh)} sub={unit} />
      </div>

      {/* Tren SOH */}
      {trend.length > 1 && (
        <div className="rounded-xl border p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Tren SOH {gudang === "all" ? "(total semua gudang)" : `— ${gudangOptions.find(([id]) => String(id) === gudang)?.[1] ?? ""}`}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatDate(trend[0].t)} – {formatDate(trend[trend.length - 1].t)}
            </span>
          </div>
          <Sparkline points={trend.map((p) => p.v)} />
        </div>
      )}

      {hasMismatch && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Saldo dihitung mundur dari SOH saat ini. Ada saldo awal minus, artinya
            sebagian perubahan stok lama tidak tercatat di riwayat (mis. data sebelum
            ledger dipakai), jadi saldo pada baris lama bisa tidak akurat.
          </span>
        </div>
      )}

      {/* Timeline stepper */}
      {filtered.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-xs italic">
          Tidak ada mutasi sesuai filter.
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="sticky top-0 z-10 -mx-1 mb-2 bg-background/95 px-1 py-1 backdrop-blur">
                <span className="text-[11px] font-bold text-muted-foreground">
                  {formatDateDocument(`${g.key}T12:00:00`)}
                </span>
              </div>
              <ol className="relative">
                {g.items.map((r, i) => (
                  <TimelineItem key={r.id} row={r} unit={unit} last={i === g.items.length - 1} />
                ))}
              </ol>
            </section>
          ))}
          {filtered.length > shown && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={() => setShown((s) => s + PAGE)}
            >
              Muat lebih banyak ({fmt(filtered.length - shown)} lagi)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineItem({ row, unit, last }: { row: Row; unit: string; last: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isIn = row.qty_change > 0;
  const doc = row.doc;

  return (
    <li className="relative flex gap-3 pb-4">
      {/* Node + garis stepper */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "z-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background",
            isIn
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
              : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
          )}
        >
          {isIn ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
        </div>
        {!last && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      <div className="flex-1 min-w-0 rounded-xl border bg-card p-3 space-y-2.5">
        {/* Header: jenis, dokumen, qty */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className={cn("border-none text-[10px] font-bold px-1.5 h-5", TONE[row.meta.tone])}>
                {row.meta.label}
              </Badge>
              <span className="text-[11px] text-muted-foreground truncate">{row.gudang}</span>
            </div>
            {row.reference_id && (
              <div className="flex items-center gap-1 text-xs font-semibold">
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                {doc?.href ? (
                  <Link href={doc.href} className="truncate hover:underline text-primary inline-flex items-center gap-1">
                    {row.reference_id}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </Link>
                ) : (
                  <span className="truncate">{row.reference_id}</span>
                )}
                {doc?.status && (
                  <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px] uppercase">
                    {doc.status}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className={cn("text-base font-black leading-none", isIn ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
              {isIn ? "+" : ""}
              {fmt(row.qty_change)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{unit}</div>
          </div>
        </div>

        {/* Tracker SOH */}
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">SOH</span>
          <span className={cn("text-sm font-bold tabular-nums", row.before < 0 && "text-amber-600")}>{fmt(row.before)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-black tabular-nums">{fmt(row.after)}</span>
          <span className="text-[10px] text-muted-foreground truncate">{unit} · {row.gudang}</span>
        </div>

        {/* Info tanggal */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          <Meta icon={<Clock className="h-3 w-3" />} label="Stok diposting" value={formatDateTime(row.created_at)} />
          <Meta icon={<User className="h-3 w-3" />} label="Oleh" value={row.actor_name} />
          {doc && (
            <>
              <Meta icon={<CalendarClock className="h-3 w-3" />} label={`${doc.kindLabel} dibuat`} value={formatDateTime(doc.createdAt)} />
              {doc.docDate && <Meta icon={<FileText className="h-3 w-3" />} label="Tgl dokumen" value={formatDate(doc.docDate)} />}
              <ApprovalMeta doc={doc} />
            </>
          )}
        </dl>

        {row.notes && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="block w-full text-left text-[11px] leading-snug text-muted-foreground hover:text-foreground"
          >
            <span className={cn("block", expanded ? "whitespace-pre-line" : "line-clamp-2")}>
              {expanded ? row.notes.split(" | ").join("\n") : row.notes}
            </span>
            {row.notes.length > 110 && (
              <span className="text-[10px] font-semibold text-primary">
                {expanded ? "Sembunyikan" : "Selengkapnya"}
              </span>
            )}
          </button>
        )}
      </div>
    </li>
  );
}

function ApprovalMeta({ doc }: { doc: MovementDoc }) {
  const a = doc.approval;
  if (a.state === "none") {
    return <Meta icon={<ShieldCheck className="h-3 w-3" />} label="Approval" value="Tanpa approval" />;
  }
  if (a.state === "approved") {
    return (
      <Meta
        icon={<CheckCircle2 className="h-3 w-3 text-emerald-600" />}
        label={`Full approve (${a.totalCount} step)`}
        value={a.fullApprovedAt ? formatDateTime(a.fullApprovedAt) : "Approved"}
      />
    );
  }
  if (a.state === "rejected") {
    return <Meta icon={<XCircle className="h-3 w-3 text-rose-600" />} label="Approval" value="Ditolak" />;
  }
  return (
    <Meta
      icon={<Clock className="h-3 w-3 text-amber-600" />}
      label={`Approval ${a.approvedCount}/${a.totalCount}`}
      value={a.pendingName ? `Menunggu ${a.pendingName}` : "Menunggu"}
    />
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="font-medium truncate" title={value}>{value}</dd>
    </div>
  );
}

function StatTile({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="rounded-lg border px-2 py-1.5 min-w-0">
      <div className="text-[9px] font-black uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={cn("text-sm font-black tabular-nums truncate", className)}>
        {value}
        {sub && <span className="ml-1 text-[9px] font-medium text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 300;
  const h = 48;
  const min = Math.min(...points, 0);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const coords = points.map((v, i) => [i * step, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <div className="flex items-end gap-2">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full text-primary">
        <path d={area} fill="currentColor" opacity={0.08} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="text-right shrink-0 text-[10px] text-muted-foreground leading-tight">
        <div>maks {fmt(max)}</div>
        <div>min {fmt(Math.min(...points))}</div>
      </div>
    </div>
  );
}

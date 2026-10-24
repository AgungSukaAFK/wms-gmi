"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatDateTime } from "@/lib/utils";
import { IMPORT_CATEGORY_LABEL, IMPORT_DEFINITIONS, getImportDefinition } from "@/lib/import/registry";
import { buildTemplateWorkbook, downloadWorkbook, templateFileName } from "@/lib/import/template";
import { docKeyOf, makeBatches, parseImportFile, type ParsedFile } from "@/lib/import/parse";
import { downloadImportReport } from "@/lib/import/report";
import type { ImportDefinition, ImportOptionValues, ImportRefs, ImportRow, ImportRowResult } from "@/lib/import/types";
import {
  getImportAccess,
  getImportLogs,
  getImportPrefill,
  getImportReferences,
  runImportBatch,
  saveImportLog,
} from "@/services/import-actions";
import { getCabangList } from "@/services/master-actions";
import { ImportResultsTable } from "./import-results-table";

type Phase = "idle" | "checking" | "checked" | "committing" | "done";

function defaultOptions(def: ImportDefinition): ImportOptionValues {
  const o: ImportOptionValues = {};
  for (const opt of def.options || []) {
    if (opt.type === "select") o[opt.key] = opt.default;
    else if (opt.type === "bool") o[opt.key] = opt.default;
    else o[opt.key] = null;
  }
  return o;
}

function countResults(rows: ImportRow[], results: Map<number, ImportRowResult>) {
  const c = { create: 0, update: 0, skip: 0, error: 0, warning: 0 };
  for (const r of rows) {
    const res = results.get(r.row);
    if (!res) continue;
    c[res.status]++;
    if (res.warnings?.length) c.warning++;
  }
  return c;
}

export function ImportCenter() {
  const router = useRouter();
  const search = useSearchParams();
  const [access, setAccess] = useState<"loading" | "ok" | "denied">("loading");
  const selected = getImportDefinition(search.get("f") || "") || IMPORT_DEFINITIONS[0];

  useEffect(() => {
    getImportAccess().then((r) => setAccess(r.allowed ? "ok" : "denied"));
  }, []);

  if (access === "loading") {
    return (
      <Content title="Import Data Excel">
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Content>
    );
  }
  if (access === "denied") {
    return (
      <Content title="Import Data Excel">
        <p className="text-sm italic text-muted-foreground">Halaman ini hanya bisa diakses oleh akun Moderator.</p>
      </Content>
    );
  }

  const groups = Object.keys(IMPORT_CATEGORY_LABEL).map((cat) => ({
    cat,
    items: IMPORT_DEFINITIONS.filter((d) => d.category === cat),
  }));

  return (
    <>
      <Content>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Import Data Excel</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Masukkan banyak data sekaligus lewat Excel: download template, isi, lalu upload. Isi file selalu dicek dulu (preview baris baru,
              diperbarui, dilewati, dan error) sebelum disimpan. Khusus Moderator.
            </p>
          </div>
        </div>
      </Content>

      <Content size="sm" title="Pilih data" className="lg:sticky lg:top-4">
        <nav className="space-y-4" aria-label="Jenis import">
          {groups.map((g) =>
            g.items.length ? (
              <div key={g.cat} className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{IMPORT_CATEGORY_LABEL[g.cat]}</div>
                {g.items.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => router.replace(`/import?f=${d.key}`, { scroll: false })}
                    aria-current={d.key === selected.key ? "page" : undefined}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left transition-colors",
                      d.key === selected.key ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60",
                    )}
                  >
                    <div className="text-sm font-medium text-foreground">{d.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{d.summary}</div>
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </nav>
      </Content>

      <div className="col-span-12 min-w-0 space-y-4 lg:col-span-8">
        <ImportPanel key={selected.key} def={selected} />
      </div>
    </>
  );
}

function ImportPanel({ def }: { def: ImportDefinition }) {
  const [refs, setRefs] = useState<ImportRefs | null>(null);
  const [cabangList, setCabangList] = useState<{ id: number; nama_cabang: string }[]>([]);
  const [options, setOptions] = useState<ImportOptionValues>(() => defaultOptions(def));
  const [prefillMode, setPrefillMode] = useState(def.prefill?.modes[0]?.value || "");
  const [prefillCabang, setPrefillCabang] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<"" | "empty" | "data">("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [results, setResults] = useState<Map<number, ImportRowResult>>(new Map());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [logs, setLogs] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadLogs = useCallback(() => {
    getImportLogs(def.key).then((r) => setLogs(r.data || []));
  }, [def.key]);

  useEffect(() => {
    getImportReferences(def.key).then((r) => {
      if (r.error) toast.error(r.error);
      setRefs(r.data || {});
      // Default template approval: yang pertama tersedia.
      for (const opt of def.options || []) {
        if (opt.type === "approval_template") {
          const first = r.data?.approvalTemplates?.[opt.templateType]?.[0];
          if (first) setOptions((o) => ({ ...o, [opt.key]: o[opt.key] ?? String(first.id) }));
        }
      }
    });
    if (def.prefill?.withCabangFilter) getCabangList().then((rows: any) => setCabangList(rows || []));
    loadLogs();
  }, [def, loadLogs]);

  const reset = () => {
    setFile(null);
    setParsed(null);
    setResults(new Map());
    setPhase("idle");
    setProgress({ done: 0, total: 0 });
    if (inputRef.current) inputRef.current.value = "";
  };

  const download = async (withData: boolean) => {
    if (!refs) return;
    setDownloading(withData ? "data" : "empty");
    try {
      let rows: Record<string, unknown>[] = [];
      if (withData) {
        const res = await getImportPrefill(def.key, { mode: prefillMode, cabangIds: prefillCabang.map(Number) });
        if (res.error) throw new Error(res.error);
        rows = res.data || [];
        if (!rows.length) {
          toast.info("Tidak ada data untuk pilihan ini. Template kosong diunduh.");
        }
      }
      const wb = await buildTemplateWorkbook(def, refs, rows);
      await downloadWorkbook(wb, templateFileName(def, withData && rows.length > 0));
      toast.success(withData && rows.length ? `Template berisi ${rows.length.toLocaleString("id-ID")} baris diunduh.` : "Template diunduh.");
    } catch (e: any) {
      toast.error(e?.message || "Gagal membuat template.");
    } finally {
      setDownloading("");
    }
  };

  const missingOption = useMemo(() => {
    for (const opt of def.options || []) {
      if (opt.type !== "approval_template") continue;
      const need = !opt.requiredWhen || options[opt.requiredWhen.key] === opt.requiredWhen.value;
      if (need && !options[opt.key]) return `${opt.label} belum dipilih.`;
    }
    return null;
  }, [def, options]);

  /** Kirim baris per batch ke server; hasil digabung ke peta hasil. */
  const runBatches = async (rows: ImportRow[], commit: boolean, base: Map<number, ImportRowResult>) => {
    // Preview tidak menulis apa pun -> batch boleh lebih besar dari batch simpan.
    const size = def.commitBatch || 300;
    const batches = makeBatches(def, rows, commit ? size : size * 5);
    const next = new Map(base);
    setProgress({ done: 0, total: rows.length });
    let done = 0;
    for (const batch of batches) {
      const res = await runImportBatch(def.key, batch, options, commit);
      if (res.error) {
        for (const r of batch) next.set(r.row, { row: r.row, status: "error", message: res.error });
      } else {
        for (const x of res.data || []) next.set(x.row, x);
      }
      done += batch.length;
      setProgress({ done, total: rows.length });
      setResults(new Map(next));
    }
    return next;
  };

  const check = async (f: File) => {
    setFile(f);
    setPhase("checking");
    setResults(new Map());
    try {
      const p = await parseImportFile(f, def);
      setParsed(p);
      if (p.fatal.length) {
        setPhase("idle");
        return;
      }
      const base = new Map<number, ImportRowResult>();
      for (const [row, errs] of p.rowErrors) base.set(row, { row, status: "error", message: errs.join(" · ") });
      // Dokumen dengan 1 baris error -> seluruh dokumen tidak dikirim.
      const badDocs = new Set<string>();
      if (def.docKey?.length) for (const r of p.rows) if (base.has(r.row)) badDocs.add(docKeyOf(def, r));
      const send: ImportRow[] = [];
      for (const r of p.rows) {
        if (base.has(r.row)) continue;
        if (def.docKey?.length && badDocs.has(docKeyOf(def, r))) {
          base.set(r.row, { row: r.row, status: "error", message: "Dilewati: ada baris error di dokumen yang sama" });
          continue;
        }
        send.push(r);
      }
      setResults(new Map(base));
      await runBatches(send, false, base);
      setPhase("checked");
    } catch (e: any) {
      toast.error(e?.message || "Gagal membaca file.");
      setPhase("idle");
    }
  };

  const commit = async () => {
    if (!parsed || !file) return;
    if (missingOption) {
      toast.error(missingOption);
      return;
    }
    // Kirim baris yang akan berubah; untuk dokumen/kelompok kirim utuh.
    const groupCols = def.docKey?.length ? def.docKey : def.groupKey;
    const changing = (r: ImportRow) => {
      const s = results.get(r.row)?.status;
      return s === "create" || s === "update";
    };
    let send = parsed.rows.filter(changing);
    if (groupCols?.length) {
      const keyOfRow = (r: ImportRow) => groupCols.map((k) => String(r.values[k] ?? "").trim().toUpperCase()).join("|");
      const keys = new Set(send.map(keyOfRow));
      send = parsed.rows.filter((r) => keys.has(keyOfRow(r)) && results.get(r.row)?.status !== "error");
    }
    if (!send.length) {
      toast.info("Tidak ada baris yang perlu diproses.");
      return;
    }
    setPhase("committing");
    try {
      const final = await runBatches(send, true, results);
      const c = countResults(parsed.rows, final);
      await saveImportLog({
        key: def.key,
        fileName: file.name,
        options,
        total: parsed.rows.length,
        created: c.create,
        updated: c.update,
        skipped: c.skip,
        errors: c.error,
        summary: `${c.create} baru, ${c.update} diperbarui, ${c.skip} dilewati, ${c.error} error`,
      });
      loadLogs();
      setPhase("done");
      if (c.error) toast.warning(`Selesai dengan ${c.error} baris error. Unduh laporan untuk detailnya.`);
      else toast.success("Import selesai.");
    } catch (e: any) {
      toast.error(e?.message || "Proses gagal.");
      setPhase("checked");
    }
  };

  const counts = parsed ? countResults(parsed.rows, results) : null;
  const toProcess = counts ? counts.create + counts.update : 0;
  const busy = phase === "checking" || phase === "committing";

  return (
    <>
      {/* Ringkasan fitur */}
      <Content
        title={def.title}
        description={def.summary}
        cardAction={
          def.route ? (
            <Button asChild variant="outline" size="sm">
              <Link href={def.route}>
                Buka halaman <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Yang terjadi saat diproses</div>
            <ul className="space-y-1 text-sm text-foreground">
              {def.effects.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aturan pengisian</div>
            <ul className="space-y-1 text-sm text-foreground">
              {def.rules.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs text-muted-foreground">
              Kolom: {def.columns.filter((c) => !c.infoOnly).map((c) => `${c.header}${c.required ? "*" : ""}`).join(", ")}
            </div>
          </div>
        </div>
      </Content>

      {/* Langkah 1 */}
      <Content title="1. Download template" description="Template berisi petunjuk, contoh, dropdown pilihan, dan catatan di setiap judul kolom.">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <Button onClick={() => download(false)} disabled={!refs || !!downloading} variant="outline">
            {downloading === "empty" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Template kosong
          </Button>
          {def.prefill && (
            <div className="flex flex-1 flex-col gap-2 rounded-md border border-dashed border-border p-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <Label className="text-xs">Template berisi data saat ini</Label>
                <Select value={prefillMode} onValueChange={setPrefillMode}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {def.prefill.modes.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {def.prefill.withCabangFilter && (
                <div className="space-y-1 sm:w-48">
                  <Label className="text-xs">Gudang</Label>
                  <MultiSelect
                    className="h-9 w-full"
                    placeholder="Semua gudang"
                    searchable
                    selected={prefillCabang}
                    onChange={setPrefillCabang}
                    options={cabangList.map((c) => ({ label: c.nama_cabang, value: String(c.id) }))}
                  />
                </div>
              )}
              <Button onClick={() => download(true)} disabled={!refs || !!downloading}>
                {downloading === "data" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                Download isi data
              </Button>
            </div>
          )}
        </div>
        {def.prefill && (
          <p className="mt-2 text-xs text-muted-foreground">
            {def.prefill.modes.find((m) => m.value === prefillMode)?.description ||
              "Ubah atau lengkapi isinya, lalu upload lagi. Baris yang tidak berubah otomatis dilewati."}
          </p>
        )}
      </Content>

      {/* Langkah 2 */}
      <Content title="2. Upload & cek" description="File dicek dulu tanpa menyimpan apa pun. Hasil cek muncul di bawah.">
        <div className="space-y-4">
          {!!def.options?.length && (
            <div className="grid gap-4 sm:grid-cols-2">
              {def.options.map((opt) => {
                if (opt.type === "approval_template" && opt.requiredWhen && options[opt.requiredWhen.key] !== opt.requiredWhen.value) return null;
                if (opt.visibleWhen && options[opt.visibleWhen.key] !== opt.visibleWhen.value) return null;
                return (
                  <div key={opt.key} className="space-y-1.5">
                    <Label className="text-xs">{opt.label}</Label>
                    {opt.type === "select" && (
                      <>
                        <Select value={String(options[opt.key] ?? opt.default)} onValueChange={(v) => setOptions((o) => ({ ...o, [opt.key]: v }))} disabled={busy}>
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {opt.choices.map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">{opt.choices.find((c) => c.value === options[opt.key])?.description}</p>
                      </>
                    )}
                    {opt.type === "bool" && (
                      <div className="flex items-center gap-2 pt-1">
                        <Switch checked={!!options[opt.key]} onCheckedChange={(v) => setOptions((o) => ({ ...o, [opt.key]: v }))} disabled={busy} />
                        <span className="text-xs text-muted-foreground">{opt.description}</span>
                      </div>
                    )}
                    {opt.type === "approval_template" && (
                      <Select value={options[opt.key] ? String(options[opt.key]) : ""} onValueChange={(v) => setOptions((o) => ({ ...o, [opt.key]: v }))} disabled={busy}>
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue placeholder="Pilih template approval" />
                        </SelectTrigger>
                        <SelectContent>
                          {!opt.requiredWhen && <SelectItem value="none">Tanpa approval (langsung approved)</SelectItem>}
                          {(refs?.approvalTemplates?.[opt.templateType] || []).map((t) => (
                            <SelectItem key={t.id} value={String(t.id)}>
                              {t.name}
                              {t.cabang ? ` · ${t.cabang}` : " · semua site"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border px-4 py-6 text-center",
              busy && "opacity-60",
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f && !busy) check(f);
            }}
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <div className="text-sm text-foreground">{file ? file.name : "Tarik file Excel ke sini, atau pilih file"}</div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
                Pilih file (.xlsx / .xls)
              </Button>
              {file && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => check(file)}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Cek ulang
                </Button>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) check(f);
              }}
            />
            <p className="text-xs text-muted-foreground">Mengubah opsi di atas? Klik “Cek ulang” supaya hasil cek mengikuti opsi terbaru.</p>
          </div>

          {parsed?.fatal.map((f, i) => (
            <div key={i} className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {f}
            </div>
          ))}
          {parsed?.warnings.map((w, i) => (
            <div key={i} className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </div>
          ))}
        </div>
      </Content>

      {/* Langkah 3 */}
      {parsed && !parsed.fatal.length && (
        <Content
          title={phase === "done" ? "Hasil proses" : "3. Hasil cek & proses"}
          description={`Sheet “${parsed.sheetName}”, judul kolom di baris ${parsed.headerRow}, ${parsed.rows.length.toLocaleString("id-ID")} baris data${
            def.docKey?.length ? ` (${new Set(parsed.rows.map((r) => docKeyOf(def, r)).filter(Boolean)).size.toLocaleString("id-ID")} dokumen)` : ""
          }.`}
          cardAction={
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !results.size}
              onClick={() => downloadImportReport(def, parsed.rows, results, phase === "done" ? "hasil" : "cek", file?.name || def.key)}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Unduh laporan
            </Button>
          }
        >
          <div className="space-y-4">
            {busy && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{phase === "checking" ? "Mengecek ke database…" : "Menyimpan…"}</span>
                  <span className="tabular-nums">
                    {progress.done.toLocaleString("id-ID")} / {progress.total.toLocaleString("id-ID")}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
              </div>
            )}
            {counts && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  { k: "create", label: "Baru", cls: "text-success" },
                  { k: "update", label: "Diperbarui", cls: "text-primary" },
                  { k: "skip", label: "Dilewati", cls: "text-muted-foreground" },
                  { k: "error", label: "Error", cls: "text-destructive" },
                  { k: "warning", label: "Peringatan", cls: "text-warning" },
                ].map((s) => (
                  <div key={s.k} className="rounded-md border border-border p-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                    <div className={cn("text-xl font-semibold tabular-nums", s.cls)}>{(counts as any)[s.k].toLocaleString("id-ID")}</div>
                  </div>
                ))}
              </div>
            )}

            {phase === "checked" && (
              <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  {toProcess ? (
                    <>
                      <b className="tabular-nums">{toProcess.toLocaleString("id-ID")}</b> baris siap diproses.
                      {counts?.error ? ` ${counts.error.toLocaleString("id-ID")} baris error akan dilewati — perbaiki di Excel lalu upload ulang file yang sama (baris yang sudah masuk otomatis dilewati).` : ""}
                    </>
                  ) : (
                    "Tidak ada baris yang perlu diproses."
                  )}
                  {missingOption && <div className="mt-1 text-xs text-destructive">{missingOption}</div>}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={reset}>
                    Batal
                  </Button>
                  <Button onClick={commit} disabled={!toProcess || !!missingOption}>
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Proses {toProcess.toLocaleString("id-ID")} baris
                  </Button>
                </div>
              </div>
            )}
            {phase === "done" && (
              <div className="flex flex-col gap-3 rounded-md border border-success/40 bg-success/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-foreground">
                  Selesai. Baris berstatus Error belum tersimpan — unduh laporan, perbaiki, lalu upload ulang.
                </div>
                <Button variant="outline" onClick={reset}>
                  Upload file lain
                </Button>
              </div>
            )}

            <ImportResultsTable def={def} rows={parsed.rows} results={results} />
          </div>
        </Content>
      )}

      {/* Riwayat */}
      <Content title="Riwayat import" description={`50 import terakhir untuk ${def.title}.`}>
        {logs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Waktu</th>
                  <th className="py-1.5 pr-3 font-medium">Oleh</th>
                  <th className="py-1.5 pr-3 font-medium">File</th>
                  <th className="py-1.5 pr-3 font-medium">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                    <td className="py-1.5 pr-3">{l.created_by_name || "-"}</td>
                    <td className="py-1.5 pr-3 break-all">{l.file_name}</td>
                    <td className="py-1.5 pr-3">
                      {l.rows_created} baru · {l.rows_updated} diperbarui · {l.rows_skipped} dilewati
                      {l.rows_error ? <span className="text-destructive"> · {l.rows_error} error</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <History className="h-4 w-4" /> Belum ada import.
          </p>
        )}
      </Content>
    </>
  );
}

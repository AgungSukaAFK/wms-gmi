"use client";

import React, { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Content } from "@/components/content";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ClipboardList, CheckCircle2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  getStockSettingRequests,
  resolveStockSettingRequest,
  setMinMaxFromRequest,
} from "@/services/stock-request-actions";

const REASON_META: Record<string, { label: string; className: string }> = {
  no_policy: {
    label: "Belum di-set",
    className: "bg-warning/10 text-warning border-warning/30",
  },
  limit_reached: {
    label: "Stok penuh",
    className: "bg-primary/10 text-primary border-primary/30",
  },
};

export default function StockRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">(
    "open",
  );
  const [denied, setDenied] = useState(false);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  // Dialog set min/max
  const [settingRow, setSettingRow] = useState<any | null>(null);
  const [minInput, setMinInput] = useState("");
  const [maxInput, setMaxInput] = useState("");
  const [savingMinMax, setSavingMinMax] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const res = await getStockSettingRequests(statusFilter);
    if (res.error) {
      setDenied(true);
      setRows([]);
    } else {
      setDenied(false);
      setRows(res.data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleResolve = async (id: number) => {
    setResolvingId(id);
    const res = await resolveStockSettingRequest(id);
    setResolvingId(null);
    if (res?.success) {
      toast.success("Request ditandai selesai.");
      fetchData();
    } else {
      toast.error(res?.error || "Gagal memproses");
    }
  };

  const openSetDialog = (r: any) => {
    setSettingRow(r);
    setMinInput("");
    setMaxInput(r.max_qty ? String(r.max_qty) : "");
  };

  const handleSaveMinMax = async () => {
    if (!settingRow) return;
    const min = Number(minInput || 0);
    const max = Number(maxInput || 0);
    if (max < 1) {
      toast.error("Max stok harus minimal 1.");
      return;
    }
    if (max < min) {
      toast.error("Max tidak boleh lebih kecil dari Min.");
      return;
    }
    setSavingMinMax(true);
    const res = await setMinMaxFromRequest(settingRow.id, min, max);
    setSavingMinMax(false);
    if (res?.success) {
      toast.success("Kebijakan stok tersimpan & request selesai.");
      setSettingRow(null);
      fetchData();
    } else {
      toast.error(res?.error || "Gagal menyimpan");
    }
  };

  return (
    <>
      {/* Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Request Pengaturan Stok
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                PN yang perlu di-set kebijakan min/max per cabang
              </p>
            </div>
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as any)}
          >
            <SelectTrigger className="h-9 w-full sm:w-44 text-xs font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Belum diproses</SelectItem>
              <SelectItem value="resolved">Selesai</SelectItem>
              <SelectItem value="all">Semua</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Content>

      {/* Table */}
      <Content>
        {denied ? (
          <div className="py-12 text-center text-xs font-semibold text-muted-foreground">
            Halaman ini hanya untuk moderator / PPIC / PJO.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-[10px] font-bold uppercase">
                    Barang
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase">
                    Cabang
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase">
                    Alasan
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-center">
                    Stok (saat minta)
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase">
                    Peminta
                  </TableHead>
                  <TableHead className="text-[10px] font-bold uppercase text-right pr-4">
                    Aksi
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-32 text-center text-xs font-semibold text-muted-foreground"
                    >
                      Tidak ada request.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const meta = REASON_META[r.reason] || {
                      label: r.reason,
                      className: "",
                    };
                    return (
                      <TableRow key={r.id} className="hover:bg-muted/30">
                        <TableCell>
                          <div className="font-mono text-xs font-bold text-foreground">
                            {r.part_number || r.barang?.part_number}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.part_name || r.barang?.part_name}
                          </div>
                        </TableCell>
                        <TableCell className="text-[11px] font-semibold">
                          {r.cabang?.nama_cabang || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-bold uppercase ${meta.className}`}
                          >
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center text-[11px] font-bold">
                          {r.current_qty ?? "-"} / {r.max_qty ?? "-"}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {r.requester?.nama || "-"}
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          {r.status === "open" ? (
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1 text-[11px] font-bold"
                                onClick={() => openSetDialog(r)}
                              >
                                <Settings2 className="h-3.5 w-3.5" /> Atur Stok
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 gap-1 text-[11px] font-bold text-muted-foreground"
                                onClick={() => handleResolve(r.id)}
                                disabled={resolvingId === r.id}
                                title="Tandai selesai tanpa mengatur (mis. sudah diatur manual)"
                              >
                                {resolvingId === r.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                Selesai
                              </Button>
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[9px] font-bold uppercase text-success border-success/40 bg-success/10"
                            >
                              Selesai
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Content>

      {/* Dialog set min/max langsung */}
      <Dialog
        open={settingRow !== null}
        onOpenChange={(o) => {
          if (!o) setSettingRow(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              Atur Kebijakan Stok
            </DialogTitle>
            <DialogDescription className="text-left">
              <span className="font-mono font-bold text-foreground">
                {settingRow?.part_number || settingRow?.barang?.part_number}
              </span>{" "}
              di cabang{" "}
              <span className="font-bold text-foreground">
                {settingRow?.cabang?.nama_cabang}
              </span>
              . Stok saat ini: {settingRow?.current_qty ?? 0}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground uppercase">
                Min Stok
              </label>
              <Input
                type="number"
                min="0"
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                placeholder="0"
                className="font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground uppercase">
                Max Stok
              </label>
              <Input
                type="number"
                min="1"
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                placeholder="0"
                className="font-bold"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Setelah disimpan, PN langsung bisa diminta di MR dan request ini
            otomatis ditandai selesai.
          </p>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="ghost"
              className="text-xs font-bold"
              onClick={() => setSettingRow(null)}
              disabled={savingMinMax}
            >
              Batal
            </Button>
            <Button
              className="gap-2 text-xs font-bold"
              onClick={handleSaveMinMax}
              disabled={savingMinMax}
            >
              {savingMinMax ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Simpan & Selesai
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

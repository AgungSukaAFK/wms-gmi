"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { Edit2, FileWarning, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import {
  approveSpb,
  deleteSpb,
  getSpbList,
  rejectSpb,
  updateSpb,
} from "@/services/spb-actions";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";

type SpbRow = {
  id: number;
  spb_no: string;
  spb_no_wo?: string | null;
  spb_tanggal: string;
  spb_kode_unit?: string | null;
  spb_tipe_unit?: string | null;
  spb_brand?: string | null;
  spb_hm?: number | null;
  spb_gudang?: string | null;
  spb_pic_gmi?: string | null;
  spb_pic_ppa?: string | null;
  spb_status: string;
  approval_status?: string;
  approvals?: Array<{ userid?: string; status?: string }>;
};

export default function SpbPage() {
  const supabase = createClient();
  const profile = useAuthStore((s) => s.profile);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SpbRow[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [userId, setUserId] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SpbRow | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    spb_no_wo: "",
    spb_section: "",
    spb_pic_ppa: "",
    spb_kode_unit: "",
    spb_tipe_unit: "",
    spb_brand: "",
    spb_hm: "",
    spb_problem_remark: "",
    spb_status: "DONE QUOT",
  });

  const canManageSpb = useMemo(() => {
    const roleNames = (
      (profile as { roles?: { name?: string }[] } | null)?.roles || []
    )
      .map((role) => role?.name)
      .filter((name): name is string => Boolean(name));
    return roleNames.some((role) => role === "moderator" || role === "admin");
  }, [profile]);

  const fetchData = async () => {
    setLoading(true);
    const res = await getSpbList({
      search: debouncedSearch || undefined,
      status,
      page,
      limit,
    });

    if (res.error) {
      toast.error(res.error);
      setRows([]);
      setTotal(0);
    } else {
      setRows((res.data || []) as SpbRow[]);
      setTotal(res.count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [debouncedSearch, status, page, limit]);

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) setUserId(user.id);
    };
    loadUser();
  }, [supabase]);

  const openEdit = (row: SpbRow) => {
    setEditTarget(row);
    setEditForm({
      spb_no_wo: row.spb_no_wo || "",
      spb_section: "",
      spb_pic_ppa: row.spb_pic_ppa || "",
      spb_kode_unit: row.spb_kode_unit || "",
      spb_tipe_unit: row.spb_tipe_unit || "",
      spb_brand: row.spb_brand || "",
      spb_hm: row.spb_hm != null ? String(row.spb_hm) : "",
      spb_problem_remark: "",
      spb_status: row.spb_status || "DONE QUOT",
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    const res = await updateSpb(editTarget.id, {
      spb_no_wo: editForm.spb_no_wo || undefined,
      spb_section: editForm.spb_section || undefined,
      spb_pic_ppa: editForm.spb_pic_ppa || undefined,
      spb_kode_unit: editForm.spb_kode_unit || undefined,
      spb_tipe_unit: editForm.spb_tipe_unit || undefined,
      spb_brand: editForm.spb_brand || undefined,
      spb_hm: editForm.spb_hm ? Number(editForm.spb_hm) : undefined,
      spb_problem_remark: editForm.spb_problem_remark || undefined,
      spb_status: editForm.spb_status,
    });
    setEditSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("SPB berhasil diperbarui.");
    setEditOpen(false);
    setEditTarget(null);
    fetchData();
  };

  const onDelete = async (row: SpbRow) => {
    const ok = window.confirm(
      `Hapus SPB ${row.spb_no}?\n\n` +
        "Detail SPB, SPB PO, SPB DO, SPB Invoice, dan Return SPB terkait akan ikut terhapus.\n" +
        "Stok akan dikembalikan ke gudang asal.",
    );
    if (!ok) return;

    const res = await deleteSpb(row.id);
    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success("SPB berhasil dihapus.");
    fetchData();
  };

  const onApprove = async (id: number) => {
    const res = await approveSpb(id);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("Approval SPB berhasil diproses.");
    fetchData();
  };

  const onReject = async (id: number) => {
    const reason = window.prompt("Alasan reject SPB:");
    if (!reason) return;
    const res = await rejectSpb(id, reason);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("SPB berhasil direject.");
    fetchData();
  };

  const isMyApprovalTurn = (row: SpbRow) => {
    return (row.approvals || []).some(
      (approval) => approval.userid === userId && approval.status === "pending",
    );
  };

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <FileWarning className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                SURAT PENGELUARAN BARANG (SPB)
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Stock out sesuai alur WMS lama
              </p>
            </div>
          </div>
          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            asChild
          >
            <Link href="/spb/create">
              <Plus className="h-4 w-4" /> BUAT SPB
            </Link>
          </Button>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Cari No SPB, No WO, PIC"
              className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
            />
          </div>

          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-full border-input bg-background text-xs font-semibold text-foreground sm:w-45">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="DONE QUOT">DONE QUOT</SelectItem>
                <SelectItem value="PO_ATTACH">PO_ATTACH</SelectItem>
                <SelectItem value="DO_ATTACH">DO_ATTACH</SelectItem>
                <SelectItem value="DONE_QUOTE">DONE_QUOTE</SelectItem>
                <SelectItem value="Partial">Partial</SelectItem>
                <SelectItem value="Returned">Returned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No SPB</TableHead>
                <TableHead>No WO</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Kode Unit</TableHead>
                <TableHead>Tipe Unit</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>HM</TableHead>
                <TableHead>Lokasi</TableHead>
                <TableHead>PIC GMI</TableHead>
                <TableHead>PIC PPA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead className="w-24">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={13}
                    className="text-center text-muted-foreground"
                  >
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={13}
                    className="text-center text-muted-foreground"
                  >
                    Belum ada data SPB.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.spb_no}</TableCell>
                    <TableCell>{row.spb_no_wo || "-"}</TableCell>
                    <TableCell>
                      {new Date(row.spb_tanggal).toLocaleDateString("id-ID")}
                    </TableCell>
                    <TableCell>{row.spb_kode_unit || "-"}</TableCell>
                    <TableCell>{row.spb_tipe_unit || "-"}</TableCell>
                    <TableCell>{row.spb_brand || "-"}</TableCell>
                    <TableCell>{row.spb_hm ?? "-"}</TableCell>
                    <TableCell>{row.spb_gudang || "-"}</TableCell>
                    <TableCell>{row.spb_pic_gmi || "-"}</TableCell>
                    <TableCell>{row.spb_pic_ppa || "-"}</TableCell>
                    <TableCell>{row.spb_status}</TableCell>
                    <TableCell>{row.approval_status || "open"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canManageSpb && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(row)}
                          >
                            <Edit2 className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        )}
                        {row.approval_status === "open" &&
                          isMyApprovalTurn(row) && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onApprove(row.id)}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => onReject(row.id)}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(row)}
                          title="Hapus SPB"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DataTablePagination
          totalCount={total}
          pageSize={limit}
          currentPage={page}
          onPageChange={setPage}
          onPageSizeChange={(v) => {
            setLimit(Number(v));
            setPage(1);
          }}
          itemLabel="SPB"
        />
      </Content>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit SPB</DialogTitle>
            <DialogDescription>
              Moderator/admin dapat memperbarui data header SPB tanpa mengubah
              item detail.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="spb_no_wo">No WO</Label>
              <Input
                id="spb_no_wo"
                value={editForm.spb_no_wo}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_no_wo: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_section">Section</Label>
              <Input
                id="spb_section"
                value={editForm.spb_section}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_section: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_pic_ppa">PIC PPA</Label>
              <Input
                id="spb_pic_ppa"
                value={editForm.spb_pic_ppa}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_pic_ppa: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_kode_unit">Kode Unit</Label>
              <Input
                id="spb_kode_unit"
                value={editForm.spb_kode_unit}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_kode_unit: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_tipe_unit">Tipe Unit</Label>
              <Input
                id="spb_tipe_unit"
                value={editForm.spb_tipe_unit}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_tipe_unit: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_brand">Brand</Label>
              <Input
                id="spb_brand"
                value={editForm.spb_brand}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_brand: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_hm">HM</Label>
              <Input
                id="spb_hm"
                type="number"
                value={editForm.spb_hm}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, spb_hm: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="spb_status">Status</Label>
              <Select
                value={editForm.spb_status}
                onValueChange={(value) =>
                  setEditForm((prev) => ({ ...prev, spb_status: value }))
                }
              >
                <SelectTrigger id="spb_status">
                  <SelectValue placeholder="Pilih status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DONE QUOT">DONE QUOT</SelectItem>
                  <SelectItem value="PO_ATTACH">PO_ATTACH</SelectItem>
                  <SelectItem value="DO_ATTACH">DO_ATTACH</SelectItem>
                  <SelectItem value="DONE_QUOTE">DONE_QUOTE</SelectItem>
                  <SelectItem value="Partial">Partial</SelectItem>
                  <SelectItem value="Returned">Returned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="spb_problem_remark">Catatan Masalah</Label>
              <Textarea
                id="spb_problem_remark"
                value={editForm.spb_problem_remark}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    spb_problem_remark: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

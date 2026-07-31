"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import {
  Ban,
  Edit2,
  FileWarning,
  Loader2,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  Trash2,
} from "lucide-react";
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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  cancelSpb,
  deleteSpb,
  getSpbList,
  getStockOutApprovalTemplateOptions,
  previewStockOutApprovalFromTemplate,
  updateSpb,
} from "@/services/spb-actions";
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
  approval_template_id?: number | null;
};

type SpbTemplateOption = { id: number; name: string | null; cabang_id: number | null };
type SpbApprovalPreviewStep = { nama: string; position?: string | null };

export default function SpbPage() {
  const profile = useAuthStore((s) => s.profile);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SpbRow[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("created_at_desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
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

  // Ubah/perbarui template approval (menentukan nama-nama di slot tanda
  // tangan cetak) — supaya bisa disesuaikan tanpa cancel & buat ulang SPB.
  // `editTemplatePendingId` cuma pilihan di dropdown; baru "commit" jadi
  // `editTemplateAppliedId` (dikirim ke updateSpb bersama approvals hasil
  // preview-nya) setelah "Perbarui dari Template" berhasil, supaya
  // approval_template_id yang tersimpan tidak pernah lepas sinkron dari isi
  // approvals-nya.
  const [editTemplateOptions, setEditTemplateOptions] = useState<SpbTemplateOption[]>([]);
  const [editLoadingTemplates, setEditLoadingTemplates] = useState(false);
  const [editTemplatePendingId, setEditTemplatePendingId] = useState<number | null>(null);
  const [editTemplateAppliedId, setEditTemplateAppliedId] = useState<number | null>(null);
  const [editApprovalsPreview, setEditApprovalsPreview] = useState<
    SpbApprovalPreviewStep[] | null
  >(null);
  const [editApplyingTemplate, setEditApplyingTemplate] = useState(false);

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
      sort,
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
  }, [debouncedSearch, status, sort, page, limit]);

  const handleSortChange = (nextSort: string) => {
    setSort(nextSort);
    setPage(1);
  };

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
    setEditTemplatePendingId(row.approval_template_id ?? null);
    setEditTemplateAppliedId(null);
    setEditApprovalsPreview(null);
    setEditOpen(true);

    setEditLoadingTemplates(true);
    getStockOutApprovalTemplateOptions("spb", row.id)
      .then((res) => {
        if (res.error) {
          toast.error(res.error);
          setEditTemplateOptions([]);
          return;
        }
        setEditTemplateOptions(res.data || []);
      })
      .finally(() => setEditLoadingTemplates(false));
  };

  const handleApplyEditTemplate = async () => {
    if (!editTarget || !editTemplatePendingId) {
      toast.error("Pilih template terlebih dahulu.");
      return;
    }
    setEditApplyingTemplate(true);
    const res = await previewStockOutApprovalFromTemplate(
      "spb",
      editTarget.id,
      editTemplatePendingId,
    );
    setEditApplyingTemplate(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setEditApprovalsPreview(res.data as SpbApprovalPreviewStep[]);
    setEditTemplateAppliedId(editTemplatePendingId);
    toast.success(
      "Nama tanda tangan diperbarui dari template. Cek dulu sebelum menyimpan.",
    );
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
      ...(editApprovalsPreview && editTemplateAppliedId
        ? { approval_template_id: editTemplateAppliedId, approvals: editApprovalsPreview }
        : {}),
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

  const onCancel = async (row: SpbRow) => {
    const reason = window.prompt(
      `Alasan cancel SPB ${row.spb_no}?\n\nStok yang sudah keluar akan dikembalikan.`,
    );
    if (!reason) return;
    const res = await cancelSpb(row.id, reason);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success("SPB berhasil dibatalkan, stok sudah dikembalikan.");
    fetchData();
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
                <SelectItem value="CANCELLED">CANCELLED</SelectItem>
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
                <SortableTableHead
                  sortKey="spb_no"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  No SPB
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_no_wo"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  No WO
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_tanggal"
                  currentSort={sort}
                  onSort={handleSortChange}
                  defaultDir="desc"
                >
                  Tanggal
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_kode_unit"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  Kode Unit
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_tipe_unit"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  Tipe Unit
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_brand"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  Brand
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_hm"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  HM
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_gudang"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  Lokasi
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_pic_gmi"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  PIC GMI
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_pic_ppa"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  PIC PPA
                </SortableTableHead>
                <SortableTableHead
                  sortKey="spb_status"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  Status
                </SortableTableHead>
                <TableHead className="w-28">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="text-center text-muted-foreground"
                  >
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            window.open(`/spb/print/${row.id}`, "_blank")
                          }
                        >
                          <Printer className="mr-1.5 h-3.5 w-3.5" />
                          Cetak
                        </Button>
                        {canManageSpb && row.spb_status !== "CANCELLED" && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => onCancel(row)}
                            title="Cancel SPB (stok akan dikembalikan)"
                          >
                            <Ban className="mr-1.5 h-3.5 w-3.5" />
                            Cancel
                          </Button>
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

          <div className="space-y-2 border-t pt-4">
            <Label>Template Approval (Tanda Tangan Cetak)</Label>
            <p className="text-xs text-muted-foreground leading-relaxed">
              SPB tidak punya approval digital — template ini cuma menentukan
              nama-nama yang tercetak di slot tanda tangan. Kalau template-nya
              sudah direvisi (atau mau pakai template lain), pilih di sini lalu
              klik &ldquo;Perbarui&rdquo; supaya tidak perlu cancel & buat
              ulang SPB.
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={editTemplatePendingId ? String(editTemplatePendingId) : undefined}
                onValueChange={(v) => setEditTemplatePendingId(Number(v))}
                disabled={editLoadingTemplates || editTemplateOptions.length === 0}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue
                    placeholder={editLoadingTemplates ? "Memuat template..." : "Pilih template"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {editTemplateOptions.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name || `Template #${t.id}`}
                      {t.cabang_id === null ? " (Global)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={handleApplyEditTemplate}
                disabled={editApplyingTemplate || !editTemplatePendingId}
              >
                {editApplyingTemplate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="h-3.5 w-3.5" />
                )}
                Perbarui
              </Button>
            </div>
            {editApprovalsPreview && (
              <div className="rounded-md border bg-muted/40 p-2.5 text-xs space-y-1">
                <p className="font-semibold text-muted-foreground">
                  Akan tercetak sebagai:
                </p>
                {editApprovalsPreview.map((step, idx) => (
                  <p key={idx}>
                    {step.position ? `${step.position}: ` : ""}
                    {step.nama || "-"}
                  </p>
                ))}
                <p className="text-[11px] text-amber-600">
                  Belum tersimpan — klik &ldquo;Simpan Perubahan&rdquo; untuk menerapkan.
                </p>
              </div>
            )}
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

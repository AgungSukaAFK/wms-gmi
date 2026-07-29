"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Plus,
  Printer,
  Search,
  ShieldAlert,
  Truck,
} from "lucide-react";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { DatePickerString } from "@/components/date-picker-string";
import {
  approveSpbDo,
  createSpbDo,
  getStockOutApprovalTemplates,
  getSpbDoList,
  getSpbPoDetailsByPoId,
  getSpbPoOptionsForDo,
  rejectSpbDo,
} from "@/services/spb-actions";
import {
  moderatorEditSpbDo,
  ModeratorApprovalStep,
} from "@/services/moderator-edit-actions";
import { StockOutModeratorEditDialog } from "@/components/moderator/stock-out-moderator-edit-dialog";
import { cn, ymdToLocalStartIso } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type PoOption = {
  id: number;
  po_no: string;
  spb?: { spb_no?: string } | null;
};

type PoDetailRow = {
  id: number;
  spb_detail?: {
    dtl_spb_part_number: string;
    dtl_spb_part_name: string;
    dtl_spb_qty: number;
    dtl_spb_part_satuan: string;
  } | null;
};

type ApprovalTemplateOption = {
  id: number;
  name: string;
  cabang_id: number | null;
};

export default function SpbDoPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [poOptionSearch, setPoOptionSearch] = useState("");
  const [debouncedPoOptionSearch] = useDebounce(poOptionSearch, 300);

  const [poOptions, setPoOptions] = useState<PoOption[]>([]);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [selectedPoLabel, setSelectedPoLabel] = useState("");
  const [openPoCombobox, setOpenPoCombobox] = useState(false);
  const [poDetails, setPoDetails] = useState<PoDetailRow[]>([]);
  const [selectedDetailIds, setSelectedDetailIds] = useState<number[]>([]);

  const [doNo, setDoNo] = useState("");
  const [doDate, setDoDate] = useState("");
  const [doPic, setDoPic] = useState("");
  const [approvalTemplateId, setApprovalTemplateId] = useState("");
  const [approvalTemplates, setApprovalTemplates] = useState<
    ApprovalTemplateOption[]
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [userId, setUserId] = useState("");

  // Moderator Edit state
  const [isModerator, setIsModerator] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [modSaving, setModSaving] = useState(false);
  const [modRow, setModRow] = useState<any>(null);
  const [modDoDate, setModDoDate] = useState("");
  const [modDoStatusPart, setModDoStatusPart] = useState("");
  const [modDoPic, setModDoPic] = useState("");
  const [modApprovals, setModApprovals] = useState<ModeratorApprovalStep[]>([]);
  const [modRejectionReason, setModRejectionReason] = useState("");

  const selectedPo = useMemo(
    () => poOptions.find((s) => String(s.id) === selectedPoId),
    [poOptions, selectedPoId],
  );

  const fetchList = async () => {
    setLoading(true);
    const res = await getSpbDoList({
      search: debouncedSearch || undefined,
      page,
      limit,
    });
    if (res.error) {
      toast.error(res.error);
      setRows([]);
      setTotal(0);
    } else {
      setRows(res.data || []);
      setTotal(res.count || 0);
    }
    setLoading(false);
  };

  const fetchPoOptions = async () => {
    const res = await getSpbPoOptionsForDo({
      search: debouncedPoOptionSearch || undefined,
      limit: 15,
    });
    if (res.error) return;
    setPoOptions((res.data || []) as PoOption[]);
  };

  useEffect(() => {
    fetchList();
  }, [debouncedSearch, page, limit]);

  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        setUserId(user.id);
        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("roles(name)")
          .eq("user_id", user.id);
        setIsModerator(
          (roleRows || []).some((r: any) => r.roles?.name === "moderator"),
        );
      }
    };
    loadUser();
  }, [supabase]);

  useEffect(() => {
    if (!openCreateModal) return;
    fetchPoOptions();
  }, [openCreateModal, debouncedPoOptionSearch]);

  useEffect(() => {
    const loadTemplates = async () => {
      if (!openCreateModal) return;
      const res = await getStockOutApprovalTemplates("spb_do");
      if (!res.error) {
        setApprovalTemplates((res.data || []) as ApprovalTemplateOption[]);
      }
    };

    loadTemplates();
  }, [openCreateModal]);

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedPoId) {
        setPoDetails([]);
        setSelectedDetailIds([]);
        return;
      }
      const res = await getSpbPoDetailsByPoId(Number(selectedPoId));
      if (res.error) {
        toast.error(res.error);
        setPoDetails([]);
        return;
      }
      setPoDetails((res.data || []) as PoDetailRow[]);
      setSelectedDetailIds([]);
    };

    loadDetails();
  }, [selectedPoId]);

  const toggleDetail = (id: number, checked: boolean) => {
    setSelectedDetailIds((prev) =>
      checked ? [...prev, id] : prev.filter((v) => v !== id),
    );
  };

  const submit = async () => {
    if (!selectedPoId) return toast.error("Pilih SPB-PO.");
    if (!doNo.trim()) return toast.error("No DO wajib diisi.");
    if (!approvalTemplateId)
      return toast.error("Template approval wajib dipilih.");
    if (!selectedDetailIds.length) return toast.error("Pilih minimal 1 item.");

    setSubmitting(true);
    const res = await createSpbDo({
      spb_po_id: Number(selectedPoId),
      do_no: doNo,
      do_date: doDate ? ymdToLocalStartIso(doDate) : undefined,
      do_pic: doPic || undefined,
      approval_template_id: Number(approvalTemplateId),
      details: selectedDetailIds.map((id) => ({ spb_po_dtl_id: id })),
    });
    setSubmitting(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success("SPB-DO berhasil dibuat.");
    resetCreateForm();
    setOpenCreateModal(false);
    fetchList();
  };

  const resetCreateForm = () => {
    setDoNo("");
    setDoDate("");
    setDoPic("");
    setApprovalTemplateId("");
    setSelectedPoId("");
    setSelectedPoLabel("");
    setPoOptionSearch("");
    setOpenPoCombobox(false);
    setPoDetails([]);
    setSelectedDetailIds([]);
  };

  const handleOpenCreateModal = (open: boolean) => {
    setOpenCreateModal(open);
    if (!open) {
      resetCreateForm();
    }
  };

  const onApprove = async (id: number) => {
    const res = await approveSpbDo(id);
    if (res.error) return toast.error(res.error);
    toast.success("Approval SPB DO berhasil diproses.");
    fetchList();
  };

  const onReject = async (id: number) => {
    const reason = window.prompt("Alasan reject SPB DO:");
    if (!reason) return;
    const res = await rejectSpbDo(id, reason);
    if (res.error) return toast.error(res.error);
    toast.success("SPB DO berhasil direject.");
    fetchList();
  };

  const isMyApprovalTurn = (row: any) => {
    return (row.approvals || []).some(
      (a: any) => a.userid === userId && a.status === "pending",
    );
  };

  const normalizeApprovalStep = (a: any): ModeratorApprovalStep => ({
    userid: a.userid || a.user_id || "",
    nama: a.nama || "",
    email: a.email || "",
    approval_role:
      a.approval_role === "mengetahui" || a.level === "mengetahui"
        ? "mengetahui"
        : "menyetujui",
    status: a.status || "pending",
    processed_at: a.processed_at ?? null,
    signature_url: a.signature_url ?? null,
    notes: a.notes ?? null,
    snapshot: a.snapshot ?? null,
    position: a.position ?? null,
  });

  const openModEdit = (row: any) => {
    setModRow(row);
    setModDoDate(row.do_date ? String(row.do_date).slice(0, 10) : "");
    setModDoStatusPart(row.do_status_part || "");
    setModDoPic(row.do_pic || "");
    setModApprovals((row.approvals || []).map(normalizeApprovalStep));
    setModRejectionReason("");
    setModOpen(true);
  };

  const modWillBeApproved =
    modApprovals.length > 0 && modApprovals.every((a) => a.status === "approved");
  const modDowngradeLocked = modRow?.approval_status === "completed";
  const modBlockedDowngrade = modDowngradeLocked && !modWillBeApproved;

  const handleModSave = async () => {
    if (!modRow) return;
    setModSaving(true);
    const res = await moderatorEditSpbDo(modRow.id, {
      do_date: modDoDate ? ymdToLocalStartIso(modDoDate) : null,
      do_status_part: modDoStatusPart || null,
      do_pic: modDoPic || null,
      approvals: modApprovals,
      rejection_reason: modRejectionReason,
    });
    if (res.error) {
      toast.error(res.error);
      setModSaving(false);
      return;
    }
    toast.success("Moderator Edit berhasil disimpan.");
    setModOpen(false);
    setModSaving(false);
    fetchList();
  };

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                DELIVERY ORDER (SPB)
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Attach DO ke SPB-PO
              </p>
            </div>
          </div>

          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            onClick={() => setOpenCreateModal(true)}
          >
            <Plus className="h-4 w-4" /> BUAT SPB-DO
          </Button>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="space-y-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1 xl:min-w-70">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Cari No DO"
                className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
              />
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No SPB</TableHead>
                  <TableHead>No PO</TableHead>
                  <TableHead>No DO</TableHead>
                  <TableHead>Tanggal DO</TableHead>
                  <TableHead>Status Part</TableHead>
                  <TableHead>PIC</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-muted-foreground"
                    >
                      Memuat data...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-muted-foreground"
                    >
                      Belum ada data SPB-DO.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.po?.spb?.spb_no || "-"}</TableCell>
                      <TableCell>{row.po?.po_no || "-"}</TableCell>
                      <TableCell className="font-medium">{row.do_no}</TableCell>
                      <TableCell>
                        {row.do_date
                          ? new Date(row.do_date).toLocaleDateString("id-ID")
                          : "-"}
                      </TableCell>
                      <TableCell>{row.do_status_part || "-"}</TableCell>
                      <TableCell>{row.do_pic || "-"}</TableCell>
                      <TableCell>{row.approval_status || "open"}</TableCell>
                      <TableCell>
                        {new Date(row.created_at).toLocaleDateString("id-ID")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              window.open(`/spb/do/print/${row.id}`, "_blank")
                            }
                          >
                            <Printer className="mr-1.5 h-3.5 w-3.5" />
                            Cetak
                          </Button>
                          {row.approval_status === "open" &&
                            isMyApprovalTurn(row) && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onApprove(row.id)}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => onReject(row.id)}
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                          {isModerator && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 border-amber-300 text-amber-600 hover:bg-amber-50"
                              onClick={() => openModEdit(row)}
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              Moderator Edit
                            </Button>
                          )}
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
            itemLabel="SPB DO"
          />
        </div>
      </Content>

      <Dialog open={openCreateModal} onOpenChange={handleOpenCreateModal}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Buat SPB-DO</DialogTitle>
            <DialogDescription>
              Pilih SPB-PO, isi data DO, lalu pilih item detail PO.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Pilih SPB-PO</Label>
                <Popover open={openPoCombobox} onOpenChange={setOpenPoCombobox}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openPoCombobox}
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {selectedPo
                          ? `${selectedPo.po_no} - ${selectedPo.spb?.spb_no || "-"}`
                          : selectedPoLabel || "Pilih PO..."}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-(--radix-popover-trigger-width) p-0"
                    align="start"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Cari No PO..."
                        value={poOptionSearch}
                        onValueChange={setPoOptionSearch}
                      />
                      <CommandList>
                        <CommandEmpty>Tidak ada PO ditemukan.</CommandEmpty>
                        <CommandGroup>
                          {poOptions.map((po) => {
                            const value = String(po.id);
                            const label = `${po.po_no} - ${po.spb?.spb_no || "-"}`;

                            return (
                              <CommandItem
                                key={po.id}
                                value={label}
                                onSelect={() => {
                                  setSelectedPoId(value);
                                  setSelectedPoLabel(label);
                                  setOpenPoCombobox(false);
                                }}
                              >
                                <span className="truncate">{label}</span>
                                <Check
                                  className={cn(
                                    "ml-auto",
                                    selectedPoId === value
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Tanggal DO</Label>
                <DatePickerString value={doDate} onChange={setDoDate} />
              </div>

              <div className="space-y-2">
                <Label>No DO</Label>
                <Input value={doNo} onChange={(e) => setDoNo(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>PIC</Label>
                <Input
                  value={doPic}
                  onChange={(e) => setDoPic(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Template Approval</Label>
                <Select
                  value={approvalTemplateId}
                  onValueChange={setApprovalTemplateId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih template approval" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvalTemplates.map((tpl) => (
                      <SelectItem key={tpl.id} value={String(tpl.id)}>
                        {tpl.name}
                        {tpl.cabang_id ? " (Site)" : " (Global)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedPoId && (
              <div className="rounded-md border max-h-[45vh] overflow-auto">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Pilih</TableHead>
                      <TableHead className="w-32">Part Number</TableHead>
                      <TableHead>Part Name</TableHead>
                      <TableHead className="w-16">Qty</TableHead>
                      <TableHead className="w-20">Satuan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poDetails.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground"
                        >
                          Tidak ada detail item.
                        </TableCell>
                      </TableRow>
                    ) : (
                      poDetails.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedDetailIds.includes(item.id)}
                              onChange={(e) =>
                                toggleDetail(item.id, e.target.checked)
                              }
                            />
                          </TableCell>
                          <TableCell
                            className="truncate"
                            title={item.spb_detail?.dtl_spb_part_number || "-"}
                          >
                            {item.spb_detail?.dtl_spb_part_number || "-"}
                          </TableCell>
                          <TableCell
                            className="truncate"
                            title={item.spb_detail?.dtl_spb_part_name || "-"}
                          >
                            {item.spb_detail?.dtl_spb_part_name || "-"}
                          </TableCell>
                          <TableCell>
                            {item.spb_detail?.dtl_spb_qty || 0}
                          </TableCell>
                          <TableCell>
                            {item.spb_detail?.dtl_spb_part_satuan || "-"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenCreateModal(false)}
              disabled={submitting}
            >
              Batal
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Menyimpan..." : "Simpan SPB-DO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {modRow && (
        <StockOutModeratorEditDialog
          open={modOpen}
          onOpenChange={setModOpen}
          title={`Moderator Edit — SPB DO ${modRow.do_no}`}
          docType="spb_do"
          docId={modRow.id}
          fields={[
            { key: "do_date", label: "Tanggal DO", type: "date", value: modDoDate, onChange: setModDoDate },
            { key: "do_status_part", label: "Status Part", type: "text", value: modDoStatusPart, onChange: setModDoStatusPart },
            { key: "do_pic", label: "PIC", type: "text", value: modDoPic, onChange: setModDoPic },
          ]}
          approvals={modApprovals}
          onApprovalsChange={setModApprovals}
          rejectionReason={modRejectionReason}
          onRejectionReasonChange={setModRejectionReason}
          downgradeLocked={modDowngradeLocked}
          downgradeLockedMessage="SPB DO ini berstatus completed. Kalau sudah ada SPB Invoice turunan, status approval tidak bisa diturunkan dari 'completed'."
          blockedDowngrade={modBlockedDowngrade}
          saving={modSaving}
          onSave={handleModSave}
        />
      )}
    </>
  );
}

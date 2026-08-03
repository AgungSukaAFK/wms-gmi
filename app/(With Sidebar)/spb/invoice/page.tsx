"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Check,
  ChevronsUpDown,
  Plus,
  Printer,
  Search,
  ShieldAlert,
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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { DatePickerString } from "@/components/date-picker-string";
import {
  approveSpbInvoice,
  createSpbInvoice,
  getStockOutApprovalTemplates,
  getSpbDoDetailsByDoId,
  getSpbDoOptionsForInvoice,
  getSpbInvoiceList,
  rejectSpbInvoice,
} from "@/services/spb-actions";
import {
  moderatorEditSpbInvoice,
  ModeratorApprovalStep,
} from "@/services/moderator-edit-actions";
import { StockOutModeratorEditDialog } from "@/components/moderator/stock-out-moderator-edit-dialog";
import { cn, ymdToLocalStartIso } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type DoOption = {
  id: number;
  do_no: string;
  po?: {
    po_no?: string;
    spb?: { spb_no?: string } | null;
  } | null;
};

type DoDetailRow = {
  id: number;
  po_detail?: {
    spb_detail?: {
      dtl_spb_part_number: string;
      dtl_spb_part_name: string;
      dtl_spb_qty: number;
      dtl_spb_part_satuan: string;
    } | null;
  } | null;
};

type ApprovalTemplateOption = {
  id: number;
  name: string;
  cabang_id: number | null;
};

export default function SpbInvoicePage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState("created_at_desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [doOptionSearch, setDoOptionSearch] = useState("");
  const [debouncedDoOptionSearch] = useDebounce(doOptionSearch, 300);

  const [doOptions, setDoOptions] = useState<DoOption[]>([]);
  const [selectedDoId, setSelectedDoId] = useState("");
  const [selectedDoLabel, setSelectedDoLabel] = useState("");
  const [openDoCombobox, setOpenDoCombobox] = useState(false);
  const [doDetails, setDoDetails] = useState<DoDetailRow[]>([]);
  const [selectedDetailIds, setSelectedDetailIds] = useState<number[]>([]);

  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [emailDate, setEmailDate] = useState("");
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
  const [modInvoiceDate, setModInvoiceDate] = useState("");
  const [modInvoiceEmailDate, setModInvoiceEmailDate] = useState("");
  const [modApprovals, setModApprovals] = useState<ModeratorApprovalStep[]>([]);
  const [modRejectionReason, setModRejectionReason] = useState("");
  const [modTemplateId, setModTemplateId] = useState<number | null>(null);

  const selectedDo = useMemo(
    () => doOptions.find((s) => String(s.id) === selectedDoId),
    [doOptions, selectedDoId],
  );

  const fetchList = async () => {
    setLoading(true);
    const res = await getSpbInvoiceList({
      search: debouncedSearch || undefined,
      sort,
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

  const fetchDoOptions = async () => {
    const res = await getSpbDoOptionsForInvoice({
      search: debouncedDoOptionSearch || undefined,
      limit: 15,
    });
    if (res.error) return;
    setDoOptions((res.data || []) as DoOption[]);
  };

  useEffect(() => {
    fetchList();
  }, [debouncedSearch, sort, page, limit]);

  const handleSortChange = (nextSort: string) => {
    setSort(nextSort);
    setPage(1);
  };

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
    fetchDoOptions();
  }, [openCreateModal, debouncedDoOptionSearch]);

  useEffect(() => {
    const loadTemplates = async () => {
      if (!openCreateModal) return;
      const res = await getStockOutApprovalTemplates("spb_invoice");
      if (!res.error) {
        setApprovalTemplates((res.data || []) as ApprovalTemplateOption[]);
      }
    };

    loadTemplates();
  }, [openCreateModal]);

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedDoId) {
        setDoDetails([]);
        setSelectedDetailIds([]);
        return;
      }
      const res = await getSpbDoDetailsByDoId(Number(selectedDoId));
      if (res.error) {
        toast.error(res.error);
        setDoDetails([]);
        return;
      }
      setDoDetails((res.data || []) as DoDetailRow[]);
      setSelectedDetailIds([]);
    };

    loadDetails();
  }, [selectedDoId]);

  const toggleDetail = (id: number, checked: boolean) => {
    setSelectedDetailIds((prev) =>
      checked ? [...prev, id] : prev.filter((v) => v !== id),
    );
  };

  const submit = async () => {
    if (!selectedDoId) return toast.error("Pilih SPB-DO.");
    if (!invoiceNo.trim()) return toast.error("No Invoice wajib diisi.");
    if (!approvalTemplateId)
      return toast.error("Template approval wajib dipilih.");
    if (!selectedDetailIds.length) return toast.error("Pilih minimal 1 item.");

    setSubmitting(true);
    const res = await createSpbInvoice({
      spb_do_id: Number(selectedDoId),
      invoice_no: invoiceNo,
      invoice_date: invoiceDate ? ymdToLocalStartIso(invoiceDate) : undefined,
      invoice_email_date: emailDate ? ymdToLocalStartIso(emailDate) : undefined,
      approval_template_id: Number(approvalTemplateId),
      details: selectedDetailIds.map((id) => ({ spb_do_dtl_id: id })),
    });
    setSubmitting(false);

    if (res.error) {
      toast.error(res.error);
      return;
    }

    toast.success("Invoice SPB berhasil dibuat.");
    resetCreateForm();
    setOpenCreateModal(false);
    fetchList();
  };

  const resetCreateForm = () => {
    setInvoiceNo("");
    setInvoiceDate("");
    setEmailDate("");
    setApprovalTemplateId("");
    setSelectedDoId("");
    setSelectedDoLabel("");
    setDoOptionSearch("");
    setOpenDoCombobox(false);
    setDoDetails([]);
    setSelectedDetailIds([]);
  };

  const handleOpenCreateModal = (open: boolean) => {
    setOpenCreateModal(open);
    if (!open) {
      resetCreateForm();
    }
  };

  const onApprove = async (id: number) => {
    const res = await approveSpbInvoice(id);
    if (res.error) return toast.error(res.error);
    toast.success("Approval invoice berhasil diproses.");
    fetchList();
  };

  const onReject = async (id: number) => {
    const reason = window.prompt("Alasan reject Invoice SPB:");
    if (!reason) return;
    const res = await rejectSpbInvoice(id, reason);
    if (res.error) return toast.error(res.error);
    toast.success("Invoice SPB berhasil direject.");
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
    setModInvoiceDate(row.invoice_date ? String(row.invoice_date).slice(0, 10) : "");
    setModInvoiceEmailDate(
      row.invoice_email_date ? String(row.invoice_email_date).slice(0, 10) : "",
    );
    setModApprovals((row.approvals || []).map(normalizeApprovalStep));
    setModRejectionReason("");
    setModTemplateId(row.approval_template_id ?? null);
    setModOpen(true);
  };

  const handleModSave = async () => {
    if (!modRow) return;
    setModSaving(true);
    const res = await moderatorEditSpbInvoice(modRow.id, {
      invoice_date: modInvoiceDate ? ymdToLocalStartIso(modInvoiceDate) : null,
      invoice_email_date: modInvoiceEmailDate ? ymdToLocalStartIso(modInvoiceEmailDate) : null,
      approval_template_id: modTemplateId ?? undefined,
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
              <BadgeDollarSign className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                INVOICE (SPB)
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Attach Invoice ke SPB-DO
              </p>
            </div>
          </div>

          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            onClick={() => setOpenCreateModal(true)}
          >
            <Plus className="h-4 w-4" /> BUAT INVOICE
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
                placeholder="Cari No Invoice"
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
                  <SortableTableHead
                    sortKey="invoice_no"
                    currentSort={sort}
                    onSort={handleSortChange}
                  >
                    No Invoice
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="invoice_date"
                    currentSort={sort}
                    onSort={handleSortChange}
                    defaultDir="desc"
                  >
                    Tanggal Invoice
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="invoice_email_date"
                    currentSort={sort}
                    onSort={handleSortChange}
                    defaultDir="desc"
                  >
                    Tanggal Email
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="approval_status"
                    currentSort={sort}
                    onSort={handleSortChange}
                  >
                    Approval
                  </SortableTableHead>
                  <SortableTableHead
                    sortKey="created_at"
                    currentSort={sort}
                    onSort={handleSortChange}
                    defaultDir="desc"
                  >
                    Created
                  </SortableTableHead>
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
                      Belum ada data invoice.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.do?.po?.spb?.spb_no || "-"}</TableCell>
                      <TableCell>{row.do?.po?.po_no || "-"}</TableCell>
                      <TableCell>{row.do?.do_no || "-"}</TableCell>
                      <TableCell className="font-medium">
                        {row.invoice_no}
                      </TableCell>
                      <TableCell>
                        {row.invoice_date
                          ? new Date(row.invoice_date).toLocaleDateString(
                              "id-ID",
                            )
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {row.invoice_email_date
                          ? new Date(row.invoice_email_date).toLocaleDateString(
                              "id-ID",
                            )
                          : "-"}
                      </TableCell>
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
                              window.open(
                                `/spb/invoice/print/${row.id}`,
                                "_blank",
                              )
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
            itemLabel="Invoice SPB"
          />
        </div>
      </Content>

      <Dialog open={openCreateModal} onOpenChange={handleOpenCreateModal}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Buat Invoice SPB</DialogTitle>
            <DialogDescription>
              Pilih SPB-DO, isi data invoice, lalu pilih item detail DO.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Pilih SPB-DO</Label>
                <Popover open={openDoCombobox} onOpenChange={setOpenDoCombobox}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openDoCombobox}
                      className="w-full justify-between font-normal"
                    >
                      <span className="truncate">
                        {selectedDo
                          ? `${selectedDo.do_no} - ${selectedDo.po?.spb?.spb_no || "-"}`
                          : selectedDoLabel || "Pilih DO..."}
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
                        placeholder="Cari No DO..."
                        value={doOptionSearch}
                        onValueChange={setDoOptionSearch}
                      />
                      <CommandList>
                        <CommandEmpty>Tidak ada DO ditemukan.</CommandEmpty>
                        <CommandGroup>
                          {doOptions.map((item) => {
                            const value = String(item.id);
                            const label = `${item.do_no} - ${item.po?.spb?.spb_no || "-"}`;

                            return (
                              <CommandItem
                                key={item.id}
                                value={label}
                                onSelect={() => {
                                  setSelectedDoId(value);
                                  setSelectedDoLabel(label);
                                  setOpenDoCombobox(false);
                                }}
                              >
                                <span className="truncate">{label}</span>
                                <Check
                                  className={cn(
                                    "ml-auto",
                                    selectedDoId === value
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
                <Label>Tanggal Invoice</Label>
                <DatePickerString
                  value={invoiceDate}
                  onChange={setInvoiceDate}
                />
              </div>

              <div className="space-y-2">
                <Label>No Invoice</Label>
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Tanggal Email</Label>
                <DatePickerString value={emailDate} onChange={setEmailDate} />
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

            {selectedDoId && (
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
                    {doDetails.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground"
                        >
                          Tidak ada detail item.
                        </TableCell>
                      </TableRow>
                    ) : (
                      doDetails.map((item) => (
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
                            title={
                              item.po_detail?.spb_detail?.dtl_spb_part_number ||
                              "-"
                            }
                          >
                            {item.po_detail?.spb_detail?.dtl_spb_part_number ||
                              "-"}
                          </TableCell>
                          <TableCell
                            className="truncate"
                            title={
                              item.po_detail?.spb_detail?.dtl_spb_part_name ||
                              "-"
                            }
                          >
                            {item.po_detail?.spb_detail?.dtl_spb_part_name ||
                              "-"}
                          </TableCell>
                          <TableCell>
                            {item.po_detail?.spb_detail?.dtl_spb_qty || 0}
                          </TableCell>
                          <TableCell>
                            {item.po_detail?.spb_detail?.dtl_spb_part_satuan ||
                              "-"}
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
              {submitting ? "Menyimpan..." : "Simpan Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {modRow && (
        <StockOutModeratorEditDialog
          open={modOpen}
          onOpenChange={setModOpen}
          title={`Moderator Edit — SPB Invoice ${modRow.invoice_no}`}
          docType="spb_invoice"
          docId={modRow.id}
          fields={[
            {
              key: "invoice_date",
              label: "Tanggal Invoice",
              type: "date",
              value: modInvoiceDate,
              onChange: setModInvoiceDate,
            },
            {
              key: "invoice_email_date",
              label: "Tanggal Email",
              type: "date",
              value: modInvoiceEmailDate,
              onChange: setModInvoiceEmailDate,
            },
          ]}
          approvals={modApprovals}
          onApprovalsChange={setModApprovals}
          rejectionReason={modRejectionReason}
          onRejectionReasonChange={setModRejectionReason}
          downgradeLocked={false}
          downgradeLockedMessage=""
          blockedDowngrade={false}
          saving={modSaving}
          onSave={handleModSave}
          currentTemplateId={modTemplateId}
          onTemplateIdChange={setModTemplateId}
        />
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDebounce } from "use-debounce";
import { Plus, Printer, Search, ShieldAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  approveReturnSpb,
  getReturnSpbList,
  rejectReturnSpb,
} from "@/services/spb-actions";
import {
  moderatorEditReturnSpb,
  ModeratorApprovalStep,
} from "@/services/moderator-edit-actions";
import { StockOutModeratorEditDialog } from "@/components/moderator/stock-out-moderator-edit-dialog";
import { createClient } from "@/lib/supabase/client";
import { SortableTableHead } from "@/components/ui/sortable-table-head";

export default function ReturnSpbPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 500);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState("created_at_desc");
  const [userId, setUserId] = useState("");

  // Moderator Edit state
  const [isModerator, setIsModerator] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [modSaving, setModSaving] = useState(false);
  const [modRow, setModRow] = useState<any>(null);
  const [modRtnTanggal, setModRtnTanggal] = useState("");
  const [modRtnNote, setModRtnNote] = useState("");
  const [modApprovals, setModApprovals] = useState<ModeratorApprovalStep[]>([]);
  const [modRejectionReason, setModRejectionReason] = useState("");
  const [modTemplateId, setModTemplateId] = useState<number | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const res = await getReturnSpbList({
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

  useEffect(() => {
    fetchData();
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
    setModRtnTanggal(row.rtn_tanggal ? String(row.rtn_tanggal).slice(0, 10) : "");
    setModRtnNote(row.rtn_note || "");
    setModApprovals((row.approvals || []).map(normalizeApprovalStep));
    setModRejectionReason("");
    setModTemplateId(row.approval_template_id ?? null);
    setModOpen(true);
  };

  const modWillBeApproved =
    modApprovals.length > 0 && modApprovals.every((a) => a.status === "approved");
  const modDowngradeLocked = modRow?.approval_status === "completed";
  const modBlockedDowngrade = modDowngradeLocked && !modWillBeApproved;

  const handleModSave = async () => {
    if (!modRow) return;
    setModSaving(true);
    const res = await moderatorEditReturnSpb(modRow.id, {
      rtn_tanggal: modRtnTanggal || undefined,
      rtn_note: modRtnNote || null,
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
    fetchData();
  };

  const onApprove = async (id: number) => {
    const res = await approveReturnSpb(id);
    if (res.error) return toast.error(res.error);
    toast.success("Approval return berhasil diproses.");
    fetchData();
  };

  const onReject = async (id: number) => {
    const reason = window.prompt("Alasan reject Return SPB:");
    if (!reason) return;
    const res = await rejectReturnSpb(id, reason);
    if (res.error) return toast.error(res.error);
    toast.success("Return SPB berhasil direject.");
    fetchData();
  };

  return (
    <>
      <Content>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <Undo2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                RETURN SPB
              </h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Pengembalian barang dari SPB
              </p>
            </div>
          </div>
          <Button
            className="h-9 shrink-0 gap-2 rounded-md px-4 text-xs font-bold uppercase shadow-sm"
            asChild
          >
            <Link href="/return-spb/create">
              <Plus className="h-4 w-4" /> BUAT RETURN
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
              placeholder="Cari kode return"
              className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium text-foreground transition-all focus:bg-background"
            />
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  sortKey="rtn_kode"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  Kode Return
                </SortableTableHead>
                <TableHead>No SPB</TableHead>
                <SortableTableHead
                  sortKey="rtn_tanggal"
                  currentSort={sort}
                  onSort={handleSortChange}
                  defaultDir="desc"
                >
                  Tanggal Return
                </SortableTableHead>
                <SortableTableHead
                  sortKey="rtn_status"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  Status
                </SortableTableHead>
                <SortableTableHead
                  sortKey="approval_status"
                  currentSort={sort}
                  onSort={handleSortChange}
                >
                  Approval
                </SortableTableHead>
                <TableHead>Catatan</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground"
                  >
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground"
                  >
                    Belum ada data return.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.rtn_kode}
                    </TableCell>
                    <TableCell>{row.spb?.spb_no || "-"}</TableCell>
                    <TableCell>
                      {new Date(row.rtn_tanggal).toLocaleDateString("id-ID")}
                    </TableCell>
                    <TableCell>{row.rtn_status}</TableCell>
                    <TableCell>{row.approval_status || "open"}</TableCell>
                    <TableCell>{row.rtn_note || "-"}</TableCell>
                    <TableCell>
                      {new Date(row.created_at).toLocaleDateString("id-ID")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(`/return-spb/print/${row.id}`, "_blank")
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
          itemLabel="Return SPB"
        />
      </Content>

      {modRow && (
        <StockOutModeratorEditDialog
          open={modOpen}
          onOpenChange={setModOpen}
          title={`Moderator Edit — Return SPB ${modRow.rtn_kode}`}
          docType="return_spb"
          docId={modRow.id}
          fields={[
            {
              key: "rtn_tanggal",
              label: "Tanggal Return",
              type: "date",
              value: modRtnTanggal,
              onChange: setModRtnTanggal,
            },
            {
              key: "rtn_note",
              label: "Catatan",
              type: "textarea",
              value: modRtnNote,
              onChange: setModRtnNote,
            },
          ]}
          approvals={modApprovals}
          onApprovalsChange={setModApprovals}
          rejectionReason={modRejectionReason}
          onRejectionReasonChange={setModRejectionReason}
          downgradeLocked={modDowngradeLocked}
          downgradeLockedMessage="Return ini berstatus completed, kemungkinan sudah diposting ke stok. Status approval tidak bisa diturunkan dari 'completed' tanpa membereskan posting tersebut terlebih dahulu."
          blockedDowngrade={modBlockedDowngrade}
          saving={modSaving}
          onSave={handleModSave}
          currentTemplateId={modTemplateId}
          onTemplateIdChange={setModTemplateId}
        />
      )}
    </>
  );
}

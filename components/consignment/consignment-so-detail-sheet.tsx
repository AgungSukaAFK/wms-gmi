"use client";

import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Handshake,
  Package,
  MapPin,
  FileText,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import {
  deleteConsignmentSo,
  updateConsignmentSo,
} from "@/services/consignment-so-actions";

interface Props {
  soId: number | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onUpdate?: () => void;
}

export function ConsignmentSoDetailSheet({
  soId,
  open,
  onOpenChange,
  onUpdate,
}: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [soRow, setSoRow] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [roleNames, setRoleNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    so_tanggal_input: "",
    tgl_po_email_marketing: "",
    tgl_po_customer: "",
    due_date: "",
    no_po: "",
    site: "",
  });

  const fetchData = async () => {
    if (!soId) return;
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("user_roles(roles(name))")
        .eq("id", user.id)
        .single();
      const rNames = ((profile as any)?.user_roles || [])
        .map((row: any) => row?.roles?.name)
        .filter((name: string | undefined): name is string => Boolean(name));
      setRoleNames(rNames);
    }
    const { data: soData } = await supabase
      .from("consignment_so")
      .select("*, customer:customers!customer_id(customer_name, customer_no)")
      .eq("id", soId)
      .single();
    setSoRow(soData);
    const { data: itemData } = await supabase
      .from("consignment_so_items")
      .select("*")
      .eq("so_id", soId);
    setItems(itemData || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open && soId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, soId]);

  const isModeratorOrAdmin = roleNames.some(
    (r) => r === "moderator" || r === "admin",
  );

  const refresh = async () => {
    await fetchData();
    onUpdate?.();
  };

  const openEditDialog = () => {
    if (!soRow) return;
    setEditForm({
      so_tanggal_input: soRow.so_tanggal_input
        ? String(soRow.so_tanggal_input).slice(0, 10)
        : "",
      tgl_po_email_marketing: soRow.tgl_po_email_marketing
        ? String(soRow.tgl_po_email_marketing).slice(0, 10)
        : "",
      tgl_po_customer: soRow.tgl_po_customer
        ? String(soRow.tgl_po_customer).slice(0, 10)
        : "",
      due_date: soRow.due_date ? String(soRow.due_date).slice(0, 10) : "",
      no_po: soRow.no_po || "",
      site: soRow.site || "",
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!soId) return;
    setEditSaving(true);
    const res = await updateConsignmentSo(soId, {
      so_tanggal_input: editForm.so_tanggal_input || undefined,
      tgl_po_email_marketing: editForm.tgl_po_email_marketing || undefined,
      tgl_po_customer: editForm.tgl_po_customer || undefined,
      due_date: editForm.due_date || undefined,
      no_po: editForm.no_po || undefined,
      site: editForm.site || undefined,
    });
    setEditSaving(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("SO Consignment berhasil diperbarui");
    setEditOpen(false);
    await refresh();
  };

  const handleDelete = async () => {
    if (!soId || !soRow) return;
    const ok = window.confirm(
      `Hapus SO Consignment ${soRow.so_no}?\n\nSemua item detail akan ikut terhapus.`,
    );
    if (!ok) return;
    setBusy(true);
    const res = await deleteConsignmentSo(soId);
    setBusy(false);
    if ((res as any).error) return toast.error((res as any).error);
    toast.success("SO Consignment berhasil dihapus");
    onOpenChange(false);
    await refresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col gap-0 overflow-hidden">
        {loading || !soRow ? (
          <div className="flex-1 flex items-center justify-center">
            <SheetTitle className="sr-only">Memuat SO Consignment</SheetTitle>
            <SheetDescription className="sr-only">Memuat detail.</SheetDescription>
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="p-6 bg-muted/40 border-b space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Handshake className="h-3.5 w-3.5" /> SO Consignment
              </span>
              <SheetTitle className="text-xl font-bold uppercase tracking-tight">
                {soRow.so_no}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Detail SO Consignment {soRow.so_no}
              </SheetDescription>
              <div className="text-xs font-bold uppercase text-success">
                {soRow.customer?.customer_name || "-"}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium text-muted-foreground uppercase">
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" /> PO: {soRow.no_po || "-"}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Site: {soRow.site || "-"}
                </span>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Tanggal */}
              <div className="text-xs space-y-1.5">
                <h4 className="text-[10px] font-black uppercase text-muted-foreground mb-1">
                  Tanggal
                </h4>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tgl Input SO</span>
                  <span className="font-semibold">
                    {soRow.so_tanggal_input ? formatDate(soRow.so_tanggal_input) : "-"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tgl Email PO Marketing</span>
                  <span className="font-semibold">
                    {soRow.tgl_po_email_marketing
                      ? formatDate(soRow.tgl_po_email_marketing)
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tgl PO Customer</span>
                  <span className="font-semibold">
                    {soRow.tgl_po_customer ? formatDate(soRow.tgl_po_customer) : "-"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due Date</span>
                  <span className="font-semibold">
                    {soRow.due_date ? formatDate(soRow.due_date) : "-"}
                  </span>
                </div>
              </div>

              {/* Items */}
              <div>
                <h4 className="text-[10px] font-black uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" /> Item
                </h4>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="h-8 hover:bg-transparent">
                        <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                          Part
                        </TableHead>
                        <TableHead className="w-16 text-center text-[10px] font-black uppercase text-muted-foreground">
                          Qty
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((line) => (
                        <TableRow key={line.id} className="h-12">
                          <TableCell>
                            <span className="text-xs font-semibold">{line.part_name}</span>
                            <code className="block text-[10px] text-muted-foreground">
                              {line.part_number}
                            </code>
                            {(line.part_number_customer || line.code_item_customer) && (
                              <span className="block text-[9px] text-muted-foreground/80 mt-0.5">
                                {line.part_number_customer && `PN Cust: ${line.part_number_customer}`}
                                {line.part_number_customer && line.code_item_customer && " · "}
                                {line.code_item_customer && `Code: ${line.code_item_customer}`}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs font-bold">
                            {line.qty} {line.satuan}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            {/* Actions */}
            {isModeratorOrAdmin && (
              <div className="border-t p-4 bg-background">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    disabled={busy}
                    onClick={openEditDialog}
                  >
                    Edit Data
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={handleDelete}
                  >
                    <XCircle className="h-4 w-4" /> Hapus
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </SheetContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit SO Consignment</DialogTitle>
            <DialogDescription>
              Moderator/admin dapat memperbarui data header tanpa mengubah item.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="so_tanggal_input">Tgl Input SO</Label>
              <Input
                id="so_tanggal_input"
                type="date"
                value={editForm.so_tanggal_input}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    so_tanggal_input: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tgl_po_email_marketing">Tgl Email PO Marketing</Label>
              <Input
                id="tgl_po_email_marketing"
                type="date"
                value={editForm.tgl_po_email_marketing}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    tgl_po_email_marketing: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tgl_po_customer">Tgl PO Customer</Label>
              <Input
                id="tgl_po_customer"
                type="date"
                value={editForm.tgl_po_customer}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    tgl_po_customer: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due_date">Due Date</Label>
              <Input
                id="due_date"
                type="date"
                value={editForm.due_date}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, due_date: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="no_po">No. PO</Label>
              <Input
                id="no_po"
                value={editForm.no_po}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, no_po: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="site">Site</Label>
              <Input
                id="site"
                value={editForm.site}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, site: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

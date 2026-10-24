"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Loader2, Pencil, Plus, ToggleLeft, X } from "lucide-react";
import { toast } from "sonner";
import {
  createCustomerSite,
  getCustomerSites,
  updateCustomerSite,
} from "@/services/master-actions";

type SiteForm = {
  site_name: string;
  alamat: string;
};

const emptyForm: SiteForm = { site_name: "", alamat: "" };

export function CustomerSitesDialog({
  customer,
  open,
  onOpenChange,
  canWrite,
}: {
  customer: { id: number; customer_name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
}) {
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SiteForm>(emptyForm);

  const fetchSites = async () => {
    if (!customer) return;
    setLoading(true);
    const res = await getCustomerSites(customer.id);
    if (res.error) toast.error(res.error);
    setSites(res.data);
    setLoading(false);
  };

  useEffect(() => {
    if (!open || !customer) return;
    setEditingId(null);
    setForm(emptyForm);
    fetchSites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id]);

  const startEdit = (site: any) => {
    setEditingId(site.id);
    setForm({
      site_name: site.site_name || "",
      alamat: site.alamat || "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSubmit = async () => {
    if (!customer) return;
    if (!form.site_name.trim()) return toast.error("Nama site wajib diisi");
    setSaving(true);
    const payload = { site_name: form.site_name, alamat: form.alamat };
    const editingSite = sites.find((s) => s.id === editingId);
    const res = editingId
      ? await updateCustomerSite(editingId, {
          ...payload,
          // Kolom lama (site -> gudang cabang) sudah tidak dipakai IK; nilai
          // yang ada dibiarkan.
          cabang_id: editingSite?.cabang_id ?? null,
          is_active: editingSite?.is_active ?? true,
        })
      : await createCustomerSite(customer.id, payload);
    setSaving(false);
    if (res.error) return toast.error(res.error);
    toast.success(editingId ? "Site diperbarui" : "Site ditambahkan");
    cancelEdit();
    fetchSites();
  };

  const handleToggle = async (site: any) => {
    const res = await updateCustomerSite(site.id, {
      site_name: site.site_name,
      alamat: site.alamat || "",
      cabang_id: site.cabang_id,
      is_active: !site.is_active,
    });
    if (res.error) return toast.error(res.error);
    fetchSites();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Site Customer</DialogTitle>
          <DialogDescription>
            {customer?.customer_name} — site (gudang customer) ini muncul di
            dropdown Site SO Consignment dan Site Tujuan Invoice Konsinyasi.
          </DialogDescription>
        </DialogHeader>

        {canWrite && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-md border border-border p-3 bg-muted/30">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Nama Site
              </Label>
              <Input
                value={form.site_name}
                onChange={(e) => setForm((p) => ({ ...p, site_name: e.target.value }))}
                placeholder="Contoh: SITE TUTUPAN"
                className="h-9 text-sm uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                Alamat
              </Label>
              <Input
                value={form.alamat}
                onChange={(e) => setForm((p) => ({ ...p, alamat: e.target.value }))}
                placeholder="Opsional"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex gap-1.5">
              <Button onClick={handleSubmit} disabled={saving} className="h-9 gap-1.5">
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : editingId ? (
                  <Pencil className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {editingId ? "Simpan" : "Tambah"}
              </Button>
              {editingId && (
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={cancelEdit}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">Site</TableHead>
                <TableHead className="w-24 text-center text-[10px] font-black uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="w-24 text-right pr-4 text-[10px] font-black uppercase text-muted-foreground">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : sites.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center text-sm italic text-muted-foreground">
                    Belum ada site untuk customer ini.
                  </TableCell>
                </TableRow>
              ) : (
                sites.map((site) => (
                  <TableRow key={site.id} className={editingId === site.id ? "bg-muted/40" : ""}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold text-xs uppercase">{site.site_name}</span>
                        <span className="text-[10px] text-muted-foreground line-clamp-1">
                          {site.alamat || "-"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={site.is_active ? "default" : "secondary"}
                        className="text-[10px] font-bold uppercase"
                      >
                        {site.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => startEdit(site)}
                          disabled={!canWrite}
                          title="Edit site"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleToggle(site)}
                          disabled={!canWrite}
                          title="Toggle status"
                        >
                          <ToggleLeft className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

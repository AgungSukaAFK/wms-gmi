"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
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
import {
  Search,
  Loader2,
  PackageSearch,
  ArrowRight,
  CalendarClock,
  AlertTriangle,
  FilterX,
} from "lucide-react";
import { useDebounce } from "use-debounce";
import type { PlanningSupply } from "@/type";
import { businessToday } from "@/lib/business-date";

const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  in_transit: {
    label: "Dalam Pengiriman",
    className: "bg-primary/10 text-primary border-primary/30",
  },
  received: {
    label: "Diterima",
    className: "bg-success/10 text-success border-success/30",
  },
  cancelled: {
    label: "Dibatalkan",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

export default function PlanningSupplyPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PlanningSupply[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 400);
  const [statusFilter, setStatusFilter] = useState<string>("active");

  const today = businessToday();

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("id, nama, cabang_id, cabang(nama_cabang)")
        .eq("id", user.id)
        .single();
      setProfile(prof);

      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      const roleNames = (roleRows || [])
        .map((r: any) => r?.roles?.name)
        .filter(Boolean);
      setIsModerator(roleNames.includes("moderator"));
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    if (!profile) return;
    setLoading(true);

    let query = supabase
      .from("planning_supplies")
      .select(
        "*, mrs(mr_kode), deliveries(dlv_kode), source_cabang:cabang!source_cabang_id(nama_cabang), dest_cabang:cabang!dest_cabang_id(nama_cabang)",
      )
      .order("created_at", { ascending: false });

    // Admin divisi hanya melihat barang yang akan masuk ke cabangnya.
    // Moderator melihat semua cabang.
    if (!isModerator && profile.cabang_id) {
      query = query.eq("dest_cabang_id", profile.cabang_id);
    }

    if (statusFilter === "active") {
      query = query.eq("status", "in_transit");
    } else if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query.limit(500);
    if (!error) setRows((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, isModerator, statusFilter]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.part_number,
        r.part_name,
        r.mrs?.mr_kode,
        r.deliveries?.dlv_kode,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, debouncedSearch]);

  const totalInTransitQty = useMemo(
    () =>
      rows
        .filter((r) => r.status === "in_transit")
        .reduce((sum, r) => sum + (r.qty || 0), 0),
    [rows],
  );

  const isOverdue = (r: PlanningSupply) =>
    r.status === "in_transit" && r.deadline && r.deadline < today;

  return (
    <>
      {/* Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <PackageSearch className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Planning Supply
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                {isModerator
                  ? "Barang akan masuk — semua cabang"
                  : `Barang akan masuk ke ${
                      profile?.cabang?.nama_cabang || "cabang Anda"
                    }`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Total Dalam Pengiriman
            </span>
            <span className="text-lg font-black text-primary">
              {totalInTransitQty}
            </span>
          </div>
        </div>
      </Content>

      {/* Filter */}
      <Content>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari PN, nama barang, kode MR/Delivery..."
              className="pl-9 h-9 border-input bg-muted/40 focus:bg-background transition-all rounded-md text-xs font-medium"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-full sm:w-48 text-xs font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Dalam Pengiriman</SelectItem>
              <SelectItem value="received">Diterima</SelectItem>
              <SelectItem value="cancelled">Dibatalkan</SelectItem>
              <SelectItem value="all">Semua Status</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-destructive"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("active");
            }}
          >
            <FilterX className="h-4 w-4" />
          </Button>
        </div>
      </Content>

      {/* Table */}
      <Content>
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-[10px] font-bold uppercase">
                  Barang
                </TableHead>
                <TableHead className="text-[10px] font-bold uppercase">
                  Rute
                </TableHead>
                <TableHead className="text-[10px] font-bold uppercase text-center">
                  Qty
                </TableHead>
                <TableHead className="text-[10px] font-bold uppercase">
                  Deadline
                </TableHead>
                <TableHead className="text-[10px] font-bold uppercase">
                  Referensi
                </TableHead>
                <TableHead className="text-[10px] font-bold uppercase">
                  Status / Keterangan
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
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-32 text-center text-xs font-semibold text-muted-foreground"
                  >
                    Tidak ada data planning supply.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const meta = STATUS_META[r.status] || {
                    label: r.status,
                    className: "",
                  };
                  const overdue = isOverdue(r);
                  return (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="font-mono text-xs font-bold text-foreground">
                          {r.part_number}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.part_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                          <span className="text-muted-foreground">
                            {r.source_cabang?.nama_cabang || "-"}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-foreground">
                            {r.dest_cabang?.nama_cabang || "-"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-black text-sm">
                        {r.qty} <span className="text-[10px] font-normal text-muted-foreground">{r.satuan}</span>
                      </TableCell>
                      <TableCell>
                        {r.deadline ? (
                          <div
                            className={`flex items-center gap-1 text-[11px] font-bold ${
                              overdue ? "text-destructive" : "text-foreground"
                            }`}
                          >
                            {overdue ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : (
                              <CalendarClock className="h-3 w-3" />
                            )}
                            {r.deadline}
                            {overdue && (
                              <span className="text-[9px] uppercase">
                                (lewat)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            -
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-[11px] font-bold text-foreground">
                          {r.deliveries?.dlv_kode || "-"}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {r.mrs?.mr_kode || ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-bold uppercase ${meta.className}`}
                        >
                          {meta.label}
                        </Badge>
                        {r.status === "cancelled" && r.note && (
                          <div className="mt-1 text-[10px] text-destructive font-medium max-w-55">
                            {r.note}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Content>
    </>
  );
}

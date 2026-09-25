"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import { Content } from "@/components/content";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Factory,
  Plus,
  Beaker,
  Loader2,
  Package,
  Building2,
  Calendar,
} from "lucide-react";
import { getWorkingOrderList } from "@/services/working-order-actions";
import { canManageWoFormula } from "@/lib/wo-formula-permissions";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "Pending Approval": "secondary",
  "On Process": "default",
  Closed: "outline",
  Rejected: "destructive",
};

export default function WorkingOrderListPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [wos, setWos] = useState<any[]>([]);
  const [canFormula, setCanFormula] = useState(false);

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", user.id);
      const roleNames = (roleRows || []).map((r: any) => r.roles?.name).filter(Boolean);
      setCanFormula(canManageWoFormula(roleNames));
    }
    const { data } = await getWorkingOrderList();
    setWos(data || []);
    setLoading(false);
  }

  return (
    <>
      <Content>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <Factory className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Working Order
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Assembly/Produksi Internal dari MR
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canFormula && (
              <Link href="/working-order/formula">
                <Button variant="outline" className="gap-2 font-bold text-xs uppercase h-9">
                  <Beaker className="h-4 w-4" /> Kelola Formula
                </Button>
              </Link>
            )}
            <Link href="/working-order/create">
              <Button className="gap-2 font-bold text-xs uppercase h-9">
                <Plus className="h-4 w-4" /> Buat WO
              </Button>
            </Link>
          </div>
        </div>
      </Content>

      <Content>
        <div className="rounded-xl border border-border overflow-hidden">
          <Table containerClassName="max-h-[75vh] overflow-y-auto">
            <TableHeader className="bg-muted/50 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[0_2px_4px_-2px_rgba(0,0,0,0.15)]">
              <TableRow className="hover:bg-transparent border-b border-border h-11">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground pl-5">
                  Kode WO
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  MR Asal
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Gudang WO
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Departemen
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Tanggal
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Items
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground text-center">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs font-medium">Memuat...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : wos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-40 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Factory className="h-8 w-8 opacity-30" />
                      <p className="text-xs font-medium">Belum ada Working Order</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                wos.map((wo) => (
                  <TableRow
                    key={wo.id}
                    className="cursor-pointer hover:bg-muted/40 border-b border-border/50 h-14 transition-colors"
                    onClick={() => router.push(`/working-order/${wo.id}`)}
                  >
                    <TableCell className="pl-5">
                      <span className="font-black text-xs text-foreground font-mono uppercase tracking-wide">
                        {wo.wo_kode}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-bold text-foreground">
                      {wo.mrs?.mr_kode ?? "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {wo.cabang?.nama_cabang ?? "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-bold uppercase">
                        {wo.departemen}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <Calendar className="h-3 w-3 shrink-0" />
                        {formatDate(wo.wo_tanggal)}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="text-[10px] font-bold gap-1">
                        <Package className="h-3 w-3" />
                        {wo.working_order_items?.length ?? 0}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={STATUS_VARIANT[wo.wo_status] || "secondary"}
                        className="text-[10px] font-bold uppercase"
                      >
                        {wo.wo_status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Content>
    </>
  );
}

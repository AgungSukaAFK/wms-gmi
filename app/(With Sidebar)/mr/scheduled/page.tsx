"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import { canCreateMR } from "@/lib/mr-permissions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Search,
  Loader2,
  CalendarRange,
  Snowflake,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Content } from "@/components/content";
import { useDebounce } from "use-debounce";
import Link from "next/link";
import { getScheduledMaterialRequests } from "@/services/scheduled-mr-actions";

export default function ScheduledMRPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [mrs, setMrs] = useState<any[]>([]);
  const [canCreate, setCanCreate] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 300);

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("roles(name)")
          .eq("user_id", user.id);
        const roleNames = (roleRows || [])
          .map((r: any) => r.roles?.name)
          .filter(Boolean);
        setCanCreate(canCreateMR(roleNames));
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await getScheduledMaterialRequests();
      setMrs(res.data || []);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = mrs.filter((mr) =>
    mr.mr_kode?.toLowerCase().includes(debouncedSearch.toLowerCase()),
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return (
          <Badge
            variant="outline"
            className="text-blue-600 border-blue-200 bg-blue-100 font-bold text-[10px] uppercase"
          >
            Open
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-green-600 text-white font-bold text-[10px] uppercase">
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-destructive text-destructive-foreground font-bold text-[10px] uppercase">
            Rejected
          </Badge>
        );
      case "completed":
      case "done":
      case "closed":
        return (
          <Badge className="bg-emerald-600 text-white font-bold text-[10px] uppercase">
            Completed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="font-bold text-[10px] uppercase">
            {status}
          </Badge>
        );
    }
  };

  return (
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Scheduled MR
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Perencanaan kebutuhan s/d 3 bulan, per item
              </p>
            </div>
          </div>
          {canCreate && (
            <Link href="/mr/scheduled/create">
              <Button className="h-9 gap-2 text-xs font-bold uppercase">
                <Plus className="h-4 w-4" /> Buat Scheduled MR
              </Button>
            </Link>
          )}
        </div>
      </Content>

      <Content>
        <div className="relative min-w-0 flex-1 xl:max-w-100">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari Kode MR..."
            className="h-9 rounded-md border-input bg-muted/40 pl-9 text-xs font-medium"
          />
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="rounded-lg border border-border">
          <Table containerClassName="max-h-[75vh] overflow-y-auto">
            <TableHeader className="bg-muted [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:shadow-[0_2px_4px_-2px_rgba(0,0,0,0.15)]">
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Kode MR
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Requester
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Cabang
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Tgl Input
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Rentang Due Date Item
                </TableHead>
                <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">
                  Item
                </TableHead>
                <TableHead className="text-center text-[10px] font-black uppercase text-muted-foreground">
                  Frozen
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="w-20 text-[10px] font-black uppercase text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-xs text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="h-40 text-center text-muted-foreground/40 font-bold uppercase tracking-widest text-[11px]"
                  >
                    Belum ada Scheduled MR
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((mr) => {
                  const dueDates = (mr.mr_items || [])
                    .map((i: any) => i.item_due_date)
                    .filter(Boolean)
                    .sort();
                  const frozenCount = (mr.mr_items || []).filter(
                    (i: any) => i.is_item_frozen,
                  ).length;
                  return (
                    <TableRow key={mr.id}>
                      <TableCell className="font-bold text-xs">
                        {mr.mr_kode}
                      </TableCell>
                      <TableCell className="text-xs">{mr.mr_pic}</TableCell>
                      <TableCell className="text-xs">
                        {mr.cabang?.nama_cabang || "-"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {mr.mr_tanggal ? formatDate(mr.mr_tanggal) : "-"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {dueDates.length > 0
                          ? `${formatDate(dueDates[0])} — ${formatDate(dueDates[dueDates.length - 1])}`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-center text-xs font-semibold">
                        {(mr.mr_items || []).length}
                      </TableCell>
                      <TableCell className="text-center">
                        {frozenCount > 0 ? (
                          <Badge className="gap-1 bg-sky-100 text-sky-700 border border-sky-200 font-bold text-[10px]">
                            <Snowflake className="h-3 w-3" /> {frozenCount}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(mr.mr_status)}</TableCell>
                      <TableCell>
                        <Link href={`/mr/scheduled/${mr.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 text-[11px] font-bold">
                            Lihat
                          </Button>
                        </Link>
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

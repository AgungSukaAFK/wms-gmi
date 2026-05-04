import { Content } from "@/components/content";
import { DocumentTrendChart } from "@/components/dashboard/document-trend-chart";
import { MrByCabangChart } from "@/components/dashboard/mr-by-cabang-chart";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import {
  AlertTriangle,
  Calculator,
  ClipboardList,
  Clock,
  FileText,
  PackageOpen,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { toYmdLocal } from "@/lib/utils";

type TrendData = {
  bulan: string;
  mr: number;
  pr: number;
  po: number;
};

type MrByCabangData = {
  cabang: string;
  count: number;
};

type LowStockItem = {
  id?: number;
  part_number: string;
  part_name: string;
  nama_cabang: string;
  qty: number;
  min_qty: number;
};

const STATUS_CLASSES: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  done: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID");
}

function renderStatusBadge(status?: string | null) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-[10px] font-semibold uppercase">
        -
      </Badge>
    );
  }

  const normalized = status.toLowerCase();
  const className = STATUS_CLASSES[normalized];

  return (
    <Badge
      variant="outline"
      className={`text-[10px] font-semibold uppercase ${
        className ?? "bg-muted text-muted-foreground border-border"
      }`}
    >
      {normalized}
    </Badge>
  );
}

function renderPriorityBadge(priority?: string | null) {
  if (!priority) {
    return (
      <Badge variant="outline" className="text-[10px] font-semibold uppercase">
        -
      </Badge>
    );
  }

  if (priority === "P1") {
    return (
      <Badge variant="destructive" className="text-[10px] font-bold uppercase">
        P1
      </Badge>
    );
  }

  if (priority === "P2") {
    return (
      <Badge className="border-amber-200 bg-amber-100 text-[10px] font-bold uppercase text-amber-700">
        P2
      </Badge>
    );
  }

  if (priority === "P3") {
    return (
      <Badge className="border-primary/20 bg-primary/10 text-[10px] font-bold uppercase text-primary">
        P3
      </Badge>
    );
  }

  if (priority === "P4") {
    return (
      <Badge
        variant="secondary"
        className="text-[10px] font-bold uppercase text-muted-foreground"
      >
        P4
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-[10px] font-semibold uppercase">
      {priority}
    </Badge>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];

  const [
    profileResult,
    mrCountResult,
    prCountResult,
    poCountResult,
    spbCountResult,
    pendingMrResult,
    pendingPrResult,
    pendingPoResult,
    deliveryOngoingResult,
    jobOpenResult,
    recentMrsResult,
    recentDeliveriesResult,
    mrByCabangResult,
  ] = await Promise.all([
    user?.id
      ? supabase
          .from("profiles")
          .select("nama, cabang_id")
          .eq("id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("mrs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfMonth),
    supabase
      .from("prs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfMonth),
    supabase
      .from("pos")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfMonth),
    supabase
      .from("spb")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfMonth),
    supabase
      .from("mrs")
      .select("*", { count: "exact", head: true })
      .eq("mr_status", "open"),
    supabase
      .from("prs")
      .select("*", { count: "exact", head: true })
      .eq("pr_status", "open"),
    supabase
      .from("pos")
      .select("*", { count: "exact", head: true })
      .eq("po_status", "open"),
    supabase
      .from("deliveries")
      .select("*", { count: "exact", head: true })
      .not("status", "in", '("done","closed")'),
    supabase
      .from("job_costing")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("mrs")
      .select(
        "id, mr_kode, mr_pic, mr_tanggal, mr_status, mr_priority, cabang(nama_cabang)",
      )
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("deliveries")
      .select(
        "id, dlv_kode, pic, status, created_at, cabang_dari:cabang!deliveries_dari_cabang_id_fkey(nama_cabang), cabang_ke:cabang!deliveries_ke_cabang_id_fkey(nama_cabang)",
      )
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("mrs")
      .select("cabang(nama_cabang)")
      .gte("created_at", startOfMonth),
  ]);

  const profile = profileResult.data;
  const cabangName = profile?.cabang_id
    ? (
        await supabase
          .from("cabang")
          .select("nama_cabang")
          .eq("id", profile.cabang_id)
          .maybeSingle()
      ).data?.nama_cabang
    : null;

  const months: { label: string; start: string; end: string }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const nextMonthDate = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + 1,
      1,
    );

    months.push({
      label: monthDate.toLocaleDateString("id-ID", {
        month: "short",
        year: "2-digit",
      }),
      start: toYmdLocal(monthDate),
      end: toYmdLocal(nextMonthDate),
    });
  }

  const trendData: TrendData[] = await Promise.all(
    months.map(async (month) => {
      const [mrResult, prResult, poResult] = await Promise.all([
        supabase
          .from("mrs")
          .select("*", { count: "exact", head: true })
          .gte("created_at", month.start)
          .lt("created_at", month.end),
        supabase
          .from("prs")
          .select("*", { count: "exact", head: true })
          .gte("created_at", month.start)
          .lt("created_at", month.end),
        supabase
          .from("pos")
          .select("*", { count: "exact", head: true })
          .gte("created_at", month.start)
          .lt("created_at", month.end),
      ]);

      return {
        bulan: month.label,
        mr: mrResult.count ?? 0,
        pr: prResult.count ?? 0,
        po: poResult.count ?? 0,
      };
    }),
  );

  const cabangCountMap: Record<string, number> = {};
  (mrByCabangResult.data || []).forEach((row: any) => {
    const relation = row?.cabang;
    const namaCabang = Array.isArray(relation)
      ? relation[0]?.nama_cabang
      : relation?.nama_cabang;
    const key = namaCabang || "Unknown";
    cabangCountMap[key] = (cabangCountMap[key] || 0) + 1;
  });

  const mrByCabangData: MrByCabangData[] = Object.entries(cabangCountMap)
    .map(([cabang, count]) => ({ cabang, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const lowStockCountResult = await supabase
    .from("v_stock_with_status")
    .select("id", { count: "exact", head: true })
    .eq("status", "low");

  const lowStockItemsResult = await supabase
    .from("v_stock_with_status")
    .select("id, part_number, part_name, nama_cabang, qty, min_qty")
    .eq("status", "low")
    .order("qty", { ascending: true })
    .limit(5);

  let lowStockCount = lowStockCountResult.count ?? 0;
  let lowStockItems: LowStockItem[] = (lowStockItemsResult.data ||
    []) as LowStockItem[];

  if (lowStockCountResult.error || lowStockItemsResult.error) {
    const fallbackStockResult = await supabase
      .from("stock")
      .select(
        "id, qty, min_qty, barang(part_number, part_name), cabang(nama_cabang)",
      );

    const lowRows = (fallbackStockResult.data || []).filter(
      (row: any) => Number(row.qty || 0) < Number(row.min_qty || 0),
    );

    lowStockCount = lowRows.length;
    lowStockItems = lowRows
      .sort((a: any, b: any) => Number(a.qty || 0) - Number(b.qty || 0))
      .slice(0, 5)
      .map((row: any) => ({
        id: row.id,
        part_number: row.barang?.part_number || "-",
        part_name: row.barang?.part_name || "-",
        nama_cabang: row.cabang?.nama_cabang || "-",
        qty: Number(row.qty || 0),
        min_qty: Number(row.min_qty || 0),
      }));
  }

  const totalPendingApproval =
    (pendingMrResult.count ?? 0) +
    (pendingPrResult.count ?? 0) +
    (pendingPoResult.count ?? 0);

  const todayLabel = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <Content>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Dashboard WMS-GMI
            </h1>
            <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
              Selamat datang, {profile?.nama || "Pengguna"} -{" "}
              {cabangName || "Tidak diketahui"}
            </p>
          </div>
          <Badge variant="outline" className="w-fit text-xs font-semibold">
            {todayLabel}
          </Badge>
        </div>
      </Content>

      <Content size="xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Material Request
            </p>
            <p className="text-2xl font-bold text-foreground">
              {mrCountResult.count ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground">Bulan ini</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
        </div>
      </Content>

      <Content size="xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Purchase Request
            </p>
            <p className="text-2xl font-bold text-foreground">
              {prCountResult.count ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground">Bulan ini</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-sky-500/10">
            <FileText className="h-5 w-5 text-sky-600" />
          </div>
        </div>
      </Content>

      <Content size="xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Purchase Order
            </p>
            <p className="text-2xl font-bold text-foreground">
              {poCountResult.count ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground">Bulan ini</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-violet-500/10">
            <ShoppingCart className="h-5 w-5 text-violet-600" />
          </div>
        </div>
      </Content>

      <Content size="xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              SPB
            </p>
            <p className="text-2xl font-bold text-foreground">
              {spbCountResult.count ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground">Bulan ini</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-500/10">
            <PackageOpen className="h-5 w-5 text-teal-600" />
          </div>
        </div>
      </Content>

      <Content size="xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Pending Approval
            </p>
            <p className="text-2xl font-bold text-foreground">
              {totalPendingApproval}
            </p>
            <p className="text-[10px] text-muted-foreground">MR + PR + PO</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-500/10">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
        </div>
      </Content>

      <Content size="xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Low Stock Items
            </p>
            <p className="text-2xl font-bold text-foreground">
              {lowStockCount}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Perlu replenishment
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
        </div>
      </Content>

      <Content size="xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Delivery On Going
            </p>
            <p className="text-2xl font-bold text-foreground">
              {deliveryOngoingResult.count ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground">Belum selesai</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10">
            <Truck className="h-5 w-5 text-blue-600" />
          </div>
        </div>
      </Content>

      <Content size="xs">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Job Costing Open
            </p>
            <p className="text-2xl font-bold text-foreground">
              {jobOpenResult.count ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Butuh tindak lanjut
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground/10">
            <Calculator className="h-5 w-5 text-foreground" />
          </div>
        </div>
      </Content>

      <Content size="md">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              Tren Dokumen 6 Bulan
            </h2>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Material Request, Purchase Request, Purchase Order
            </p>
          </div>
          <DocumentTrendChart data={trendData} />
        </div>
      </Content>

      <Content size="md">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">MR per Cabang</h2>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              Top cabang berdasarkan MR bulan ini
            </p>
          </div>
          <MrByCabangChart data={mrByCabangData} />
        </div>
      </Content>

      <Content size="md">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">MR Terbaru</h2>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              5 material request terakhir
            </p>
          </div>

          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Kode MR
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  PIC
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Cabang
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Tanggal
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Priority
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recentMrsResult.data || []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-xs font-medium text-muted-foreground"
                  >
                    Tidak ada data MR.
                  </TableCell>
                </TableRow>
              ) : (
                (recentMrsResult.data || []).map((mr: any) => (
                  <TableRow key={mr.id}>
                    <TableCell className="text-xs font-medium text-foreground">
                      {mr.mr_kode || "-"}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {mr.mr_pic || "-"}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {mr.cabang?.nama_cabang || "-"}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {formatDate(mr.mr_tanggal)}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {renderPriorityBadge(mr.mr_priority)}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {renderStatusBadge(mr.mr_status)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Content size="md">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              Delivery Terbaru
            </h2>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              5 pengiriman terakhir antar cabang
            </p>
          </div>

          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Kode Delivery
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Route
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  PIC
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recentDeliveriesResult.data || []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-xs font-medium text-muted-foreground"
                  >
                    Tidak ada data delivery.
                  </TableCell>
                </TableRow>
              ) : (
                (recentDeliveriesResult.data || []).map((delivery: any) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="text-xs font-medium text-foreground">
                      {delivery.dlv_kode || "-"}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {(delivery.cabang_dari?.nama_cabang || "-") +
                        " -> " +
                        (delivery.cabang_ke?.nama_cabang || "-")}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {delivery.pic || "-"}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {renderStatusBadge(delivery.status)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">Stock Menipis</h2>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">
              5 item dengan stok terendah
            </p>
          </div>

          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Part Number
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Part Name
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Cabang
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Qty
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Min Qty
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lowStockItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-xs font-medium text-muted-foreground"
                  >
                    Tidak ada item low stock.
                  </TableCell>
                </TableRow>
              ) : (
                lowStockItems.map((item) => (
                  <TableRow
                    key={item.id || `${item.part_number}-${item.nama_cabang}`}
                  >
                    <TableCell className="text-xs font-medium text-foreground">
                      {item.part_number}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {item.part_name}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {item.nama_cabang}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {item.qty}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {item.min_qty}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      <Badge
                        variant="destructive"
                        className="text-[10px] font-semibold uppercase"
                      >
                        Low Stock
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

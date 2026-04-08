import { Content } from "@/components/content";
import { createClient } from "@/lib/supabase/server";
import StockClient from "./StockClient";

interface SearchParams {
  q?: string;
  cabang?: string;
  status?: string;
  page?: string;
  limit?: string;
  sort?: string;
  view?: string;
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q || "";
  const cabang = params.cabang || "";
  const status = params.status || "";
  const page = parseInt(params.page || "1");
  const limit = parseInt(params.limit || "25");
  const sort = params.sort || "qty_asc";
  const view = (params.view as "table" | "grid") || "table";

  const supabase = await createClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // 1. Fetch data from v_stock_with_status
  let query = supabase
    .from("v_stock_with_status")
    .select("*", { count: "exact" });

  if (q) {
    query = query.or(`part_number.ilike.%${q}%,part_name.ilike.%${q}%`);
  }
  
  if (cabang && cabang !== "all") {
    query = query.eq("cabang_id", parseInt(cabang));
  }

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  // Handle Various Sorting
  switch (sort) {
    case "qty_asc":
      query = query.order("qty", { ascending: true });
      break;
    case "qty_desc":
      query = query.order("qty", { ascending: false });
      break;
    case "name_asc":
      query = query.order("part_name", { ascending: true });
      break;
    case "min_max_ratio":
      // Since we can't easily order by calculated column in Supabase JS without RPC or View adjustment,
      // we'll stick to basic columns or the view columns.
      query = query.order("qty", { ascending: true });
      break;
    default:
      query = query.order("qty", { ascending: true });
  }

  const { data, count, error } = await query.range(from, to);

  if (error) {
    console.error("Error fetching stock:", error);
  }

  // 2. Fetch cabang list for filter
  const { data: cabangList } = await supabase
    .from("cabang")
    .select("id, nama_cabang")
    .eq("is_active", true)
    .order("nama_cabang");

  return (
    <Content>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Monitoring Stok</h1>
          <p className="text-muted-foreground">
            Pantau ketersediaan barang di seluruh site dan lokasi operasional.
          </p>
        </div>

        <StockClient
          initialData={data || []}
          totalCount={count || 0}
          cabangList={cabangList || []}
          currentPage={page}
          pageSize={limit}
          initialQuery={q}
          initialCabang={cabang}
          initialStatus={status}
          initialSort={sort}
          initialView={view}
        />
      </div>
    </Content>
  );
}

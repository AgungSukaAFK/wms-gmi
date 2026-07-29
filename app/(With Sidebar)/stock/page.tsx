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
  stock_from?: string;
  stock_to?: string;
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
  const sort = params.sort || "qty_desc";
  const view = (params.view as "table" | "grid") || "table";
  const stockFrom = params.stock_from || "";
  const stockTo = params.stock_to || "";

  const supabase = await createClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // 1. Fetch data from v_stock_summary (Grouped by Part)
  let query = supabase.from("v_stock_summary").select("*", { count: "exact" });

  if (q) {
    query = query.or(`part_number.ilike.%${q}%,part_name.ilike.%${q}%`);
  }

  const parsedStockFrom = Number(stockFrom);
  if (stockFrom && !Number.isNaN(parsedStockFrom)) {
    query = query.gte("total_qty", parsedStockFrom);
  }

  const parsedStockTo = Number(stockTo);
  if (stockTo && !Number.isNaN(parsedStockTo)) {
    query = query.lte("total_qty", parsedStockTo);
  }

  // Note: Cabang filter is handled within the Detail Sheet in the grouped view,
  // but we can still filter the summaries if needed. For now, we show all parts.

  // Handle Various Sorting -- konvensi key: `${kolom}_${asc|desc}`.
  const SORT_COLUMNS: Record<string, string> = {
    no: "part_id",
    qty: "total_qty",
    part_number: "part_number",
    part_name: "part_name",
    active_locations: "active_locations",
  };
  const [sortKeyRaw, sortDirRaw] = sort.split(/_(asc|desc)$/);
  const sortColumn = SORT_COLUMNS[sortKeyRaw] || "total_qty";
  const sortAscending = sortDirRaw === "asc";
  query = query.order(sortColumn, { ascending: sortAscending });

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
      initialStockFrom={stockFrom}
      initialStockTo={stockTo}
    />
  );
}

import { createClient } from "@/lib/supabase/server";
import StockClient from "./StockClient";

interface SearchParams {
  q?: string;
  cabang?: string;
  status?: string;
  satuan?: string;
  page?: string;
  limit?: string;
  sort?: string;
  view?: string;
  stock_from?: string;
  stock_to?: string;
  updated_from?: string;
  updated_to?: string;
}

const STATUS_VALUES = [
  "all",
  "in_stock",
  "empty",
  "negative",
  "below_min",
  "above_max",
  "minmax_unset",
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toNumberOrNull = (v: string) => {
  const n = Number(v);
  return v && !Number.isNaN(n) ? n : null;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Query lama via v_stock_summary (tanpa filter gudang/status/satuan). Dipakai
 * kalau fungsi search_stock_summary belum ada di DB -- deploy Vercel dan
 * migration VPS tidak atomik, jadi halaman tetap jalan selama jeda itu.
 */
async function fetchLegacySummary(
  supabase: Supabase,
  opts: {
    q: string;
    stockFrom: string;
    stockTo: string;
    updatedFrom: string;
    updatedTo: string;
    sort: string;
    from: number;
    to: number;
  },
) {
  let query = supabase.from("v_stock_summary").select("*", { count: "exact" });

  if (opts.q) {
    query = query.or(`part_number.ilike.%${opts.q}%,part_name.ilike.%${opts.q}%`);
  }
  const stockFrom = toNumberOrNull(opts.stockFrom);
  if (stockFrom !== null) query = query.gte("total_qty", stockFrom);
  const stockTo = toNumberOrNull(opts.stockTo);
  if (stockTo !== null) query = query.lte("total_qty", stockTo);

  // "to" pakai batas awal hari berikutnya supaya baris yang diubah di hari
  // yang sama tetap ikut ke-filter.
  if (opts.updatedFrom) {
    query = query.gte("last_updated", `${opts.updatedFrom}T00:00:00`);
  }
  if (opts.updatedTo) {
    const nextDay = new Date(`${opts.updatedTo}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    query = query.lt("last_updated", nextDay.toISOString().slice(0, 10));
  }

  const SORT_COLUMNS: Record<string, string> = {
    no: "part_id",
    qty: "total_qty",
    cabang_qty: "total_qty",
    part_number: "part_number",
    part_name: "part_name",
    active_locations: "active_locations",
    last_updated: "last_updated",
  };
  const [sortKeyRaw, sortDirRaw] = opts.sort.split(/_(asc|desc)$/);
  query = query.order(SORT_COLUMNS[sortKeyRaw] || "total_qty", {
    ascending: sortDirRaw === "asc",
  });

  return query.range(opts.from, opts.to);
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q || "";
  const cabangIds = (params.cabang || "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const satuan = (params.satuan || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  // Default status: kalau gudang dipilih, tampilkan part yang PUNYA stok di
  // gudang itu (kebutuhan utama filter gudang); selain itu semua part.
  const status = STATUS_VALUES.includes(params.status || "")
    ? params.status!
    : cabangIds.length > 0
      ? "in_stock"
      : "all";
  const page = Math.max(1, parseInt(params.page || "1") || 1);
  const limit = parseInt(params.limit || "25") || 25;
  const sort = params.sort || "qty_desc";
  const view = (params.view as "table" | "grid") || "table";
  const stockFrom = params.stock_from || "";
  const stockTo = params.stock_to || "";
  const updatedFrom = DATE_RE.test(params.updated_from || "")
    ? params.updated_from!
    : "";
  const updatedTo = DATE_RE.test(params.updated_to || "")
    ? params.updated_to!
    : "";

  const supabase = await createClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const rpcArgs = {
    p_search: q || null,
    p_cabang_ids: cabangIds.length > 0 ? cabangIds : null,
    p_status: status,
    p_qty_from: toNumberOrNull(stockFrom),
    p_qty_to: toNumberOrNull(stockTo),
    p_updated_from: updatedFrom || null,
    p_updated_to: updatedTo || null,
    p_satuan: satuan.length > 0 ? satuan : null,
    p_sort: sort,
    p_limit: limit,
  };

  const [summaryRes, cabangRes, cabangCountRes, satuanRes] = await Promise.all(
    [
      supabase.rpc("search_stock_summary", { ...rpcArgs, p_offset: from }),
      supabase
        .from("cabang")
        .select("id, nama_cabang")
        .eq("is_active", true)
        .order("nama_cabang"),
      supabase.rpc("get_stock_cabang_counts"),
      supabase.rpc("import_ref_satuan"),
    ],
  );

  let data: Record<string, unknown>[] = [];
  let count = 0;
  let filterReady = true;

  if (summaryRes.error) {
    // PGRST202: fungsi belum ada di schema cache (migration belum jalan di
    // VPS). Error lain (mis. 57014 statement timeout): tetap tampilkan data
    // lewat query lama, jangan sampai halaman kosong.
    if (summaryRes.error.code !== "PGRST202") {
      console.error("Error fetching stock summary:", summaryRes.error);
    }
    filterReady = false;
    const legacy = await fetchLegacySummary(supabase, {
      q,
      stockFrom,
      stockTo,
      updatedFrom,
      updatedTo,
      sort,
      from,
      to,
    });
    if (legacy.error) console.error("Error fetching stock:", legacy.error);
    data = legacy.data || [];
    count = legacy.count || 0;
  } else {
    data = summaryRes.data || [];
    count = Number(data[0]?.total_count ?? 0);
    // total_count ikut baris hasil; halaman di luar jangkauan (mis. setelah
    // filter mempersempit hasil) tetap perlu total untuk pagination.
    if (data.length === 0 && page > 1) {
      const { data: probe } = await supabase.rpc("search_stock_summary", {
        ...rpcArgs,
        p_limit: 1,
        p_offset: 0,
      });
      count = Number(probe?.[0]?.total_count ?? 0);
    }
  }

  const partsInStock = new Map<number, number>(
    (cabangCountRes.data || []).map((r: { cabang_id: number; parts_in_stock: number }) => [
      Number(r.cabang_id),
      Number(r.parts_in_stock),
    ]),
  );
  const cabangList = (cabangRes.data || []).map((c) => ({
    ...c,
    parts_in_stock: partsInStock.get(c.id) ?? 0,
  }));
  const satuanList: string[] = (satuanRes.data || []).map(
    (r: { satuan: string }) => r.satuan,
  );

  return (
    <StockClient
      initialData={data}
      totalCount={count}
      cabangList={cabangList}
      satuanList={satuanList}
      filterReady={filterReady}
      currentPage={page}
      pageSize={limit}
      initialQuery={q}
      initialCabang={cabangIds.map(String)}
      initialStatus={status}
      initialSatuan={satuan}
      initialSort={sort}
      initialView={view}
      initialStockFrom={stockFrom}
      initialStockTo={stockTo}
      initialUpdatedFrom={updatedFrom}
      initialUpdatedTo={updatedTo}
    />
  );
}

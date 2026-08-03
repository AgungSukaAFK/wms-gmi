import { createClient } from "@/lib/supabase/server";
import BarangClient from "./BarangClient";

interface SearchParams {
  q?: string;
  page?: string;
  limit?: string;
  sort?: string;
  view?: string;
  updated_from?: string;
  updated_to?: string;
}

export default async function BarangPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = params.q || "";
  const page = parseInt(params.page || "1");
  const limit = parseInt(params.limit || "25");
  const sort = params.sort || "name_asc";
  const view = (params.view as "table" | "grid") || "table";
  const updatedFrom = params.updated_from || "";
  const updatedTo = params.updated_to || "";

  const supabase = await createClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase.from("barang").select("*", { count: "exact" });

  if (q) {
    query = query.or(`part_number.ilike.%${q}%,part_name.ilike.%${q}%`);
  }

  // "to" pakai batas awal hari berikutnya (bukan lte tanggal itu sendiri)
  // supaya baris yang diubah di hari yang sama tetap ikut ke-filter.
  if (updatedFrom) {
    query = query.gte("updated_at", `${updatedFrom}T00:00:00`);
  }
  if (updatedTo) {
    const nextDay = new Date(`${updatedTo}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    query = query.lt("updated_at", nextDay.toISOString().slice(0, 10));
  }

  // Handle Sorting -- konvensi key kolom: `${kolom}_${asc|desc}`.
  const SORT_COLUMNS: Record<string, string> = {
    part_number: "part_number",
    part_satuan: "part_satuan",
  };
  switch (sort) {
    case "name_asc":
      query = query.order("part_name", { ascending: true });
      break;
    case "name_desc":
      query = query.order("part_name", { ascending: false });
      break;
    case "latest":
      query = query.order("created_at", { ascending: false });
      break;
    default: {
      const [sortKeyRaw, sortDirRaw] = sort.split(/_(asc|desc)$/);
      const sortColumn = SORT_COLUMNS[sortKeyRaw];
      if (sortColumn) {
        query = query.order(sortColumn, { ascending: sortDirRaw === "asc" });
      } else {
        query = query.order("part_name", { ascending: true });
      }
    }
  }

  const { data, count, error } = await query.range(from, to);

  if (error) {
    console.error("Error fetching barang:", error);
  }

  return (
    <BarangClient
      initialData={data || []}
      totalCount={count || 0}
      currentPage={page}
      pageSize={limit}
      initialQuery={q}
      initialSort={sort}
      initialView={view}
      initialUpdatedFrom={updatedFrom}
      initialUpdatedTo={updatedTo}
    />
  );
}

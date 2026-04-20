import { createClient } from "@/lib/supabase/server";
import BarangClient from "./BarangClient";

interface SearchParams {
  q?: string;
  page?: string;
  limit?: string;
  sort?: string;
  view?: string;
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

  const supabase = await createClient();

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase.from("barang").select("*", { count: "exact" });

  if (q) {
    query = query.or(`part_number.ilike.%${q}%,part_name.ilike.%${q}%`);
  }

  // Handle Sorting
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
    default:
      query = query.order("part_name", { ascending: true });
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
    />
  );
}

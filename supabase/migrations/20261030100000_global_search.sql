-- 20261030100000_global_search.sql
--
-- Global search di top bar (components/topbar/topbar-search.tsx).
--
--   global_search(q, limit)  cari MR, PR, PO, Item Transfer, SO Reguler &
--                            Barang dalam 1 panggilan, maks. `limit` baris
--                            per jenis.
--
-- Antrian "Menunggu approval Anda" (saat kotak search kosong) memakai RPC
-- yang sudah ada: get_pending_approvals_for_user.
--
-- Kenapa 1 RPC (bukan query per tabel dari browser): cukup 1 request per
-- ketikan (setelah debounce) dan cuma kolom ringan yang dikirim.
--
-- Akses: RLS semua tabel ini = semua user login boleh baca (list MR/PR/PO
-- dll. juga tidak dibatasi per cabang), jadi fungsi cukup menolak yang
-- belum login. SECURITY DEFINER supaya policy RLS tidak dievaluasi per baris
-- (lihat insiden /stock 2026-10-28), EXECUTE hanya utk authenticated.
--
-- Pencocokan: tiap kata di query harus ada (urutan bebas, tidak peka huruf
-- besar/kecil). Urutan hasil: kode persis sama -> nomor urut di akhir kode
-- sama (ketik "12" -> .../12) -> cocok di kode -> terbaru.
--
-- Tabel masih kecil (< 15rb baris), belum perlu index trigram.
-- Aditif & IDEMPOTENT: aman dijalankan sebelum/sesudah deploy frontend.

create or replace function public.global_search(
  p_query text,
  p_limit int default 5
)
returns table (
  kind text,         -- mr | pr | po | it | so | barang
  id text,
  title text,        -- kode dokumen / part number
  subtitle text,
  status text,
  created_at timestamptz,
  exact boolean      -- kode / part number persis sama dengan query
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q text := left(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')), 100);
  v_limit int := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_esc text;
  v_words text[];
  v_tokens text[];   -- '%kata%' per kata, maks. 5
  v_suffix text;     -- '%/kataTerakhir' (nomor urut di akhir kode)
begin
  if auth.uid() is null or char_length(v_q) < 2 then
    return;
  end if;

  -- Escape karakter wildcard LIKE supaya "%" / "_" di query dicari apa adanya.
  v_esc := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_words := string_to_array(v_esc, ' ');
  select coalesce(array_agg('%' || w || '%' order by char_length(w) desc), array[]::text[])
    into v_tokens
    from (select distinct w from unnest(v_words) as w where w <> '' limit 5) s;
  if cardinality(v_tokens) = 0 then
    return;
  end if;
  v_suffix := '%/' || v_words[array_upper(v_words, 1)];

  -- Material Request
  return query
  select 'mr'::text, m.id::text, m.mr_kode,
         concat_ws(' · ', nullif(m.mr_pic, ''), c.nama_cabang),
         m.mr_status::text, m.created_at,
         lower(m.mr_kode) = lower(v_q)
    from public.mrs m
    left join public.cabang c on c.id = m.cabang_id
   where concat_ws(' ', m.mr_kode, m.mr_pic, m.mr_remarks) ilike all (v_tokens)
   order by lower(m.mr_kode) = lower(v_q) desc,
            m.mr_kode ilike v_suffix desc,
            m.mr_kode ilike all (v_tokens) desc,
            m.created_at desc
   limit v_limit;

  -- Purchase Request (juga cocok ke kode MR asalnya)
  return query
  select 'pr'::text, p.id::text, p.pr_kode,
         concat_ws(' · ', c.nama_cabang, m.mr_kode),
         p.pr_status::text, p.created_at,
         lower(p.pr_kode) = lower(v_q)
    from public.prs p
    left join public.cabang c on c.id = p.cabang_id
    left join public.mrs m on m.id = p.mr_id
   where concat_ws(' ', p.pr_kode, m.mr_kode) ilike all (v_tokens)
   order by lower(p.pr_kode) = lower(v_q) desc,
            p.pr_kode ilike v_suffix desc,
            p.pr_kode ilike all (v_tokens) desc,
            p.created_at desc
   limit v_limit;

  -- Purchase Order (juga cocok ke nama vendor item & referensi PR)
  return query
  with po_vendor as (
    select pi.po_id, string_agg(distinct v.vendor_name, ', ') as vendors
      from public.po_items pi
      join public.vendors v on v.id = pi.vendor_id
     group by pi.po_id
  )
  select 'po'::text, po.id::text, po.po_kode,
         concat_ws(' · ', pv.vendors, c.nama_cabang),
         po.po_status::text, po.created_at,
         lower(po.po_kode) = lower(v_q)
    from public.pos po
    left join po_vendor pv on pv.po_id = po.id
    left join public.cabang c on c.id = po.cabang_id
   where concat_ws(' ', po.po_kode, po.po_pr_referensi, pv.vendors) ilike all (v_tokens)
   order by lower(po.po_kode) = lower(v_q) desc,
            po.po_kode ilike v_suffix desc,
            po.po_kode ilike all (v_tokens) desc,
            po.created_at desc
   limit v_limit;

  -- Item Transfer
  return query
  select 'it'::text, t.id::text, t.it_kode,
         concat_ws(' → ', cf.nama_cabang, ct.nama_cabang),
         t.status::text, t.created_at,
         lower(t.it_kode) = lower(v_q)
    from public.item_transfers t
    left join public.cabang cf on cf.id = t.dari_cabang_id
    left join public.cabang ct on ct.id = t.ke_cabang_id
   where concat_ws(' ', t.it_kode, t.no_resi, t.remarks) ilike all (v_tokens)
   order by lower(t.it_kode) = lower(v_q) desc,
            t.it_kode ilike v_suffix desc,
            t.it_kode ilike all (v_tokens) desc,
            t.created_at desc
   limit v_limit;

  -- SO Reguler (juga cocok ke nama customer & nomor PO customer)
  return query
  select 'so'::text, s.id::text, s.so_kode,
         concat_ws(' · ', cu.customer_name, nullif(s.customer_po_no, '')),
         s.so_status, s.created_at,
         lower(s.so_kode) = lower(v_q)
    from public.so_reguler s
    left join public.customers cu on cu.id = s.customer_id
   where concat_ws(' ', s.so_kode, s.customer_po_no, cu.customer_name) ilike all (v_tokens)
   order by lower(s.so_kode) = lower(v_q) desc,
            s.so_kode ilike v_suffix desc,
            s.so_kode ilike all (v_tokens) desc,
            s.created_at desc
   limit v_limit;

  -- Barang
  return query
  select 'barang'::text, b.id::text, b.part_number,
         concat_ws(' · ', b.part_name, nullif(b.part_satuan, '')),
         null::text, b.created_at,
         lower(b.part_number) = lower(v_q)
    from public.barang b
   where concat_ws(' ', b.part_number, b.part_name) ilike all (v_tokens)
   order by lower(b.part_number) = lower(v_q) desc,
            b.part_number ilike all (v_tokens) desc,
            b.part_number
   limit v_limit;
end;
$$;

revoke execute on function public.global_search(text, int) from public, anon;
grant execute on function public.global_search(text, int) to authenticated;

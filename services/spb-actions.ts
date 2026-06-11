"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type SpbItemPayload = {
  part_id: number;
  dtl_spb_part_number: string;
  dtl_spb_part_name: string;
  dtl_spb_part_satuan: string;
  dtl_spb_qty: number;
};

type CreateSpbPayload = {
  spb_no: string;
  approval_template_id: number;
  spb_tanggal: string;
  spb_no_wo?: string;
  spb_section?: string;
  spb_pic_gmi?: string;
  spb_pic_ppa?: string;
  spb_kode_unit?: string;
  spb_tipe_unit?: string;
  spb_brand?: string;
  spb_hm?: number;
  spb_problem_remark?: string;
  spb_gudang?: string;
  cabang_id?: number;
  items: SpbItemPayload[];
};

function toISODate(date: Date) {
  return date.toISOString();
}

function formatNumber3(n: number) {
  return String(n).padStart(3, "0");
}

function revalidateStockOutPaths() {
  revalidatePath("/spb");
  revalidatePath("/spb/report");
  revalidatePath("/spb/po");
  revalidatePath("/spb/do");
  revalidatePath("/spb/invoice");
  revalidatePath("/return-spb");
}

async function getCurrentUserProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null, error: "Tidak terautentikasi." };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, nama, email, cabang_id, cabang:cabang_id(nama_cabang)")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return { user, profile: null, error: error.message };
  }

  return { user, profile: profile || null, error: null as string | null };
}

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);

  return (roleRows || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

async function requireModeratorOrAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Tidak terautentikasi." } as const;

  const roleNames = await getRoleNames(supabase, user.id);
  const allowed = roleNames.some(
    (role) => role === "moderator" || role === "admin",
  );
  if (!allowed) {
    return {
      error:
        "Akses ditolak. Hanya moderator/admin yang dapat mengubah atau menghapus SPB.",
    } as const;
  }

  return { supabase, user } as const;
}

const STOCK_OUT_APPROVAL_TYPES = {
  spb: "Stock Out - SPB",
  spb_po: "Stock Out - SPB PO",
  spb_do: "Stock Out - SPB DO",
  spb_invoice: "Stock Out - SPB Invoice",
  return_spb: "Return SPB",
} as const;

type StockOutDocType = keyof typeof STOCK_OUT_APPROVAL_TYPES;

async function buildStockOutApprovalFlow(
  supabase: any,
  docType: StockOutDocType,
  cabangId: number,
  requesterId: string,
  templateId: number,
) {
  const approvalType = STOCK_OUT_APPROVAL_TYPES[docType];

  const { data: template } = await supabase
    .from("approval_templates")
    .select("id, cabang_id")
    .eq("id", templateId)
    .eq("type", approvalType)
    .or(`cabang_id.eq.${cabangId},cabang_id.is.null`)
    .maybeSingle();

  if (!template) return [];

  const { data: steps } = await supabase
    .from("approval_template_steps")
    .select("*, profiles(*)")
    .eq("template_id", template.id)
    .order("step_order");

  if (!steps?.length) return [];

  const { data: requesterProfile } = await supabase
    .from("profiles")
    .select("id, nama, email")
    .eq("id", requesterId)
    .maybeSingle();

  return steps.map((step: any) => {
    const isRequester = step.approver_type === "requester";
    const profile = isRequester ? requesterProfile : step.profiles;
    return {
      type: isRequester ? "Requester" : profile?.nama || "Approver",
      status: "pending",
      userid: profile?.id || "",
      nama: profile?.nama || "Unknown",
      email: profile?.email || "",
      level: step.step_order,
      processed_at: null,
      notes: null,
      snapshot: null,
    };
  });
}

function processStockOutApprovalStep(
  approvals: any[],
  userId: string,
  userProfile: any,
  action: "approved" | "rejected",
  notes?: string,
) {
  const updated = [...(approvals || [])];
  const idx = updated.findIndex(
    (a: any) => a.userid === userId && a.status === "pending",
  );
  if (idx === -1) return updated;

  updated[idx] = {
    ...updated[idx],
    status: action,
    processed_at: new Date().toISOString(),
    notes: notes || null,
    snapshot: {
      nama: userProfile?.nama || "",
      email: userProfile?.email || "",
      lokasi: userProfile?.cabang?.nama_cabang || "",
    },
  };

  return updated;
}

async function applySpbPosting(spbId: number, actorId: string) {
  const supabase = await createClient();

  const { data: spbHeader, error: spbErr } = await supabase
    .from("spb")
    .select("id, spb_no, cabang_id")
    .eq("id", spbId)
    .single();

  if (spbErr || !spbHeader) {
    return { error: spbErr?.message || "SPB tidak ditemukan." };
  }

  const { data: detailRows, error: detailErr } = await supabase
    .from("spb_details")
    .select("part_id, dtl_spb_part_number, dtl_spb_qty")
    .eq("spb_id", spbId);

  if (detailErr) return { error: detailErr.message };
  if (!detailRows?.length) return { error: "Detail SPB tidak ditemukan." };

  const stockSnapshots: Array<{
    stockId: number;
    oldQty: number;
    newQty: number;
    partId: number;
    partNumber: string;
  }> = [];

  for (const row of detailRows) {
    if (!row.part_id || !row.dtl_spb_qty || row.dtl_spb_qty <= 0) {
      return { error: "Qty item SPB tidak valid." };
    }

    const { data: stockRow, error: stockErr } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", row.part_id)
      .eq("cabang_id", spbHeader.cabang_id)
      .single();

    if (stockErr || !stockRow) {
      return {
        error: `Stok untuk part ${row.dtl_spb_part_number} tidak ditemukan di cabang.`,
      };
    }

    if ((stockRow.qty || 0) < row.dtl_spb_qty) {
      return {
        error: `Stok part ${row.dtl_spb_part_number} tidak mencukupi.`,
      };
    }

    stockSnapshots.push({
      stockId: stockRow.id,
      oldQty: stockRow.qty,
      newQty: stockRow.qty - row.dtl_spb_qty,
      partId: row.part_id,
      partNumber: row.dtl_spb_part_number,
    });
  }

  const alreadyPosted = await Promise.all(
    stockSnapshots.map(async (snap) => {
      const { data } = await supabase
        .from("stock_movements")
        .select("id")
        .eq("type", "SPB_OUT")
        .eq("reference_id", spbHeader.spb_no)
        .eq("part_id", snap.partId)
        .limit(1)
        .maybeSingle();
      return Boolean(data);
    }),
  );

  if (alreadyPosted.every(Boolean)) {
    return { success: true };
  }

  for (const snap of stockSnapshots) {
    const { error: upErr } = await supabase
      .from("stock")
      .update({ qty: snap.newQty })
      .eq("id", snap.stockId);

    if (upErr) {
      return { error: upErr.message };
    }

    await supabase.from("stock_movements").insert({
      part_id: snap.partId,
      cabang_id: spbHeader.cabang_id,
      qty_change: -Math.abs(snap.oldQty - snap.newQty),
      type: "SPB_OUT",
      reference_id: spbHeader.spb_no,
      notes: "Stock out from SPB",
      created_by: actorId,
    });
  }

  return { success: true };
}

async function applyReturnSpbPosting(returnId: number, actorId: string) {
  const supabase = await createClient();

  const { data: header, error: headerErr } = await supabase
    .from("return_spb")
    .select(
      "id, rtn_kode, spb_id, details:return_spb_details(spb_dtl_id, part_id, dtl_rtn_qty_return)",
    )
    .eq("id", returnId)
    .single();

  if (headerErr || !header) {
    return { error: headerErr?.message || "Return SPB tidak ditemukan." };
  }

  const { data: spbHeader, error: spbErr } = await supabase
    .from("spb")
    .select("id, cabang_id")
    .eq("id", header.spb_id)
    .single();

  if (spbErr || !spbHeader) {
    return { error: spbErr?.message || "SPB tidak ditemukan." };
  }

  const detailRows = (header.details || []) as Array<{
    spb_dtl_id: number;
    part_id: number;
    dtl_rtn_qty_return: number;
  }>;

  if (!detailRows.length) {
    return { error: "Detail return SPB tidak ditemukan." };
  }

  const alreadyPosted = await Promise.all(
    detailRows.map(async (row) => {
      const { data } = await supabase
        .from("stock_movements")
        .select("id")
        .eq("type", "SPB_RETURN")
        .eq("reference_id", header.rtn_kode)
        .eq("part_id", row.part_id)
        .limit(1)
        .maybeSingle();
      return Boolean(data);
    }),
  );

  if (alreadyPosted.every(Boolean)) {
    return { success: true };
  }

  for (const row of detailRows) {
    const qty = row.dtl_rtn_qty_return || 0;
    if (qty <= 0) continue;

    const { data: spbDetail, error: spbDetailErr } = await supabase
      .from("spb_details")
      .select("dtl_spb_qty_returned")
      .eq("id", row.spb_dtl_id)
      .single();

    if (spbDetailErr || !spbDetail) {
      return {
        error:
          spbDetailErr?.message || "Detail SPB untuk return tidak ditemukan.",
      };
    }

    await supabase
      .from("spb_details")
      .update({
        dtl_spb_qty_returned: (spbDetail.dtl_spb_qty_returned || 0) + qty,
      })
      .eq("id", row.spb_dtl_id);

    const { data: stockRow } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", row.part_id)
      .eq("cabang_id", spbHeader.cabang_id)
      .maybeSingle();

    if (stockRow?.id) {
      await supabase
        .from("stock")
        .update({ qty: (stockRow.qty || 0) + qty })
        .eq("id", stockRow.id);
    } else {
      await supabase.from("stock").insert({
        part_id: row.part_id,
        cabang_id: spbHeader.cabang_id,
        qty,
        min_qty: 0,
        max_qty: 0,
      });
    }

    await supabase.from("stock_movements").insert({
      part_id: row.part_id,
      cabang_id: spbHeader.cabang_id,
      qty_change: qty,
      type: "SPB_RETURN",
      reference_id: header.rtn_kode,
      notes: "Stock return from SPB",
      created_by: actorId,
    });
  }

  const { data: allDetails } = await supabase
    .from("spb_details")
    .select("dtl_spb_qty, dtl_spb_qty_returned")
    .eq("spb_id", header.spb_id);

  const allReturned = (allDetails || []).every(
    (d) => (d.dtl_spb_qty_returned || 0) >= (d.dtl_spb_qty || 0),
  );

  await supabase
    .from("spb")
    .update({ spb_status: allReturned ? "Returned" : "Partial" })
    .eq("id", header.spb_id);

  await supabase
    .from("return_spb")
    .update({ rtn_status: allReturned ? "Returned" : "Partial" })
    .eq("id", returnId);

  return { success: true };
}

async function finalizeSpbPoStatus(spbPoId: number) {
  const supabase = await createClient();
  const { data: po } = await supabase
    .from("spb_po")
    .select("spb_id")
    .eq("id", spbPoId)
    .single();

  if (po?.spb_id) {
    await supabase
      .from("spb")
      .update({ spb_status: "PO_ATTACH" })
      .eq("id", po.spb_id);
  }
}

async function finalizeSpbDoStatus(spbDoId: number) {
  const supabase = await createClient();
  const { data: doHeader } = await supabase
    .from("spb_do")
    .select("spb_po_id")
    .eq("id", spbDoId)
    .single();

  if (!doHeader?.spb_po_id) return;

  const { data: po } = await supabase
    .from("spb_po")
    .select("spb_id")
    .eq("id", doHeader.spb_po_id)
    .single();

  if (po?.spb_id) {
    await supabase
      .from("spb")
      .update({ spb_status: "DO_ATTACH" })
      .eq("id", po.spb_id);
  }
}

async function finalizeSpbInvoiceStatus(spbInvoiceId: number) {
  const supabase = await createClient();
  const { data: invoiceHeader } = await supabase
    .from("spb_invoice")
    .select("spb_do_id")
    .eq("id", spbInvoiceId)
    .single();

  if (!invoiceHeader?.spb_do_id) return;

  const { data: doHeader } = await supabase
    .from("spb_do")
    .select("spb_po_id")
    .eq("id", invoiceHeader.spb_do_id)
    .single();

  if (!doHeader?.spb_po_id) return;

  const { data: po } = await supabase
    .from("spb_po")
    .select("spb_id")
    .eq("id", doHeader.spb_po_id)
    .single();

  if (po?.spb_id) {
    await supabase
      .from("spb")
      .update({ spb_status: "DONE_QUOTE" })
      .eq("id", po.spb_id);
  }
}

export async function generateSpbKode(cabangId?: number) {
  const supabase = await createClient();

  let usedCabangId = cabangId;
  if (!usedCabangId) {
    const me = await getCurrentUserProfile();
    if (!me.profile?.cabang_id) {
      return { error: "Cabang user tidak ditemukan." };
    }
    usedCabangId = me.profile.cabang_id;
  }

  const { data: cabang, error: cabangError } = await supabase
    .from("cabang")
    .select("kode_cabang")
    .eq("id", usedCabangId)
    .single();

  if (cabangError) return { error: cabangError.message };

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const cabangKode = (cabang?.kode_cabang || "XXX").toUpperCase();
  const prefix = `GMI${cabangKode}/${year}/${month}/`;

  const { data: latest, error: latestError } = await supabase
    .from("spb")
    .select("spb_no")
    .ilike("spb_no", `${prefix}%`)
    .order("spb_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) return { error: latestError.message };

  let seq = 1;
  if (latest?.spb_no) {
    const parts = latest.spb_no.split("/");
    seq = parseInt(parts[parts.length - 1] || "0", 10) + 1;
  }

  return { data: `${prefix}${formatNumber3(seq)}` };
}

export async function generateReturnKode() {
  const supabase = await createClient();

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `RTN/${year}/${month}/`;

  const { data: latest, error } = await supabase
    .from("return_spb")
    .select("rtn_kode")
    .ilike("rtn_kode", `${prefix}%`)
    .order("rtn_kode", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { error: error.message };

  let seq = 1;
  if (latest?.rtn_kode) {
    const parts = latest.rtn_kode.split("/");
    seq = parseInt(parts[parts.length - 1] || "0", 10) + 1;
  }

  return { data: `${prefix}${formatNumber3(seq)}` };
}

export async function getSpbList(params?: {
  search?: string;
  cabangId?: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const from = (page - 1) * limit;

  let query = supabase
    .from("spb")
    .select("*, details:spb_details(*), cabang(nama_cabang)", {
      count: "exact",
    })
    .eq("spb_is_deleted", false)
    .order("created_at", { ascending: false });

  if (params?.search) {
    query = query.or(
      `spb_no.ilike.%${params.search}%,spb_no_wo.ilike.%${params.search}%,spb_pic_gmi.ilike.%${params.search}%,spb_pic_ppa.ilike.%${params.search}%`,
    );
  }
  if (params?.cabangId) {
    query = query.eq("cabang_id", params.cabangId);
  }
  if (params?.status && params.status !== "all") {
    query = query.eq("spb_status", params.status);
  }

  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return { data: [], count: 0, error: error.message };

  return { data: data || [], count: count || 0, error: null as string | null };
}

export async function getSpbByNo(spbNo: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spb")
    .select(
      "*, details:spb_details(*), po:spb_po(*, details:spb_po_details(*)), return_headers:return_spb(*, details:return_spb_details(*))",
    )
    .eq("spb_no", spbNo)
    .eq("spb_is_deleted", false)
    .single();

  if (error) return { error: error.message };
  return { data };
}

export async function getSpbById(id: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spb")
    .select(
      "*, details:spb_details(*), po:spb_po(*, details:spb_po_details(*)), return_headers:return_spb(*, details:return_spb_details(*))",
    )
    .eq("id", id)
    .eq("spb_is_deleted", false)
    .single();

  if (error) return { error: error.message };
  return { data };
}

export async function createSpb(payload: CreateSpbPayload) {
  const supabase = await createClient();
  const me = await getCurrentUserProfile();
  if (me.error || !me.user) return { error: me.error || "Unauthorized" };

  const spbNo = payload.spb_no?.trim();
  if (!spbNo) {
    return { error: "Nomor SPB wajib diisi manual." };
  }

  const { data: existingSpb } = await supabase
    .from("spb")
    .select("id")
    .eq("spb_no", spbNo)
    .maybeSingle();

  if (existingSpb) {
    return { error: "Nomor SPB sudah digunakan. Gunakan nomor lain." };
  }

  if (!payload.items?.length) {
    return { error: "Minimal 1 item wajib diisi." };
  }

  const cabangId = payload.cabang_id || me.profile?.cabang_id;
  if (!cabangId) {
    return { error: "Cabang user tidak ditemukan." };
  }

  if (!payload.approval_template_id) {
    return { error: "Template approval wajib dipilih sebelum membuat SPB." };
  }

  const approvals = await buildStockOutApprovalFlow(
    supabase,
    "spb",
    cabangId,
    me.user.id,
    payload.approval_template_id,
  );

  if (!approvals.length) {
    return {
      error: "Template approval SPB tidak ditemukan atau tidak sesuai site.",
    };
  }

  for (const item of payload.items) {
    if (!item.part_id || !item.dtl_spb_qty || item.dtl_spb_qty <= 0) {
      return { error: "Semua item harus valid dan qty > 0." };
    }
  }

  const { data: spbHeader, error: spbErr } = await supabase
    .from("spb")
    .insert({
      spb_no: spbNo,
      spb_tanggal: payload.spb_tanggal,
      spb_no_wo: payload.spb_no_wo || null,
      spb_section: payload.spb_section || null,
      spb_pic_gmi: payload.spb_pic_gmi || me.profile?.nama || null,
      spb_pic_ppa: payload.spb_pic_ppa || null,
      spb_kode_unit: payload.spb_kode_unit || null,
      spb_tipe_unit: payload.spb_tipe_unit || null,
      spb_brand: payload.spb_brand || null,
      spb_hm: payload.spb_hm || null,
      spb_problem_remark: payload.spb_problem_remark || null,
      spb_status: "DRAFT",
      spb_gudang:
        payload.spb_gudang || (me.profile as any)?.cabang?.nama_cabang || null,
      cabang_id: cabangId,
      spb_pic: me.profile?.nama || null,
      approval_template_id: payload.approval_template_id,
      approvals,
      approval_status: "open",
      created_by: me.user.id,
    })
    .select()
    .single();

  if (spbErr || !spbHeader)
    return { error: spbErr?.message || "Gagal membuat SPB." };

  const detailRows = payload.items.map((item) => ({
    spb_id: spbHeader.id,
    part_id: item.part_id,
    dtl_spb_part_number: item.dtl_spb_part_number,
    dtl_spb_part_name: item.dtl_spb_part_name,
    dtl_spb_part_satuan: item.dtl_spb_part_satuan,
    dtl_spb_qty: item.dtl_spb_qty,
  }));

  const { error: detailErr } = await supabase
    .from("spb_details")
    .insert(detailRows);
  if (detailErr) {
    await supabase.from("spb").delete().eq("id", spbHeader.id);
    return { error: detailErr.message };
  }

  revalidateStockOutPaths();
  return { success: true, data: spbHeader };
}

export async function updateSpb(
  id: number,
  payload: Partial<{
    spb_no_wo: string;
    spb_section: string;
    spb_pic_ppa: string;
    spb_kode_unit: string;
    spb_tipe_unit: string;
    spb_brand: string;
    spb_hm: number;
    spb_problem_remark: string;
    spb_status: string;
  }>,
) {
  const auth = await requireModeratorOrAdmin();
  if ("error" in auth) return { error: auth.error };

  const { supabase } = auth;
  const { error } = await supabase.from("spb").update(payload).eq("id", id);

  if (error) return { error: error.message };
  revalidateStockOutPaths();
  return { success: true };
}

export async function deleteSpb(id: number) {
  const auth = await requireModeratorOrAdmin();
  if ("error" in auth) return { error: auth.error };

  const { supabase, user } = auth;

  const { data: header, error: headerErr } = await supabase
    .from("spb")
    .select("id, spb_no, cabang_id")
    .eq("id", id)
    .single();
  if (headerErr || !header)
    return { error: headerErr?.message || "SPB tidak ditemukan." };

  const { data: items, error: itemsErr } = await supabase
    .from("spb_details")
    .select("part_id, dtl_spb_qty")
    .eq("spb_id", id);

  if (itemsErr) return { error: itemsErr.message };

  for (const item of items || []) {
    const { data: stockRow, error: stockErr } = await supabase
      .from("stock")
      .select("id, qty")
      .eq("part_id", item.part_id)
      .eq("cabang_id", header.cabang_id)
      .single();

    if (!stockErr && stockRow) {
      await supabase
        .from("stock")
        .update({ qty: (stockRow.qty || 0) + (item.dtl_spb_qty || 0) })
        .eq("id", stockRow.id);

      await supabase.from("stock_movements").insert({
        part_id: item.part_id,
        cabang_id: header.cabang_id,
        qty_change: item.dtl_spb_qty,
        type: "SPB_ROLLBACK",
        reference_id: header.spb_no,
        notes: "Rollback due to SPB delete",
        created_by: user.id,
      });
    }
  }

  const { error: delErr } = await supabase.from("spb").delete().eq("id", id);

  if (delErr) return { error: delErr.message };

  revalidateStockOutPaths();
  return { success: true };
}

export async function getSpbPoList(params?: {
  search?: string;
  page?: number;
  limit?: number;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const from = (page - 1) * limit;

  let query = supabase
    .from("spb_po")
    .select(
      "*, spb:spb_id(id, spb_no, spb_tanggal, spb_status, spb_gudang), details:spb_po_details(*)",
      {
        count: "exact",
      },
    )
    .order("created_at", { ascending: false });

  if (params?.search) {
    query = query.or(
      `po_no.ilike.%${params.search}%,so_no.ilike.%${params.search}%`,
    );
  }

  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return { data: [], count: 0, error: error.message };

  return { data: data || [], count: count || 0, error: null as string | null };
}

export async function createSpbPo(payload: {
  spb_id: number;
  po_no: string;
  so_no?: string;
  so_date?: string;
  approval_template_id: number;
  details: { spb_dtl_id: number }[];
}) {
  const supabase = await createClient();
  const me = await getCurrentUserProfile();
  if (me.error || !me.user) return { error: me.error || "Unauthorized" };

  if (!payload.details?.length) return { error: "Pilih minimal 1 item SPB." };

  if (!payload.approval_template_id) {
    return { error: "Template approval wajib dipilih sebelum membuat SPB PO." };
  }

  const { data: spbHeader } = await supabase
    .from("spb")
    .select("id, cabang_id")
    .eq("id", payload.spb_id)
    .single();

  if (!spbHeader?.cabang_id) {
    return { error: "SPB sumber tidak valid." };
  }

  const approvals = await buildStockOutApprovalFlow(
    supabase,
    "spb_po",
    spbHeader.cabang_id,
    me.user.id,
    payload.approval_template_id,
  );

  if (!approvals.length) {
    return {
      error: "Template approval SPB PO tidak ditemukan atau tidak sesuai site.",
    };
  }

  const { data: poHeader, error: poErr } = await supabase
    .from("spb_po")
    .insert({
      spb_id: payload.spb_id,
      po_no: payload.po_no,
      so_no: payload.so_no || null,
      so_date: payload.so_date || null,
      approval_template_id: payload.approval_template_id,
      approvals,
      approval_status: "open",
    })
    .select()
    .single();

  if (poErr || !poHeader)
    return { error: poErr?.message || "Gagal membuat SPB PO." };

  const rows = payload.details.map((d) => ({
    spb_po_id: poHeader.id,
    spb_dtl_id: d.spb_dtl_id,
  }));
  const { error: rowsErr } = await supabase.from("spb_po_details").insert(rows);
  if (rowsErr) {
    await supabase.from("spb_po").delete().eq("id", poHeader.id);
    return { error: rowsErr.message };
  }

  revalidateStockOutPaths();
  return { success: true, data: poHeader };
}

export async function getSpbDoList(params?: {
  search?: string;
  page?: number;
  limit?: number;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const from = (page - 1) * limit;

  let query = supabase
    .from("spb_do")
    .select(
      "*, po:spb_po_id(id, po_no, so_no, spb:spb_id(id, spb_no, spb_gudang, spb_status)), details:spb_do_details(*)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (params?.search) {
    query = query.or(
      `do_no.ilike.%${params.search}%,do_pic.ilike.%${params.search}%`,
    );
  }

  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return { data: [], count: 0, error: error.message };

  return { data: data || [], count: count || 0, error: null as string | null };
}

export async function createSpbDo(payload: {
  spb_po_id: number;
  do_no: string;
  do_date?: string;
  do_status_part?: string;
  do_pic?: string;
  approval_template_id: number;
  details: { spb_po_dtl_id: number }[];
}) {
  const supabase = await createClient();
  const me = await getCurrentUserProfile();
  if (me.error || !me.user) return { error: me.error || "Unauthorized" };

  if (!payload.details?.length)
    return { error: "Pilih minimal 1 item PO detail." };

  if (!payload.approval_template_id) {
    return { error: "Template approval wajib dipilih sebelum membuat SPB DO." };
  }

  const { data: poHeader } = await supabase
    .from("spb_po")
    .select("id, spb:spb_id(cabang_id)")
    .eq("id", payload.spb_po_id)
    .single();

  const spbRelation = Array.isArray((poHeader as any)?.spb)
    ? (poHeader as any)?.spb?.[0]
    : (poHeader as any)?.spb;
  const cabangId = spbRelation?.cabang_id;
  if (!cabangId) {
    return { error: "PO sumber tidak valid." };
  }

  const approvals = await buildStockOutApprovalFlow(
    supabase,
    "spb_do",
    cabangId,
    me.user.id,
    payload.approval_template_id,
  );

  if (!approvals.length) {
    return {
      error: "Template approval SPB DO tidak ditemukan atau tidak sesuai site.",
    };
  }

  const { data: doHeader, error: doErr } = await supabase
    .from("spb_do")
    .insert({
      spb_po_id: payload.spb_po_id,
      do_no: payload.do_no,
      do_date: payload.do_date || null,
      do_status_part: payload.do_status_part || "DELIVERED",
      do_pic: payload.do_pic || null,
      approval_template_id: payload.approval_template_id,
      approvals,
      approval_status: "open",
    })
    .select()
    .single();

  if (doErr || !doHeader)
    return { error: doErr?.message || "Gagal membuat SPB DO." };

  const rows = payload.details.map((d) => ({
    spb_do_id: doHeader.id,
    spb_po_dtl_id: d.spb_po_dtl_id,
  }));
  const { error: rowsErr } = await supabase.from("spb_do_details").insert(rows);
  if (rowsErr) {
    await supabase.from("spb_do").delete().eq("id", doHeader.id);
    return { error: rowsErr.message };
  }

  revalidateStockOutPaths();
  return { success: true, data: doHeader };
}

export async function getSpbInvoiceList(params?: {
  search?: string;
  page?: number;
  limit?: number;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const from = (page - 1) * limit;

  let query = supabase
    .from("spb_invoice")
    .select(
      "*, do:spb_do_id(id, do_no, po:spb_po_id(id, po_no, spb:spb_id(id, spb_no, spb_status))), details:spb_invoice_details(*)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (params?.search) {
    query = query.or(`invoice_no.ilike.%${params.search}%`);
  }

  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return { data: [], count: 0, error: error.message };

  return { data: data || [], count: count || 0, error: null as string | null };
}

export async function createSpbInvoice(payload: {
  spb_do_id: number;
  invoice_no: string;
  invoice_date?: string;
  invoice_email_date?: string;
  approval_template_id: number;
  details: { spb_do_dtl_id: number; invoice_qty?: number }[];
}) {
  const supabase = await createClient();
  const me = await getCurrentUserProfile();
  if (me.error || !me.user) return { error: me.error || "Unauthorized" };

  if (!payload.details?.length)
    return { error: "Pilih minimal 1 item DO detail." };

  if (!payload.approval_template_id) {
    return {
      error: "Template approval wajib dipilih sebelum membuat SPB Invoice.",
    };
  }

  const { data: doHeader } = await supabase
    .from("spb_do")
    .select("id, po:spb_po_id(spb:spb_id(cabang_id))")
    .eq("id", payload.spb_do_id)
    .single();

  const poRelation = Array.isArray((doHeader as any)?.po)
    ? (doHeader as any)?.po?.[0]
    : (doHeader as any)?.po;
  const spbRelation = Array.isArray(poRelation?.spb)
    ? poRelation?.spb?.[0]
    : poRelation?.spb;
  const cabangId = spbRelation?.cabang_id;
  if (!cabangId) {
    return { error: "DO sumber tidak valid." };
  }

  const approvals = await buildStockOutApprovalFlow(
    supabase,
    "spb_invoice",
    cabangId,
    me.user.id,
    payload.approval_template_id,
  );

  if (!approvals.length) {
    return {
      error:
        "Template approval SPB Invoice tidak ditemukan atau tidak sesuai site.",
    };
  }

  const { data: invHeader, error: invErr } = await supabase
    .from("spb_invoice")
    .insert({
      spb_do_id: payload.spb_do_id,
      invoice_no: payload.invoice_no,
      invoice_date: payload.invoice_date || null,
      invoice_email_date: payload.invoice_email_date || null,
      approval_template_id: payload.approval_template_id,
      approvals,
      approval_status: "open",
    })
    .select()
    .single();

  if (invErr || !invHeader)
    return { error: invErr?.message || "Gagal membuat invoice." };

  const rows = payload.details.map((d) => ({
    spb_invoice_id: invHeader.id,
    spb_do_dtl_id: d.spb_do_dtl_id,
    invoice_qty: d.invoice_qty || null,
  }));

  const { error: rowsErr } = await supabase
    .from("spb_invoice_details")
    .insert(rows);
  if (rowsErr) {
    await supabase.from("spb_invoice").delete().eq("id", invHeader.id);
    return { error: rowsErr.message };
  }

  revalidateStockOutPaths();
  return { success: true, data: invHeader };
}

export async function getReturnSpbList(params?: {
  search?: string;
  page?: number;
  limit?: number;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 25;
  const from = (page - 1) * limit;

  let query = supabase
    .from("return_spb")
    .select(
      "*, spb:spb_id(id, spb_no, spb_status), details:return_spb_details(*)",
      {
        count: "exact",
      },
    )
    .order("created_at", { ascending: false });

  if (params?.search) {
    query = query.or(`rtn_kode.ilike.%${params.search}%`);
  }

  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return { data: [], count: 0, error: error.message };

  return { data: data || [], count: count || 0, error: null as string | null };
}

export async function getReturnSpbByKode(kode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("return_spb")
    .select("*, spb:spb_id(*), details:return_spb_details(*)")
    .eq("rtn_kode", kode)
    .single();

  if (error) return { error: error.message };
  return { data };
}

export async function createReturnSpb(payload: {
  rtn_kode: string;
  spb_id: number;
  approval_template_id: number;
  rtn_tanggal: string;
  rtn_note?: string;
  details: { spb_dtl_id: number; part_id: number; qty_return: number }[];
}) {
  const supabase = await createClient();
  const me = await getCurrentUserProfile();
  if (me.error || !me.user) return { error: me.error || "Unauthorized" };

  const rtnKode = payload.rtn_kode?.trim();
  if (!rtnKode) {
    return { error: "Kode Return wajib diisi manual." };
  }

  const { data: existingReturn } = await supabase
    .from("return_spb")
    .select("id")
    .eq("rtn_kode", rtnKode)
    .maybeSingle();

  if (existingReturn) {
    return { error: "Kode Return sudah digunakan. Gunakan kode lain." };
  }

  if (!payload.details?.length) {
    return { error: "Minimal 1 item return wajib diisi." };
  }

  const { data: spbHeader, error: spbErr } = await supabase
    .from("spb")
    .select("id, spb_no, cabang_id")
    .eq("id", payload.spb_id)
    .single();

  if (spbErr || !spbHeader)
    return { error: spbErr?.message || "SPB tidak ditemukan." };

  if (!payload.approval_template_id) {
    return {
      error: "Template approval wajib dipilih sebelum membuat Return SPB.",
    };
  }

  const approvals = await buildStockOutApprovalFlow(
    supabase,
    "return_spb",
    spbHeader.cabang_id,
    me.user.id,
    payload.approval_template_id,
  );

  if (!approvals.length) {
    return {
      error:
        "Template approval Return SPB tidak ditemukan atau tidak sesuai site.",
    };
  }

  const toReturnRows: Array<{
    spb_dtl_id: number;
    part_id: number;
    qty: number;
  }> = [];
  for (const d of payload.details) {
    if (!d.qty_return || d.qty_return <= 0) continue;

    const { data: spbDetail, error: detailErr } = await supabase
      .from("spb_details")
      .select("id, dtl_spb_qty, dtl_spb_qty_returned")
      .eq("id", d.spb_dtl_id)
      .single();

    if (detailErr || !spbDetail) {
      return { error: `Detail SPB ${d.spb_dtl_id} tidak ditemukan.` };
    }

    const maxReturn =
      (spbDetail.dtl_spb_qty || 0) - (spbDetail.dtl_spb_qty_returned || 0);
    if (d.qty_return > maxReturn) {
      return {
        error: `Qty return melebihi sisa qty pada detail ${d.spb_dtl_id}.`,
      };
    }

    toReturnRows.push({
      spb_dtl_id: d.spb_dtl_id,
      part_id: d.part_id,
      qty: d.qty_return,
    });
  }

  if (!toReturnRows.length) {
    return { error: "Qty return belum diisi." };
  }

  const { data: returnHeader, error: returnErr } = await supabase
    .from("return_spb")
    .insert({
      rtn_kode: rtnKode,
      spb_id: payload.spb_id,
      rtn_tanggal: payload.rtn_tanggal,
      rtn_note: payload.rtn_note || null,
      rtn_status: "DRAFT",
      approval_template_id: payload.approval_template_id,
      approvals,
      approval_status: "open",
    })
    .select()
    .single();

  if (returnErr || !returnHeader) {
    return { error: returnErr?.message || "Gagal membuat Return SPB." };
  }

  const detailRows = toReturnRows.map((d) => ({
    rtn_id: returnHeader.id,
    spb_dtl_id: d.spb_dtl_id,
    part_id: d.part_id,
    dtl_rtn_qty_return: d.qty,
  }));

  const { error: rtnDetailErr } = await supabase
    .from("return_spb_details")
    .insert(detailRows);
  if (rtnDetailErr) {
    await supabase.from("return_spb").delete().eq("id", returnHeader.id);
    return { error: rtnDetailErr.message };
  }

  revalidateStockOutPaths();
  return { success: true, data: returnHeader };
}

export async function getStockOutApprovalTemplates(
  docType: StockOutDocType,
  cabangId?: number,
) {
  const supabase = await createClient();
  const type = STOCK_OUT_APPROVAL_TYPES[docType];

  let query = supabase
    .from("approval_templates")
    .select("id, name, cabang_id")
    .eq("type", type)
    .order("cabang_id", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true });

  if (cabangId) {
    query = query.or(`cabang_id.eq.${cabangId},cabang_id.is.null`);
  }

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

async function approveStockOutDocument(
  table: "spb" | "spb_po" | "spb_do" | "spb_invoice" | "return_spb",
  id: number,
  onComplete?: (
    id: number,
    actorId: string,
  ) => Promise<{ error?: string } | void>,
) {
  const supabase = await createClient();
  const me = await getCurrentUserProfile();
  if (me.error || !me.user) return { error: me.error || "Unauthorized" };

  const { data: row, error } = await supabase
    .from(table)
    .select("id, approvals, approval_status")
    .eq("id", id)
    .single();

  if (error || !row)
    return { error: error?.message || "Dokumen tidak ditemukan." };
  if (row.approval_status === "completed") return { success: true, data: row };
  if (row.approval_status === "rejected") {
    return { error: "Dokumen sudah berstatus rejected." };
  }

  const approvals = processStockOutApprovalStep(
    row.approvals || [],
    me.user.id,
    me.profile,
    "approved",
  );

  const stillPending = approvals.some((a: any) => a.status === "pending");
  const nextStatus = stillPending ? "open" : "completed";

  const { data: updated, error: updateErr } = await supabase
    .from(table)
    .update({
      approvals,
      approval_status: nextStatus,
      completed_at: stillPending ? null : new Date().toISOString(),
      rejection_reason: null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateErr) return { error: updateErr.message };

  if (!stillPending && onComplete) {
    const finalizeResult = await onComplete(id, me.user.id);
    if (finalizeResult?.error) {
      await supabase
        .from(table)
        .update({ approval_status: "open", completed_at: null })
        .eq("id", id);
      return { error: finalizeResult.error };
    }
  }

  revalidateStockOutPaths();
  return { success: true, data: updated };
}

async function rejectStockOutDocument(
  table: "spb" | "spb_po" | "spb_do" | "spb_invoice" | "return_spb",
  id: number,
  reason: string,
) {
  const supabase = await createClient();
  const me = await getCurrentUserProfile();
  if (me.error || !me.user) return { error: me.error || "Unauthorized" };

  const notes = reason?.trim();
  if (!notes) {
    return { error: "Alasan reject wajib diisi." };
  }

  const { data: row, error } = await supabase
    .from(table)
    .select("id, approvals, approval_status")
    .eq("id", id)
    .single();

  if (error || !row)
    return { error: error?.message || "Dokumen tidak ditemukan." };
  if (row.approval_status === "completed") {
    return { error: "Dokumen sudah completed dan tidak bisa direject." };
  }

  const approvals = processStockOutApprovalStep(
    row.approvals || [],
    me.user.id,
    me.profile,
    "rejected",
    notes,
  );

  const { data: updated, error: updateErr } = await supabase
    .from(table)
    .update({
      approvals,
      approval_status: "rejected",
      rejection_reason: notes,
      completed_at: null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateErr) return { error: updateErr.message };

  revalidateStockOutPaths();
  return { success: true, data: updated };
}

export async function approveSpb(id: number) {
  return approveStockOutDocument("spb", id, async (docId, actorId) => {
    const res = await applySpbPosting(docId, actorId);
    if (res.error) return { error: res.error };

    const supabase = await createClient();
    await supabase
      .from("spb")
      .update({ spb_status: "DONE QUOT" })
      .eq("id", docId);
  });
}

export async function rejectSpb(id: number, reason: string) {
  return rejectStockOutDocument("spb", id, reason);
}

export async function approveSpbPo(id: number) {
  return approveStockOutDocument("spb_po", id, async (docId) => {
    await finalizeSpbPoStatus(docId);
  });
}

export async function rejectSpbPo(id: number, reason: string) {
  return rejectStockOutDocument("spb_po", id, reason);
}

export async function approveSpbDo(id: number) {
  return approveStockOutDocument("spb_do", id, async (docId) => {
    await finalizeSpbDoStatus(docId);
  });
}

export async function rejectSpbDo(id: number, reason: string) {
  return rejectStockOutDocument("spb_do", id, reason);
}

export async function approveSpbInvoice(id: number) {
  return approveStockOutDocument("spb_invoice", id, async (docId) => {
    await finalizeSpbInvoiceStatus(docId);
  });
}

export async function rejectSpbInvoice(id: number, reason: string) {
  return rejectStockOutDocument("spb_invoice", id, reason);
}

export async function approveReturnSpb(id: number) {
  return approveStockOutDocument("return_spb", id, async (docId, actorId) => {
    const res = await applyReturnSpbPosting(docId, actorId);
    if (res.error) return { error: res.error };
  });
}

export async function rejectReturnSpb(id: number, reason: string) {
  return rejectStockOutDocument("return_spb", id, reason);
}

export async function getSpbReport(params?: {
  search?: string;
  status?: "all" | "no_po" | "no_do" | "no_invoice";
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  const supabase = await createClient();
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 50;
  const from = (page - 1) * limit;

  let query = supabase
    .from("v_spb_report")
    .select("*", { count: "exact" })
    .order("spb_created_at", { ascending: false });

  if (params?.search) {
    query = query.or(
      `spb_no.ilike.%${params.search}%,dtl_spb_part_number.ilike.%${params.search}%,dtl_spb_part_name.ilike.%${params.search}%,po_no.ilike.%${params.search}%,do_no.ilike.%${params.search}%,invoice_no.ilike.%${params.search}%`,
    );
  }

  if (params?.startDate) {
    query = query.gte("spb_tanggal", params.startDate);
  }
  if (params?.endDate) {
    query = query.lte("spb_tanggal", params.endDate);
  }

  if (params?.status === "no_po") {
    query = query.is("po_no", null);
  }
  if (params?.status === "no_do") {
    query = query.not("po_no", "is", null).is("do_no", null);
  }
  if (params?.status === "no_invoice") {
    query = query.not("do_no", "is", null).is("invoice_no", null);
  }

  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) return { data: [], count: 0, error: error.message };

  return { data: data || [], count: count || 0, error: null as string | null };
}

export async function getSpbOptionsForPo(params?: {
  search?: string;
  limit?: number;
}) {
  const supabase = await createClient();
  const limit = params?.limit ?? 15;

  let query = supabase
    .from("spb")
    .select("id, spb_no, spb_status")
    .eq("spb_is_deleted", false)
    .in("spb_status", ["DONE QUOT", "PO_ATTACH", "DO_ATTACH", "DONE_QUOTE"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params?.search) {
    query = query.ilike("spb_no", `%${params.search}%`);
  }

  const { data, error } = await query;

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function getSpbDetailsBySpbId(spbId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spb_details")
    .select("*")
    .eq("spb_id", spbId)
    .order("id");

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function getSpbPoOptionsForDo(params?: {
  search?: string;
  limit?: number;
}) {
  const supabase = await createClient();
  const limit = params?.limit ?? 15;

  let query = supabase
    .from("spb_po")
    .select("id, po_no, spb:spb_id(spb_no)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params?.search) {
    query = query.ilike("po_no", `%${params.search}%`);
  }

  const { data, error } = await query;

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function getSpbPoDetailsByPoId(spbPoId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spb_po_details")
    .select("*, spb_detail:spb_dtl_id(*)")
    .eq("spb_po_id", spbPoId)
    .order("id");

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function getSpbDoOptionsForInvoice(params?: {
  search?: string;
  limit?: number;
}) {
  const supabase = await createClient();
  const limit = params?.limit ?? 15;

  let query = supabase
    .from("spb_do")
    .select("id, do_no, po:spb_po_id(po_no, spb:spb_id(spb_no))")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params?.search) {
    query = query.ilike("do_no", `%${params.search}%`);
  }

  const { data, error } = await query;

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function getSpbDoDetailsByDoId(spbDoId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spb_do_details")
    .select("*, po_detail:spb_po_dtl_id(*, spb_detail:spb_dtl_id(*))")
    .eq("spb_do_id", spbDoId)
    .order("id");

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function getSpbOptionsForReturn(params?: {
  search?: string;
  limit?: number;
}) {
  const supabase = await createClient();
  const limit = params?.limit ?? 15;

  let query = supabase
    .from("spb")
    .select("id, spb_no, spb_status")
    .eq("spb_is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params?.search) {
    query = query.ilike("spb_no", `%${params.search}%`);
  }

  const { data, error } = await query;

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function getSpbReturnableDetails(spbId: number) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spb_details")
    .select(
      "id, part_id, dtl_spb_part_number, dtl_spb_part_name, dtl_spb_part_satuan, dtl_spb_qty, dtl_spb_qty_returned",
    )
    .eq("spb_id", spbId)
    .order("id");

  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function nowIso() {
  return toISODate(new Date());
}

// Pembentuk array approvals untuk dokumen import, meniru PERSIS bentuk yang
// dibuat halaman form masing-masing (langkah pertama = pembuat dokumen,
// langsung approved; tanpa gambar tanda tangan karena dibuat lewat import).
//   - MR & Item Transfer : app/(With Sidebar)/mr/create, item-transfer/create
//   - PR & PO            : app/(With Sidebar)/pr/create, components/po/po-form

import type { ImportCtx } from "./common";

export async function loadApprovalTemplate(supabase: any, templateId: number | null, type: string) {
  if (!templateId) return null;
  const { data } = await supabase
    .from("approval_templates")
    .select("id, name, type, cabang_id, steps:approval_template_steps(*, profiles(id, nama, email))")
    .eq("id", templateId)
    .maybeSingle();
  if (!data || data.type !== type) return null;
  return data;
}

const sorted = (tpl: any) => [...(tpl?.steps || [])].sort((a: any, b: any) => a.step_order - b.step_order);

/** Bentuk approvals halaman MR / Item Transfer. */
export function mrStyleApprovals(tpl: any, ctx: ImportCtx) {
  const now = new Date().toISOString();
  return sorted(tpl).map((step: any) => {
    const isFirst = step.step_order === 1;
    return {
      step_id: step.id,
      step_order: step.step_order,
      level: step.level,
      status: isFirst ? "approved" : "pending",
      user_id: isFirst ? ctx.userId : step.user_id || null,
      nama: isFirst ? ctx.userName : step.profiles?.nama || "Unknown Approver",
      email: isFirst ? ctx.userEmail : step.profiles?.email || "-",
      role: isFirst ? "Requester" : step.level === "menyetujui" ? "Approver" : "Reviewer",
      processed_at: isFirst ? now : null,
      signature_url: null,
      snapshot: isFirst ? { nama: ctx.userName, email: ctx.userEmail, lokasi: ctx.userCabangName, role: "Requester" } : null,
    };
  });
}

/** Bentuk approvals halaman PR / PO. */
export function prStyleApprovals(tpl: any, ctx: ImportCtx) {
  const now = new Date().toISOString();
  return sorted(tpl).map((step: any, idx: number) => {
    const isFirst = idx === 0;
    const isRequester = step.approver_type === "requester";
    const profile = isRequester ? { id: ctx.userId, nama: ctx.userName, email: ctx.userEmail } : step.profiles;
    return {
      type: isRequester ? "Requester" : profile?.nama || "Approver",
      status: isFirst ? "approved" : "pending",
      userid: profile?.id || "",
      nama: profile?.nama || "Unknown",
      email: profile?.email || "",
      level: step.step_order,
      processed_at: isFirst ? now : null,
      signature_url: null,
      notes: null,
      snapshot: isFirst ? { nama: ctx.userName, email: ctx.userEmail, lokasi: ctx.userCabangName } : null,
    };
  });
}

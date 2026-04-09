// lib/approval.ts

import { createClient } from "@/lib/supabase/client";
import { Approval, ApprovalType, Profile } from "@/type";

/**
 * Instantiates an approval flow based on a template.
 * @param type The document type (Material Request, etc.)
 * @param cabang_id The location ID
 * @param requesterId The UUID of the creator
 */
export async function getApprovalFlow(
  type: ApprovalType,
  cabang_id: number,
  requesterId: string
): Promise<Approval[]> {
  const supabase = createClient();

  // 1. Fetch the template for the site and type
  const { data: template, error: tError } = await supabase
    .from("approval_templates")
    .select("id")
    .eq("type", type)
    .eq("cabang_id", cabang_id)
    .single();

  if (tError || !template) {
    console.warn(`No approval template found for ${type} in site ${cabang_id}`);
    return [];
  }

  // 2. Fetch steps for the template
  const { data: steps, error: sError } = await supabase
    .from("approval_template_steps")
    .select("*, profiles(*)")
    .eq("template_id", template.id)
    .order("step_order");

  if (sError || !steps) return [];

  // 3. Get requester profile if needed
  let requesterProfile: any = null;
  if (steps.some(s => s.approver_type === 'requester')) {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", requesterId)
      .single();
    requesterProfile = data;
  }

  // 4. Map steps to Approval objects
  return steps.map(step => {
    const isRequester = step.approver_type === "requester";
    const profile = isRequester ? requesterProfile : step.profiles;

    return {
      type: step.approver_type === "requester" ? "Requester" : (profile?.roles?.[0]?.label || "Approver"),
      status: "pending",
      userid: profile?.id || "",
      nama: profile?.nama || "Unknown",
      email: profile?.email || "",
      role: profile?.roles?.[0]?.name || "",
      department: profile?.department || "",
      level: step.level,
      processed_at: null,
      notes: null,
      snapshot: null
    };
  });
}

/**
 * Updates an approval step with the current user's action and captures a snapshot.
 */
export async function processApprovalStep(
  approvals: Approval[],
  userProfile: any,
  action: "approved" | "rejected",
  notes?: string
): Promise<Approval[]> {
  // Find the current step for this user
  const stepIndex = approvals.findIndex(
    a => a.userid === userProfile.id && a.status === "pending"
  );

  if (stepIndex === -1) return approvals;

  const newApprovals = [...approvals];
  const step = newApprovals[stepIndex];

  // Logic: Requset notes on rejection
  if (action === "rejected" && !notes) {
    throw new Error("Catatan wajib diisi saat menolak approval.");
  }

  newApprovals[stepIndex] = {
    ...step,
    status: action,
    processed_at: new Date().toISOString(),
    notes: notes || null,
    snapshot: {
      nama: userProfile.nama,
      email: userProfile.email,
      role: userProfile.roles?.[0]?.name || "N/A",
      lokasi: userProfile.cabang?.nama_cabang || "N/A"
    }
  };

  return newApprovals;
}

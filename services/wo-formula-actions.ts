"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { WO_FORMULA_ROLES } from "@/lib/wo-formula-permissions";

// ============================================================
// WORK ORDER FORMULA (BOM) — komposisi komponen yang dibutuhkan untuk
// "memproduksi" 1 unit suatu PN target lewat Working Order. Satu PN target
// punya maksimal satu formula (wo_formulas), berisi banyak baris komponen
// (wo_formula_components).
//
// Halaman ini hanya boleh dikelola moderator + user yang dipilih moderator
// (role 'wo_formula_editor', lihat lib/wo-formula-permissions.ts). Baca
// formula (getWoFormulaByTargetPart) TIDAK digerbang oleh akses ini --
// dipakai juga oleh siapapun yang membuat Working Order.
// ============================================================

async function getRoleNames(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);
  return (data || [])
    .map((row: any) => row?.roles?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

async function requireWoFormulaAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" } as const;

  const roleNames = await getRoleNames(supabase, user.id);
  const allowed = roleNames.some((role) => WO_FORMULA_ROLES.includes(role));
  if (!allowed)
    return {
      error: "Akses ditolak. Hanya moderator/user terpilih yang dapat mengelola WO Formula.",
    } as const;

  return { supabase, user, roleNames } as const;
}

async function requireModerator() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired" } as const;

  const roleNames = await getRoleNames(supabase, user.id);
  if (!roleNames.includes("moderator"))
    return { error: "Hanya moderator yang dapat mengubah akses WO Formula." } as const;

  return { supabase, user } as const;
}

export type WoFormulaComponentInput = {
  component_part_id: number;
  component_part_number: string;
  component_part_name: string;
  component_satuan: string;
  qty_per_unit: number;
};

/**
 * Daftar semua formula (untuk list halaman WO Formula).
 */
export async function getWoFormulaList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wo_formulas")
    .select(
      "*, barang:target_part_id(part_number, part_name, part_satuan), wo_formula_components(id)",
    )
    .order("updated_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: data || [], error: null as string | null };
}

/**
 * Formula + komponen untuk satu PN target. Dipakai halaman WO Formula
 * (edit) maupun halaman Buat WO (baca saja, saat item di-checklist).
 */
export async function getWoFormulaByTargetPart(targetPartId: number) {
  const supabase = await createClient();
  const { data: formula, error } = await supabase
    .from("wo_formulas")
    .select("*, wo_formula_components(*)")
    .eq("target_part_id", targetPartId)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: formula, error: null as string | null };
}

/**
 * Buat/perbarui formula untuk satu PN target -- replace-all pada baris
 * komponennya (pola sama seperti setRolePermissions di services/role-actions.ts).
 */
export async function upsertWoFormula(
  targetPartId: number,
  components: WoFormulaComponentInput[],
) {
  const gate = await requireWoFormulaAccess();
  if ("error" in gate) return gate;
  const { supabase, user } = gate;

  if (!components || components.length === 0)
    return { error: "Minimal 1 komponen formula harus diisi." };

  for (const c of components) {
    if (!c.qty_per_unit || c.qty_per_unit <= 0)
      return { error: `${c.component_part_number}: qty per unit harus lebih dari 0.` };
  }
  const dup = new Set<number>();
  for (const c of components) {
    if (dup.has(c.component_part_id))
      return { error: `${c.component_part_number}: komponen duplikat dalam satu formula.` };
    dup.add(c.component_part_id);
  }
  if (components.some((c) => c.component_part_id === targetPartId))
    return { error: "PN target tidak boleh menjadi komponen dari dirinya sendiri." };

  const { data: existing } = await supabase
    .from("wo_formulas")
    .select("id")
    .eq("target_part_id", targetPartId)
    .maybeSingle();

  let formulaId = existing?.id as number | undefined;

  if (formulaId) {
    const { error: updateError } = await supabase
      .from("wo_formulas")
      .update({ is_active: true })
      .eq("id", formulaId);
    if (updateError) return { error: updateError.message };

    const { error: deleteError } = await supabase
      .from("wo_formula_components")
      .delete()
      .eq("formula_id", formulaId);
    if (deleteError) return { error: deleteError.message };
  } else {
    const { data: created, error: createError } = await supabase
      .from("wo_formulas")
      .insert({ target_part_id: targetPartId, created_by: user.id })
      .select("id")
      .single();
    if (createError) return { error: createError.message };
    formulaId = created.id;
  }

  const { error: insertError } = await supabase
    .from("wo_formula_components")
    .insert(
      components.map((c) => ({
        formula_id: formulaId,
        component_part_id: c.component_part_id,
        component_part_number: c.component_part_number,
        component_part_name: c.component_part_name,
        component_satuan: c.component_satuan,
        qty_per_unit: c.qty_per_unit,
      })),
    );
  if (insertError) return { error: insertError.message };

  revalidatePath("/working-order/formula");
  return { success: true, formulaId };
}

export async function deleteWoFormula(formulaId: number) {
  const gate = await requireWoFormulaAccess();
  if ("error" in gate) return gate;
  const { supabase } = gate;

  const { error } = await supabase.from("wo_formulas").delete().eq("id", formulaId);
  if (error) return { error: error.message };

  revalidatePath("/working-order/formula");
  return { success: true };
}

/**
 * User-user yang saat ini punya akses WO Formula (moderator + pemegang
 * role wo_formula_editor) -- dipakai panel "Kelola Akses".
 */
export async function getWoFormulaEditors() {
  const gate = await requireWoFormulaAccess();
  if ("error" in gate) return { data: [], error: gate.error };
  const { supabase } = gate;

  const { data: role } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "wo_formula_editor")
    .single();
  if (!role) return { data: [], error: "Role wo_formula_editor tidak ditemukan." };

  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, profiles(id, nama, email)")
    .eq("role_id", role.id);
  if (error) return { data: [], error: error.message };

  return {
    data: (data || []).map((r: any) => r.profiles).filter(Boolean),
    error: null as string | null,
  };
}

/**
 * Beri/cabut role wo_formula_editor ke satu user -- moderator only. Sengaja
 * cuma menyentuh role ini saja (bukan replace-all semantics seperti
 * updateUserRoles di services/role-actions.ts) supaya role lain milik user
 * itu tidak ikut tersentuh.
 */
export async function toggleWoFormulaEditor(userId: string, grant: boolean) {
  const gate = await requireModerator();
  if ("error" in gate) return gate;
  const { supabase } = gate;

  const { data: role } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "wo_formula_editor")
    .single();
  if (!role) return { error: "Role wo_formula_editor tidak ditemukan." };

  let writeClient: any = supabase;
  try {
    writeClient = createAdminClient();
  } catch {
    writeClient = supabase;
  }

  if (grant) {
    const { data: exists } = await writeClient
      .from("user_roles")
      .select("user_id")
      .eq("user_id", userId)
      .eq("role_id", role.id)
      .maybeSingle();
    if (!exists) {
      const { error } = await writeClient
        .from("user_roles")
        .insert({ user_id: userId, role_id: role.id });
      if (error) return { error: error.message };
    }
  } else {
    const { error } = await writeClient
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role_id", role.id);
    if (error) return { error: error.message };
  }

  revalidatePath("/working-order/formula");
  return { success: true };
}

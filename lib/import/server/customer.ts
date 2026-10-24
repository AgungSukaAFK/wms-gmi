import { revalidatePath } from "next/cache";
import type { ImportRowResult } from "../types";
import { type ImportHandler, bool, describeChanges, fail, fetchAll, fetchIn, firstValue, groupRows, keyOf, ok, str } from "./common";

const TYPE_TO_DB: Record<string, string> = {
  Reguler: "non_consignment",
  Consignment: "consignment",
  "Reguler & Consignment": "both",
};
const TYPE_FROM_DB: Record<string, string> = {
  non_consignment: "Reguler",
  consignment: "Consignment",
  both: "Reguler & Consignment",
};
const FIELDS = ["customer_name", "customer_type", "address", "telephone", "email", "contact_name", "pic_name", "is_active"] as const;
const LABELS: Record<string, string> = {
  customer_name: "Nama",
  customer_type: "Tipe",
  address: "Alamat",
  telephone: "Telepon",
  email: "Email",
  contact_name: "Kontak",
  pic_name: "PIC",
  is_active: "Aktif",
};
const show = (k: string, v: unknown) =>
  typeof v === "boolean" ? (v ? "Ya" : "Tidak") : k === "customer_type" ? TYPE_FROM_DB[String(v)] || v : v;

export const customerHandler: ImportHandler = {
  async run(ctx, rows) {
    const { supabase } = ctx;
    const customers = await fetchAll<any>(() => supabase.from("customers").select("*").order("id"));
    const byNo = new Map(customers.map((c) => [keyOf(c.customer_no), c]));
    const docs = groupRows(rows, (r) => keyOf(r.values.customer_no));
    const existingIds = Array.from(docs.keys())
      .map((k) => byNo.get(k)?.id)
      .filter(Boolean) as number[];
    const sites = await fetchIn<any>(existingIds, (ids) => supabase.from("customer_sites").select("*").in("customer_id", ids).order("id"));
    const siteKey = (cid: number, name: string) => `${cid}|${keyOf(name)}`;
    const siteMap = new Map(sites.map((s) => [siteKey(s.customer_id, s.site_name), s]));

    const results: ImportRowResult[] = [];
    type Plan = {
      rows: number[];
      customer: { kind: "insert" | "update" | "none"; id?: number; payload: any };
      sites: { row: number; kind: "insert" | "update"; id?: number; payload: any }[];
    };
    const plans: Plan[] = [];

    for (const [, list] of docs) {
      const no = str(list[0].values.customer_no)!;
      const existing = byNo.get(keyOf(no));
      const typeLabel = str(firstValue(list, "customer_type"));
      const incoming: Record<string, unknown> = {
        customer_name: str(firstValue(list, "customer_name")),
        customer_type: typeLabel ? TYPE_TO_DB[typeLabel] : null,
        address: str(firstValue(list, "address")),
        telephone: str(firstValue(list, "telephone")),
        email: str(firstValue(list, "email")),
        contact_name: str(firstValue(list, "contact_name")),
        pic_name: str(firstValue(list, "pic_name")),
        is_active: bool(firstValue(list, "is_active")),
      };
      const plan: Plan = { rows: list.map((r) => r.row), customer: { kind: "none", payload: {} }, sites: [] };
      let custMsg = "";
      if (!existing) {
        plan.customer = {
          kind: "insert",
          payload: {
            customer_no: no,
            ...incoming,
            customer_type: incoming.customer_type ?? "non_consignment",
            is_active: incoming.is_active ?? true,
          },
        };
        custMsg = "Customer baru";
      } else {
        const changes: Record<string, [unknown, unknown]> = {};
        const payload: any = {};
        for (const f of FIELDS) {
          const nv = incoming[f];
          if (nv === null || nv === undefined) continue;
          const cur = existing[f];
          if (typeof nv === "boolean" ? cur !== nv : String(cur ?? "") !== String(nv)) {
            changes[f] = [show(f, cur), show(f, nv)];
            payload[f] = nv;
          }
        }
        if (Object.keys(payload).length) {
          plan.customer = { kind: "update", id: existing.id, payload };
          custMsg = `Customer: ${describeChanges(changes, LABELS)}`;
        }
      }

      const seenSite = new Map<string, number>();
      list.forEach((r, i) => {
        const siteName = str(r.values.site_name);
        const msgs: string[] = [];
        if (i === 0 && custMsg) msgs.push(custMsg);
        let status: ImportRowResult["status"] = i === 0 && plan.customer.kind !== "none" ? (plan.customer.kind === "insert" ? "create" : "update") : "skip";
        if (siteName) {
          const prev = seenSite.get(keyOf(siteName));
          if (prev) {
            results.push(fail(r.row, `Site “${siteName}” dobel dengan baris ${prev}`, no));
            return;
          }
          seenSite.set(keyOf(siteName), r.row);
          const alamat = str(r.values.site_alamat);
          const aktif = bool(r.values.site_aktif);
          const cur = existing ? siteMap.get(siteKey(existing.id, siteName)) : null;
          if (!cur) {
            plan.sites.push({ row: r.row, kind: "insert", payload: { site_name: siteName, alamat, is_active: aktif ?? true } });
            msgs.push(`Site baru “${siteName}”`);
            status = status === "skip" ? "create" : status;
          } else {
            const payload: any = {};
            const ch: string[] = [];
            if (alamat && alamat !== (cur.alamat || "")) {
              payload.alamat = alamat;
              ch.push(`alamat → ${alamat}`);
            }
            if (aktif !== null && aktif !== cur.is_active) {
              payload.is_active = aktif;
              ch.push(`aktif → ${aktif ? "Ya" : "Tidak"}`);
            }
            if (Object.keys(payload).length) {
              plan.sites.push({ row: r.row, kind: "update", id: cur.id, payload });
              msgs.push(`Site “${cur.site_name}”: ${ch.join(", ")}`);
              if (status === "skip") status = "update";
            }
          }
        }
        results.push(ok(r.row, status, msgs.join(" · ") || "Tidak ada perubahan", no));
      });
      plans.push(plan);
    }

    if (!ctx.commit) return results;
    const byRow = new Map(results.map((x) => [x.row, x]));
    for (const plan of plans) {
      if (plan.rows.some((rw) => byRow.get(rw)?.status === "error")) {
        for (const rw of plan.rows) if (byRow.get(rw)?.status !== "error") byRow.set(rw, fail(rw, "Dilewati: ada baris error di customer yang sama", byRow.get(rw)?.ref));
        continue;
      }
      let customerId = plan.customer.id;
      const no = byRow.get(plan.rows[0])?.ref;
      if (plan.customer.kind === "insert") {
        const { data, error } = await supabase.from("customers").insert(plan.customer.payload).select("id").single();
        if (error) {
          for (const rw of plan.rows) byRow.set(rw, fail(rw, error.message, no));
          continue;
        }
        customerId = data.id;
      } else if (plan.customer.kind === "update") {
        const { error } = await supabase.from("customers").update({ ...plan.customer.payload, updated_at: new Date().toISOString() }).eq("id", plan.customer.id);
        if (error) {
          for (const rw of plan.rows) byRow.set(rw, fail(rw, error.message, no));
          continue;
        }
      } else {
        customerId = byNo.get(keyOf(no))?.id;
      }
      for (const s of plan.sites) {
        const q =
          s.kind === "insert"
            ? supabase.from("customer_sites").insert({ ...s.payload, customer_id: customerId })
            : supabase.from("customer_sites").update({ ...s.payload, updated_at: new Date().toISOString() }).eq("id", s.id);
        const { error } = await q;
        if (error) byRow.set(s.row, fail(s.row, error.message, no));
      }
    }
    revalidatePath("/customers");
    return rows.map((r) => byRow.get(r.row)!);
  },

  async prefill(ctx) {
    const { supabase } = ctx;
    const customers = await fetchAll<any>(() => supabase.from("customers").select("*").order("customer_no"));
    const sites = await fetchAll<any>(() => supabase.from("customer_sites").select("*").order("site_name"));
    const byCust = new Map<number, any[]>();
    for (const s of sites) byCust.set(s.customer_id, [...(byCust.get(s.customer_id) || []), s]);
    const out: Record<string, unknown>[] = [];
    for (const c of customers) {
      const base = {
        customer_no: c.customer_no,
        customer_name: c.customer_name,
        customer_type: TYPE_FROM_DB[c.customer_type] || "Reguler",
        address: c.address,
        telephone: c.telephone,
        email: c.email,
        contact_name: c.contact_name,
        pic_name: c.pic_name,
        is_active: c.is_active,
      };
      const list = byCust.get(c.id) || [];
      if (!list.length) out.push(base);
      for (const s of list) out.push({ ...base, site_name: s.site_name, site_alamat: s.alamat, site_aktif: s.is_active });
    }
    return out;
  },
};

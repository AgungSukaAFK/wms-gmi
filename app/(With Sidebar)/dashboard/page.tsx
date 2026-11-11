import { Content } from "@/components/content";
import { MainDashboard } from "@/components/dashboard/main/dashboard-view";
import { businessToday } from "@/lib/business-date";
import { resolveDashboardFilters } from "@/lib/dashboard/filters";
import type { ListScope } from "@/lib/dashboard/types";
import { fetchDashboardPart } from "@/services/dashboard-actions";

// Dashboard utama. Filter dibaca dari URL, lalu ringkasan diambil per bagian
// (get_main_dashboard_summary, p_part) secara PARALEL:
//   core   -> ditunggu; menentukan susunan halaman (profil, hak akses, antrian)
//   period, exec_a, exec_b -> dikirim sebagai promise, tampil menyusul
// Tiap bagian punya batas waktu statement sendiri; bagian yang gagal hanya
// menampilkan error di kartunya. Daftar di balik tiap angka diambil saat
// dibuka (get_main_dashboard_list).

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = businessToday();
  const filters = resolveDashboardFilters(await searchParams, today);

  // Semua dimulai bersamaan; hanya core yang ditunggu.
  const corePromise = fetchDashboardPart(filters, "core");
  const period = fetchDashboardPart(filters, "period");
  const execA = fetchDashboardPart(filters, "exec_a");
  const execB = fetchDashboardPart(filters, "exec_b");

  const { data: core, error } = await corePromise;

  if (!core || !core.viewer) {
    return (
      <Content title="Dashboard tidak bisa dimuat">
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {error
              ? "Data dashboard gagal diambil dari database."
              : "Profil akun Anda tidak ditemukan. Coba keluar lalu masuk lagi."}
          </p>
          {error && (
            <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{error}</p>
          )}
        </div>
      </Content>
    );
  }

  const scope: ListScope = {
    today: core.today,
    cabangIds: core.cabang_ids ?? [],
    from: core.date_from,
    to: core.date_to,
    kategori: filters.kategori,
    priorities: filters.priorities,
  };

  const isExec = core.viewer.is_exec;

  return (
    <MainDashboard
      core={core}
      filters={filters}
      scope={scope}
      parts={{
        period,
        // Non-atasan: bagian exec tidak dipakai (RPC-nya mengembalikan null).
        execA: isExec ? execA : null,
        execB: isExec ? execB : null,
      }}
    />
  );
}

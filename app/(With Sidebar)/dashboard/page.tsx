import { Content } from "@/components/content";
import { MainDashboard } from "@/components/dashboard/main/dashboard-view";
import { businessToday } from "@/lib/business-date";
import { resolveDashboardFilters } from "@/lib/dashboard/filters";
import type { ListScope } from "@/lib/dashboard/types";
import { fetchDashboardSummary } from "@/services/dashboard-actions";

// Dashboard utama. Filter dibaca dari URL, lalu SATU panggilan RPC
// (get_main_dashboard_summary, migration 20261111120000_main_dashboard.sql)
// mengembalikan profil + hak akses + semua angka. Daftar di balik tiap kartu
// diambil saat dibuka (get_main_dashboard_list).

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = businessToday();
  const filters = resolveDashboardFilters(await searchParams, today);
  const { data: summary, error } = await fetchDashboardSummary(filters);

  if (!summary || !summary.viewer) {
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
          {error?.includes("get_main_dashboard_summary") && (
            <p className="text-muted-foreground">
              Kemungkinan migration <code>20261111120000_main_dashboard.sql</code> belum dijalankan
              di database ini.
            </p>
          )}
        </div>
      </Content>
    );
  }

  const scope: ListScope = {
    today: summary.today,
    cabangIds: summary.cabang_ids ?? [],
    from: summary.date_from,
    to: summary.date_to,
    kategori: filters.kategori,
    priorities: filters.priorities,
  };

  return <MainDashboard summary={summary} filters={filters} scope={scope} />;
}

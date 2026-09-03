import { LayoutDashboard } from "lucide-react";
import { Content } from "@/components/content";
import { Badge } from "@/components/ui/badge";

export default function DashboardConsignmentPage() {
  return (
    <>
      <Content>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
              <LayoutDashboard className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">DASHBOARD CONSIGNMENT</h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                SO Reguler &middot; Consignment
              </p>
            </div>
          </div>

          <Badge variant="secondary" className="w-fit text-[10px] font-bold uppercase">
            Segera Hadir
          </Badge>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <LayoutDashboard className="h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">Dashboard Consignment sedang dalam pengembangan</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Akan menampilkan tracking penuh proses consignment (supply, pengiriman,
            procurement, hingga rekonsiliasi) untuk tiap Sales Order. Menyusul
            setelah modul Sales Order disetujui.
          </p>
        </div>
      </Content>
    </>
  );
}

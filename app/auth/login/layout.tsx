import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";

export const metadata: Metadata = publicPageMetadata({
  path: "/auth/login",
  title: "Login",
  description:
    "Masuk ke WMS GMI, Warehouse Management System PT. Garuda Mart Indonesia, untuk mengelola permintaan, pembelian, stok, dan pengiriman barang.",
});

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}

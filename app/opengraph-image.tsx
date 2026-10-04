import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

export const alt = "WMS GMI - Warehouse Management System PT. Garuda Mart Indonesia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.25), transparent 45%), radial-gradient(circle at 80% 90%, rgba(34,197,94,0.2), transparent 45%), #020617",
          color: "white",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 6,
            color: "#a5f3fc",
            textTransform: "uppercase",
          }}
        >
          {SITE_NAME}
        </div>
        <div style={{ display: "flex", fontSize: 80, fontWeight: 900, marginTop: 24, lineHeight: 1.1 }}>
          Warehouse Management System
        </div>
        <div style={{ display: "flex", fontSize: 32, marginTop: 32, color: "#cbd5e1" }}>
          PT. Garuda Mart Indonesia
        </div>
      </div>
    ),
    size,
  );
}

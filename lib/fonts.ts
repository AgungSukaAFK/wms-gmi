import {
  Atkinson_Hyperlegible,
  Geist,
  Geist_Mono,
  Inter,
  Nunito,
  Plus_Jakarta_Sans,
  Poppins,
  Roboto,
} from "next/font/google";

// Font pilihan user (lib/appearance.ts). Default wms-gmi = font sistem.
// Geist tetap di-preload seperti sebelumnya (dipakai langsung di cetak
// barcode); sisanya baru diunduh browser kalau dipilih user.
const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", display: "swap", subsets: ["latin"], preload: false });
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  display: "swap",
  subsets: ["latin"],
  preload: false,
});
const poppins = Poppins({
  variable: "--font-poppins",
  display: "swap",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  preload: false,
});
const nunito = Nunito({ variable: "--font-nunito", display: "swap", subsets: ["latin"], preload: false });
const roboto = Roboto({ variable: "--font-roboto", display: "swap", subsets: ["latin"], preload: false });
const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  display: "swap",
  subsets: ["latin"],
  weight: ["400", "700"],
  preload: false,
});

export const fontVariables = [geist, geistMono, inter, jakarta, poppins, nunito, roboto, atkinson]
  .map((f) => f.variable)
  .join(" ");

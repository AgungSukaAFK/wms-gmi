import { Toaster } from "@/components/ui/sonner";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* App belum memasang ThemeProvider, jadi kunci toast ke light. */}
      <Toaster richColors position="top-right" theme="light" />
    </>
  );
}

import { Toaster } from "@/components/ui/sonner";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        richColors
        closeButton
        position="bottom-right"
        toastOptions={{
          closeButtonAriaLabel: "Tutup",
          classNames: { content: "flex-1" }, // tombol Salin rapat ke kanan
        }}
      />
    </>
  );
}

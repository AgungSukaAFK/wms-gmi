"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

type ConfirmDialogProps = {
  title?: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Tombol konfirmasi merah (hapus, tolak). */
  destructive?: boolean;
  /** Boleh async: dialog menunggu selesai, tetap terbuka kalau throw. */
  onConfirm: () => void | Promise<void>;
  /** Dipanggil saat dialog ditutup tanpa konfirmasi (Batal / Esc / klik luar). */
  onCancel?: () => void;
  /** Elemen pemicu (mode trigger). Kosongkan kalau pakai `open`. */
  children?: React.ReactNode;
  /** Mode controlled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Satu-satunya komponen konfirmasi. Dua mode:
 * - trigger: `<ConfirmDialog …><Button>Hapus</Button></ConfirmDialog>`
 * - controlled: `<ConfirmDialog open={open} onOpenChange={setOpen} … />`
 * Untuk konfirmasi di tengah alur (handler yang lanjut setelah user setuju)
 * pakai `useConfirmDialog()`.
 */
export function ConfirmDialog({
  title = "Apakah Anda yakin?",
  description = "Tindakan ini tidak bisa dibatalkan.",
  confirmText = "Ya, lanjutkan",
  cancelText = "Batal",
  destructive = false,
  onConfirm,
  onCancel,
  children,
  open: openProp,
  onOpenChange,
}: ConfirmDialogProps) {
  const [innerOpen, setInnerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const open = openProp ?? innerOpen;

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };

  const handleConfirm = async (e: React.MouseEvent) => {
    // Tahan dialog tetap terbuka sampai onConfirm selesai.
    e.preventDefault();
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (loading) return;
        if (!next) onCancel?.();
        setOpen(next);
      }}
    >
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading}
            className={
              destructive ? buttonVariants({ variant: "destructive" }) : undefined
            }
          >
            {loading && <Loader2 className="animate-spin" />}
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ConfirmOptions = Omit<
  ConfirmDialogProps,
  "onConfirm" | "onCancel" | "children" | "open" | "onOpenChange"
>;

/**
 * Pengganti `window.confirm()` yang memakai ConfirmDialog:
 *
 *   const { confirm, confirmDialog } = useConfirmDialog();
 *   if (!(await confirm({ title: "Hapus vendor ini?", destructive: true }))) return;
 *   …
 *   return <>{…}{confirmDialog}</>;
 */
export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  // Opsi terakhir tetap disimpan supaya teks tidak berubah selama animasi tutup.
  const [options, setOptions] = useState<ConfirmOptions>({});
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  };

  const confirm = useCallback((opts: ConfirmOptions = {}) => {
    // Kalau masih ada konfirmasi terbuka, anggap yang lama dibatalkan.
    resolver.current?.(false);
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      {...options}
      open={open}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}

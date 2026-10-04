// src/app/auth/login/page.tsx

"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Building2, Headset, Loader2, LockKeyhole, LogIn, UserRound } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthInput } from "@/components/auth/auth-input";
import { signIn } from "@/services/auth-actions";

// Hanya izinkan path internal ("/mr/123"), tolak "//host" & URL absolut (open redirect).
function safeNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }
  return next;
}

function LoginContent() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const searchParams = useSearchParams();
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchParams.get("error") === "account_inactive") {
      setError(
        "Akun Anda belum diaktifkan oleh admin. Silakan hubungi administrator.",
      );
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);

    try {
      const result = await signIn(formData);
      if (result?.error) {
        throw new Error(result.error);
      }

      if (result?.success) {
        toast.success("Login berhasil! Mengarahkan...");
        // Use full-page navigation to ensure fresh session state on protected pages.
        const target = safeNextPath(searchParams.get("next"));
        redirectTimerRef.current = setTimeout(() => {
          window.location.assign(target);
        }, 500);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setError(message);
      toast.error("Login Gagal", { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Selamat datang kembali"
      description="Masuk dengan Email atau NRP Anda untuk melanjutkan."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="identifier">Email atau NRP</Label>
          <AuthInput
            icon={UserRound}
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            autoFocus
            required
            placeholder="email@example.com atau 123456"
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Lupa password?
            </button>
          </div>
          <AuthInput
            icon={LockKeyhole}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            disabled={loading}
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Login Gagal</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={loading} className="h-11 w-full">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Memproses...
            </>
          ) : (
            <>
              <LogIn className="size-4" />
              Masuk
            </>
          )}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Belum punya akun?{" "}
        <Link
          href="/auth/sign-up"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Daftar di sini
        </Link>
      </p>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              Lupa Password?
            </DialogTitle>
            <DialogDescription>
              Reset password mandiri lewat email tidak tersedia untuk sistem ini.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 rounded-md border p-3">
            <Headset className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="space-y-1 text-sm">
              <p>
                Silakan hubungi <span className="font-semibold">Tim IT</span> di{" "}
                <span className="font-semibold">Head Office PT. Garuda Mart Indonesia</span>{" "}
                untuk reset password akun Anda.
              </p>
              <p className="text-muted-foreground">
                Siapkan Nama, Email/NRP, dan Departemen Anda agar proses lebih cepat.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setForgotOpen(false)}>
              Mengerti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-svh bg-slate-950" />}>
      <LoginContent />
    </Suspense>
  );
}

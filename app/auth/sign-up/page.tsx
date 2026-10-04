// src/app/auth/sign-up/page.tsx

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Building2,
  IdCard,
  Loader2,
  LockKeyhole,
  Mail,
  UserPlus,
  UserRound,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthInput } from "@/components/auth/auth-input";
import { signUp } from "@/services/auth-actions";
import { getCabangList } from "@/services/master-actions";
import { cn } from "@/lib/utils";

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [cabangOptions, setCabangOptions] = useState<{ id: number; nama_cabang: string }[]>([]);

  const passwordMismatch = repeatPassword.length > 0 && password !== repeatPassword;

  useEffect(() => {
    async function fetchCabang() {
      const data = await getCabangList();
      setCabangOptions(data || []);
    }
    fetchCabang();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password !== repeatPassword) {
      setError("Konfirmasi password tidak cocok.");
      return;
    }

    setLoading(true);
    const formData = new FormData(event.currentTarget);

    try {
      const result = await signUp(formData);
      if (result?.error) {
        throw new Error(result.error);
      }
      setSignupSuccess(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setError(message);
      toast.error("Pendaftaran Gagal", { description: message });
    } finally {
      setLoading(false);
    }
  };

  if (signupSuccess) {
    return (
      <AuthShell
        title="Pendaftaran Berhasil"
        description="Akun Anda telah dibuat."
      >
        <div className="space-y-6">
          <p className="text-center text-sm text-muted-foreground">
            Silakan hubungi admin untuk aktivasi akun agar dapat mengakses
            sistem.
          </p>
          <Button asChild className="h-11 w-full">
            <Link href="/auth/login">Kembali ke Halaman Login</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Daftar Akun Baru"
      description="Buat akun untuk dapat mengakses sistem."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nama">Nama Lengkap</Label>
          <AuthInput
            icon={UserRound}
            id="nama"
            name="nama"
            type="text"
            autoComplete="name"
            placeholder="Masukkan nama asli Anda"
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <AuthInput
            icon={Mail}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="nama@perusahaan.com"
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nrp">NRP</Label>
          <AuthInput
            icon={IdCard}
            id="nrp"
            name="nrp"
            type="text"
            placeholder="Masukkan nomor identitas/NRP"
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cabang_id">Cabang Penempatan</Label>
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Select name="cabang_id" required disabled={loading}>
              <SelectTrigger
                id="cabang_id"
                className="w-full bg-background pl-10 data-[size=default]:h-11"
              >
                <SelectValue placeholder="Pilih cabang lokasi tugas" />
              </SelectTrigger>
              <SelectContent>
                {cabangOptions.map((cabang) => (
                  <SelectItem key={cabang.id} value={cabang.id.toString()}>
                    {cabang.nama_cabang}
                  </SelectItem>
                ))}
                {cabangOptions.length === 0 && (
                  <SelectItem value="disabled" disabled>
                    Memuat data cabang...
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <AuthInput
            icon={LockKeyhole}
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            disabled={loading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repeat-password">Ulangi Password</Label>
          <AuthInput
            icon={LockKeyhole}
            id="repeat-password"
            name="repeat-password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            disabled={loading}
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
            aria-invalid={passwordMismatch || undefined}
            aria-describedby={passwordMismatch ? "repeat-password-error" : undefined}
            className={cn(passwordMismatch && "border-destructive")}
          />
          {passwordMismatch && (
            <p id="repeat-password-error" className="text-xs text-destructive">
              Konfirmasi password belum cocok.
            </p>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Pendaftaran Gagal</AlertTitle>
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
              <UserPlus className="size-4" />
              Daftar
            </>
          )}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Sudah punya akun?{" "}
        <Link
          href="/auth/login"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Login di sini
        </Link>
      </p>
    </AuthShell>
  );
}

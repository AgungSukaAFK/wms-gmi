// src/app/auth/sign-up/page.tsx

"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { signUp } from "@/services/auth-actions";
import { getCabangList } from "@/services/master-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cabangOptions, setCabangOptions] = useState<{ id: number; nama_cabang: string }[]>([]);

  useEffect(() => {
    async function fetchCabang() {
      const data = await getCabangList();
      setCabangOptions(data || []);
    }
    fetchCabang();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = formData.get("password") as string;
    const repeatPassword = formData.get("repeat-password") as string;

    if (password !== repeatPassword) {
      setError("Konfirmasi password tidak cocok.");
      setLoading(false);
      return;
    }

    try {
      const result = await signUp(formData);
      if (result?.error) {
        throw new Error(result.error);
      }
      setSignupSuccess(true);
    } catch (error: any) {
      setError(error.message);
      toast.error("Pendaftaran Gagal", { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (signupSuccess) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl text-center">
              Pendaftaran Berhasil ✅
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">
              Akun Anda telah dibuat. Silakan hubungi admin untuk mendapatkan
              NRP dan aktivasi akun agar dapat mengakses sistem.
            </p>
            <Button asChild>
              <Link href="/auth/login">Kembali ke Halaman Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">
            Daftar Akun Baru
          </CardTitle>
          <CardDescription className="text-center">
            WMS-GMI: Sistem Warehouse Terintegrasi
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nama">Nama Lengkap</Label>
              <Input
                id="nama"
                name="nama"
                type="text"
                placeholder="Masukkan nama asli Anda"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="nama@perusahaan.com"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nrp">NRP</Label>
              <Input
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
              <Select name="cabang_id" required disabled={loading}>
                <SelectTrigger>
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
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repeat-password">Ulangi Password</Label>
              <Input
                id="repeat-password"
                name="repeat-password"
                type="password"
                required
                disabled={loading}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Pendaftaran Gagal</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Daftar Sekarang
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            Sudah punya akun?{" "}
            <Link href="/auth/login" className="underline underline-offset-4 text-primary">
              Login di sini
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

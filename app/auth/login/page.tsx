// src/app/auth/login/page.tsx

"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { signIn } from "@/services/auth-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      toast.success("Login berhasil! Mengarahkan ke dashboard...");
      // signIn server action already handles redirect if successful
    } catch (error: any) {
      setError(error.message);
      toast.error("Login Gagal", { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center font-bold">WMS-GMI Login</CardTitle>
          <CardDescription className="text-center">
            Masukkan Email atau NRP Anda untuk mengakses gudang.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email atau NRP</Label>
              <Input
                id="identifier"
                name="identifier"
                type="text"
                required
                placeholder="email@example.com / 123456"
                disabled={loading}
              />
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
            <div className="w-full flex justify-end">
              <Link
                href={"/auth/forgot-password"}
                className="text-end text-sm text-primary hover:underline"
              >
                Lupa password?
              </Link>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Login Gagal</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={loading} className="w-full text-lg font-semibold py-6">
              {loading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              Login
            </Button>
          </form>
          <div className="mt-6 text-center text-sm">
            Belum punya akun?{" "}
            <Link href="/auth/sign-up" className="underline underline-offset-4 text-primary font-medium">
              Daftar Sekarang
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

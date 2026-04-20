"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateOwnProfile } from "@/services/user-actions";
import { useAuthStore } from "@/stores/auth-store";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  User,
  Hash,
  Phone,
  Mail,
  Building2,
  ShieldCheck,
  Loader2,
  Save,
  Lock,
} from "lucide-react";

export default function ProfilePage() {
  const router = useRouter();
  const storeProfile = useAuthStore((s) => s.profile);

  const [nomorWhatsapp, setNomorWhatsapp] = useState("");
  const [waLoading, setWaLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [nama, setNama] = useState(storeProfile?.nama ?? "");
  const [nrp, setNrp] = useState(storeProfile?.nrp ?? "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  useEffect(() => {
    if (storeProfile) {
      setNama(storeProfile.nama ?? "");
      setNrp(storeProfile.nrp ?? "");
    }
  }, [storeProfile?.id]);

  useEffect(() => {
    if (!storeProfile?.id) return;
    async function fetchWa() {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("profiles")
          .select("nomor_whatsapp")
          .eq("id", storeProfile!.id)
          .single();
        setNomorWhatsapp((data as any)?.nomor_whatsapp ?? "");
      } catch {
        // non-critical
      } finally {
        setWaLoading(false);
      }
    }
    fetchWa();
  }, [storeProfile?.id]);

  async function handleSave() {
    if (!nama.trim()) {
      toast.error("Nama lengkap tidak boleh kosong.");
      return;
    }
    setSaving(true);
    const result = await updateOwnProfile({
      nama: nama.trim(),
      nrp: nrp.trim(),
      nomor_whatsapp: nomorWhatsapp.trim(),
    });
    setSaving(false);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Profil berhasil diperbarui.");
    }
  }

  async function handleChangePassword() {
    if (!oldPassword || !newPassword || !confirmNewPassword) {
      toast.error("Semua field password wajib diisi.");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("Password baru minimal 6 karakter.");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast.error("Konfirmasi password baru tidak cocok.");
      return;
    }

    if (!storeProfile?.email) {
      toast.error("Email akun tidak ditemukan.");
      return;
    }

    const supabase = createClient();
    setChangingPassword(true);

    try {
      // Verify old password by attempting sign-in with current credentials.
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: storeProfile.email,
        password: oldPassword,
      });

      if (verifyError) {
        toast.error("Password lama salah.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        toast.error(updateError.message || "Gagal mengubah password.");
        return;
      }

      await supabase.auth.signOut();
      toast.success("Password berhasil diubah. Silakan login ulang.");
      router.replace("/auth/login");
    } finally {
      setChangingPassword(false);
    }
  }

  if (!storeProfile) {
    return (
      <Content title="Profil Saya">
        <div className="flex h-60 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Content>
    );
  }

  const initials = storeProfile.nama
    ? storeProfile.nama
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "?";

  const roleNames =
    (storeProfile.roles as any[])
      ?.map((r: any) => r?.name ?? r)
      .filter(Boolean)
      .join(", ") || "-";

  return (
    <Content title="Profil Saya" description="Kelola informasi akun Anda">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="pt-6 flex flex-col items-center gap-3">
              <div className="h-20 w-20 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
                <span className="text-2xl font-black text-primary">
                  {initials}
                </span>
              </div>
              <div className="text-center">
                <p className="font-bold text-base">
                  {storeProfile.nama ?? "-"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {storeProfile.email}
                </p>
              </div>
              <Badge
                variant={
                  (storeProfile as any).is_active ? "default" : "secondary"
                }
                className="text-[10px]"
              >
                {(storeProfile as any).is_active ? "Aktif" : "Tidak Aktif"}
              </Badge>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-wide">
                Info Akun
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2.5 text-sm">
                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate text-muted-foreground">
                  {storeProfile.email ?? "-"}
                </span>
              </div>
              <Separator />
              <div className="flex items-center gap-2.5 text-sm">
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="capitalize text-muted-foreground">
                  {roleNames}
                </span>
              </div>
              <Separator />
              <div className="flex items-center gap-2.5 text-sm">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">
                  {storeProfile.cabang?.nama_cabang ?? "Belum ada cabang"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Edit Informasi Pribadi
              </CardTitle>
              <CardDescription className="text-xs">
                Perubahan akan langsung tersimpan ke akun Anda.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                  <User className="h-3 w-3" /> Nama Lengkap
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Input
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  placeholder="Masukkan nama lengkap..."
                  className="h-10 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                  <Hash className="h-3 w-3" /> NRP
                </Label>
                <Input
                  value={nrp}
                  onChange={(e) => setNrp(e.target.value)}
                  placeholder="Nomor Registrasi Pegawai..."
                  className="h-10 font-medium"
                />
                <p className="text-[11px] text-muted-foreground px-0.5">
                  NRP digunakan untuk login selain email. Harus unik.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
                  <Phone className="h-3 w-3" /> Nomor WhatsApp
                </Label>
                {waLoading ? (
                  <div className="h-10 rounded-md border bg-muted/40 flex items-center px-3">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Input
                    value={nomorWhatsapp}
                    onChange={(e) => setNomorWhatsapp(e.target.value)}
                    placeholder="08xxxxxxxxxx"
                    type="tel"
                    className="h-10 font-medium"
                  />
                )}
                <p className="text-[11px] text-muted-foreground px-0.5">
                  Digunakan untuk informasi kontak.
                </p>
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={saving || waLoading}
                  className="gap-2 font-bold"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {saving ? "Menyimpan..." : "Simpan Perubahan"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 mt-6">
            <CardHeader>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                Ganti Password
              </CardTitle>
              <CardDescription className="text-xs">
                Masukkan password lama lalu buat password baru.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                  Password Lama
                </Label>
                <Input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Masukkan password lama..."
                  className="h-10 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                  Password Baru
                </Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Masukkan password baru..."
                  className="h-10 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                  Konfirmasi Password Baru
                </Label>
                <Input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Ulangi password baru..."
                  className="h-10 font-medium"
                />
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                  className="gap-2 font-bold"
                >
                  {changingPassword ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  {changingPassword ? "Memproses..." : "Ubah Password"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Content>
  );
}

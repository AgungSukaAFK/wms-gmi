"use client";

import React, { useState, useEffect } from "react";
import { Content } from "@/components/content";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  FileSignature,
  Loader2,
  Upload,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  createSignature,
  getMySignatures,
  updateSignatureLabel,
  toggleSignatureVisibility,
} from "@/services/signature-actions";
import { SignatureEditor } from "@/components/signature/signature-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { UserSignature } from "@/type";
import { createClient } from "@/lib/supabase/client";

const MAX_SIGNATURES = 6;

export default function SignatureManagerPage() {
  const [signatures, setSignatures] = useState<UserSignature[]>([]);
  const [profileName, setProfileName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Create Modal State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [tempBlob, setTempBlob] = useState<Blob | null>(null);

  // Form State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [signaturePassword, setSignaturePassword] = useState("");
  const [confirmSignaturePassword, setConfirmSignaturePassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    const { data } = await getMySignatures();
    setSignatures(data || []);

    // Get profile name for read-only display
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("nama")
        .eq("id", user.id)
        .single();
      setProfileName(profile?.nama || "");
    }

    setIsLoading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (signatures.length >= MAX_SIGNATURES) {
        toast.error(`Batas maksimal ${MAX_SIGNATURES} tanda tangan telah tercapai.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setSelectedImage(reader.result as string);
        setIsEditorOpen(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = (blob: Blob) => {
    setTempBlob(blob);
    setIsEditorOpen(false);
    setIsPasswordModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!tempBlob || !label || !accountPassword || !signaturePassword) {
      toast.error("Harap isi semua kolom yang diperlukan.");
      return;
    }

    if (signaturePassword !== confirmSignaturePassword) {
      toast.error("Password tanda tangan tidak cocok.");
      return;
    }

    setIsSubmitting(true);

    // Create File object from Blob
    const imageFile = new File([tempBlob], "signature.png", {
      type: "image/png",
    });

    const result = await createSignature({
      imageFile,
      label,
      accountPassword,
      signaturePassword,
    });

    setIsSubmitting(false);

    if (result.success) {
      toast.success("Tanda tangan berhasil disimpan secara permanen.");
      setIsPasswordModalOpen(false);
      resetForm();
      loadData();
    } else {
      toast.error(result.error || "Gagal menyimpan tanda tangan.");
    }
  };

  const resetForm = () => {
    setSelectedImage(null);
    setTempBlob(null);
    setLabel("");
    setAccountPassword("");
    setSignaturePassword("");
    setConfirmSignaturePassword("");
  };

  const handleToggleVisibility = async (sig: UserSignature) => {
    const result = await toggleSignatureVisibility(sig.id, !sig.is_hidden);
    if (result.success) {
      toast.success(
        sig.is_hidden
          ? "Tanda tangan kini ditampilkan"
          : "Tanda tangan disembunyikan",
      );
      loadData();
    }
  };

  return (
    <>
      {/* Section 1: Header */}
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded flex items-center justify-center shadow-sm text-primary-foreground">
              <FileSignature className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight uppercase">
                Signature Manager
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Kelola tanda tangan digital untuk approval dokumen
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right mr-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Kuota Tersisa
              </p>
              <p className="text-lg font-bold text-foreground">
                {MAX_SIGNATURES - signatures.length}{" "}
                <span className="text-xs text-muted-foreground font-semibold">
                  / {MAX_SIGNATURES}
                </span>
              </p>
            </div>
            <label className="cursor-pointer">
              <Input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                disabled={signatures.length >= MAX_SIGNATURES}
              />
              <div
                className={`inline-flex items-center justify-center gap-2 rounded-md font-bold text-xs h-9 px-4 uppercase transition-all shadow-sm ${
                  signatures.length >= MAX_SIGNATURES
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
                }`}
              >
                <Plus className="h-4 w-4" />
                Tambah Tanda Tangan
              </div>
            </label>
          </div>
        </div>
      </Content>

      {/* Section 2: Signature Grid */}
      <Content>
        {isLoading ? (
          <div className="flex h-100 items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                Memuat Data...
              </span>
            </div>
          </div>
        ) : signatures.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 text-center gap-4">
            <div className="p-4 bg-muted/40 rounded-full">
              <FileSignature className="h-10 w-10 text-muted-foreground/30" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-foreground uppercase tracking-tight">
                Belum Ada Tanda Tangan
              </h3>
              <p className="text-xs text-muted-foreground">
                Unggah tanda tangan pertama Anda untuk mulai memberikan
                approval.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-1 text-xs font-bold uppercase"
              onClick={() =>
                document
                  .querySelector<HTMLInputElement>('input[type="file"]')
                  ?.click()
              }
            >
              <Upload className="h-3.5 w-3.5 mr-2" /> Klik untuk Mengunggah
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {signatures.map((sig) => (
              <Card
                key={sig.id}
                className={`overflow-hidden transition-all duration-300 ${
                  sig.is_hidden
                    ? "opacity-60 grayscale"
                    : "hover:shadow-md border-primary/20"
                }`}
              >
                <div className="h-40 bg-background relative flex items-center justify-center p-6 border-b border-border">
                  <img
                    src={sig.image_url}
                    alt={sig.label}
                    className="max-h-full max-w-full object-contain"
                  />
                  {sig.is_hidden && (
                    <div className="absolute inset-0 bg-muted/70 flex items-center justify-center">
                      <Badge variant="secondary" className="gap-1">
                        <EyeOff className="h-3 w-3" /> Tersembunyi
                      </Badge>
                    </div>
                  )}
                </div>
                <CardHeader className="p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm truncate flex-1 font-bold uppercase">
                      {sig.label}
                    </CardTitle>
                    <p className="text-[9px] text-muted-foreground font-mono shrink-0">
                      ID: {sig.id.substring(0, 8)}
                    </p>
                  </div>
                  <CardDescription className="text-xs font-medium text-foreground">
                    Nama: {sig.printed_name}
                  </CardDescription>
                </CardHeader>
                <CardFooter className="p-3 bg-muted/30 flex items-center justify-between border-t border-border">
                  <div className="text-[10px] text-muted-foreground font-medium">
                    Dibuat:{" "}
                    {new Date(sig.created_at).toLocaleDateString("id-ID")}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => handleToggleVisibility(sig)}
                    >
                      {sig.is_hidden ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </Content>

      {/* Section 3: Warning */}
      <Content>
        <div className="flex gap-4">
          <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-foreground uppercase">
              Penting: Integritas Data
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Tanda tangan yang sudah tersimpan{" "}
              <strong className="text-foreground">
                tidak dapat diubah gambarnya maupun nama yang tertera
              </strong>
              . Hal ini untuk menjaga legalitas dokumen yang pernah
              ditandatangani sebelumnya. Jika Anda ingin menggantinya, silakan
              sembunyikan tanda tangan lama dan buat yang baru.
            </p>
          </div>
        </div>
      </Content>

      {/* Editor Modal */}
      <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
        <DialogContent className="max-w-2xl sm:max-h-200 p-0 overflow-hidden">
          <div className="p-6 pb-0">
            <DialogTitle>Sesuaikan Tanda Tangan</DialogTitle>
            <DialogDescription>
              Atur posisi dan ukuran tanda tangan Anda agar terlihat rapi pada
              dokumen.
            </DialogDescription>
          </div>
          {selectedImage && (
            <SignatureEditor
              image={selectedImage}
              onCropComplete={onCropComplete}
              onCancel={() => setIsEditorOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Password Modal */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-125">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-success" />
              Proteksi Keamanan
            </DialogTitle>
            <DialogDescription>
              Tanda tangan Anda akan disimpan secara permanen. Harap masukkan
              password berikut untuk melanjutkan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="label">
                Label Tanda Tangan (Contoh: &quot;Tanda Tangan Utama&quot;)
              </Label>
              <Input
                id="label"
                placeholder="Misal: Tanda Tangan Utama"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <div className="p-3 bg-muted/40 rounded-lg border border-border flex gap-3 items-center">
              <div className="h-8 w-8 bg-background border border-border rounded flex items-center justify-center">
                <FileSignature className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground leading-none uppercase font-bold">
                  Nama Tertera (Otomatis)
                </p>
                <p className="text-sm font-bold text-foreground mt-1">
                  {profileName}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="acc-pass" className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Password Akun Anda
              </Label>
              <Input
                id="acc-pass"
                type="password"
                placeholder="Password yang Anda gunakan saat login"
                value={accountPassword}
                onChange={(e) => setAccountPassword(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sig-pass">Buat Password Signature</Label>
                <Input
                  id="sig-pass"
                  type="password"
                  placeholder="Password khusus"
                  value={signaturePassword}
                  onChange={(e) => setSignaturePassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="conf-sig-pass">Konfirmasi Password</Label>
                <Input
                  id="conf-sig-pass"
                  type="password"
                  placeholder="Ulangi password"
                  value={confirmSignaturePassword}
                  onChange={(e) => setConfirmSignaturePassword(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground italic">
              *Password Signature digunakan untuk verifikasi setiap kali Anda
              menandatangani dokumen nantinya.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setIsPasswordModalOpen(false)}
              disabled={isSubmitting}
            >
              Batal
            </Button>
            <Button
              className="bg-success text-success-foreground hover:bg-success/90"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Verifikasi &amp; Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

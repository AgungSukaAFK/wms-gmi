"use client";

import React, { useState, useEffect } from "react";
import { Content } from "@/components/content";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Plus, 
  ShieldCheck, 
  Trash2, 
  Eye, 
  EyeOff, 
  Lock, 
  FileSignature, 
  Loader2, 
  Upload,
  AlertCircle 
} from "lucide-react";
import { toast } from "sonner";
import { 
  createSignature, 
  getMySignatures, 
  updateSignatureLabel, 
  toggleSignatureVisibility 
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
    const { data: { user } } = await supabase.auth.getUser();
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
      if (signatures.length >= 10) {
        toast.error("Batas maksimal 10 tanda tangan telah tercapai.");
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
    const imageFile = new File([tempBlob], "signature.png", { type: "image/png" });

    const result = await createSignature({
      imageFile,
      label,
      accountPassword,
      signaturePassword
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
      toast.success(sig.is_hidden ? "Tanda tangan kini ditampilkan" : "Tanda tangan disembunyikan");
      loadData();
    }
  };

  return (
    <Content>
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <FileSignature className="h-8 w-8 text-blue-600" />
              Signature Manager
            </h1>
            <p className="text-muted-foreground">
              Kelola tanda tangan digital Anda untuk keperluan approval dokumen.
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right mr-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Kuota Tersisa</p>
              <p className="text-lg font-bold text-slate-900">{10 - signatures.length} / 10</p>
            </div>
            <label className="cursor-pointer">
              <Input 
                type="file" 
                accept="image/*" 
                className="hidden" 
                onChange={handleFileChange}
                disabled={signatures.length >= 10}
              />
              <div className={`inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 transition-colors ${signatures.length >= 10 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'}`}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah Tanda Tangan
              </div>
            </label>
          </div>
        </div>

        {/* List Section */}
        {isLoading ? (
          <div className="flex h-[400px] items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
          </div>
        ) : signatures.length === 0 ? (
          <Card className="border-dashed border-2 bg-slate-50/50">
            <CardContent className="flex flex-col items-center justify-center h-[300px] text-center space-y-4">
              <div className="p-4 bg-white rounded-full shadow-sm">
                <FileSignature className="h-12 w-12 text-slate-300" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-lg">Belum Ada Tanda Tangan</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">Anda belum mengunggah tanda tangan digital satu pun.{"\n"}Unggah tanda tangan pertama Anda untuk mulai memberikan approval.</p>
              </div>
              <Button variant="outline" className="mt-2" onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
                Klik untuk Mengunggah
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {signatures.map((sig) => (
              <Card key={sig.id} className={`overflow-hidden transition-all duration-300 ${sig.is_hidden ? 'opacity-60 grayscale' : 'hover:shadow-md border-blue-100'}`}>
                <div className="h-40 bg-white relative flex items-center justify-center p-6 border-b">
                   <img 
                    src={sig.image_url} 
                    alt={sig.label} 
                    className="max-h-full max-w-full object-contain"
                   />
                   {sig.is_hidden && (
                     <div className="absolute inset-0 bg-slate-50/80 flex items-center justify-center">
                        <Badge variant="secondary" className="gap-1"><EyeOff className="h-3 w-3" /> Tersembunyi</Badge>
                     </div>
                   )}
                </div>
                <CardHeader className="p-4 space-y-1">
                   <div className="flex items-center justify-between">
                     <CardTitle className="text-base truncate flex-1">{sig.label}</CardTitle>
                     <p className="text-[10px] text-slate-400 font-mono">ID: {sig.id.substring(0,8)}</p>
                   </div>
                   <CardDescription className="text-xs font-medium text-slate-900">
                     Nama: {sig.printed_name}
                   </CardDescription>
                </CardHeader>
                <CardFooter className="p-3 bg-slate-50 flex items-center justify-between border-t">
                   <div className="text-[10px] text-slate-400">
                     Dibuat: {new Date(sig.created_at).toLocaleDateString()}
                   </div>
                   <div className="flex items-center gap-2">
                     <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-slate-500"
                        onClick={() => handleToggleVisibility(sig)}
                     >
                       {sig.is_hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                     </Button>
                     {/* No Delete based on concept, only Admin can handle that if disaster struck */}
                   </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        {/* Warning Section */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-4">
          <AlertCircle className="h-6 w-6 text-amber-600 flex-shrink-0" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-amber-900">Penting: Integritas Data</h4>
            <p className="text-xs text-amber-800 leading-relaxed">
              Tanda tangan yang sudah tersimpan <strong>tidak dapat diubah gambarnya maupun nama yang tertera</strong>. Hal ini untuk menjaga legalitas dokumen yang pernah ditandatangani sebelumnya. Jika Anda ingin menggantinya, silakan sembunyikan tanda tangan lama dan buat yang baru.
            </p>
          </div>
        </div>
      </div>

      {/* Editor Modal */}
      <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
        <DialogContent className="max-w-2xl sm:max-h-[800px] p-0 overflow-hidden">
          <div className="p-6 pb-0">
            <DialogTitle>Sesuaikan Tanda Tangan</DialogTitle>
            <DialogDescription>
              Atur posisi dan ukuran tanda tangan Anda agar terlihat rapi pada dokumen.
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

      {/* Final Password Modal */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              Proteksi Keamanan
            </DialogTitle>
            <DialogDescription>
              Tanda tangan Anda akan disimpan secara permanen. Harap masukkan password berikut untuk melanjutkan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="label">Label Tanda Tangan (Contoh: "Tanda Tangan Utama")</Label>
              <Input 
                id="label" 
                placeholder="Misal: Tanda Tangan Utama" 
                value={label} 
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            
            <div className="p-3 bg-slate-50 rounded-lg border flex gap-3 items-center">
              <div className="h-8 w-8 bg-white border rounded flex items-center justify-center">
                <FileSignature className="h-4 w-4 text-slate-400" />
              </div>
              <div>
                <p className="text-xs text-slate-500 leading-none">Nama Tertera (Otomatis)</p>
                <p className="text-sm font-bold">{profileName}</p>
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
              *Password Signature digunakan untuk verifikasi setiap kali Anda menandatangani dokumen nantinya.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setIsPasswordModalOpen(false)} disabled={isSubmitting}>Batal</Button>
            <Button 
               className="bg-green-600 hover:bg-green-700 text-white" 
               onClick={handleSubmit}
               disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Verifikasi & Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Content>
  );
}

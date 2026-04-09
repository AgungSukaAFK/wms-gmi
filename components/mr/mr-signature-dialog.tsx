"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Plus,
  CheckCircle2,
  Trash2,
  Loader2,
  Image as ImageIcon,
  ChevronRight,
  Lock,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifySignaturePassword } from "@/services/signature-actions";

interface Signature {
  id: string;
  image_url: string;
  label: string;
}

interface MRSignatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (signature: Signature) => void;
}

export function MRSignatureDialog({
  open,
  onOpenChange,
  onConfirm,
}: MRSignatureDialogProps) {
  const supabase = createClient();
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const fetchSignatures = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("user_signatures")
      .select("id, image_url, label")
      .eq("user_id", user.id)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Signature fetch error:", error);
      toast.error("Gagal memuat tanda tangan");
    } else {
      setSignatures(data || []);
      if (data && data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      fetchSignatures();
      setPassword(""); // Reset password when opening
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!selectedId) {
      toast.error("Pilih tanda tangan terlebih dahulu");
      return;
    }

    if (!password) {
      toast.error("Masukkan password signature Anda");
      return;
    }

    setVerifying(true);
    try {
      const result = await verifySignaturePassword(selectedId, password);
      
      if (result.success) {
        const sig = signatures.find((s) => s.id === selectedId);
        if (sig) {
          onConfirm(sig);
          onOpenChange(false);
        }
      } else {
        toast.error(result.error || "Verifikasi gagal");
      }
    } catch (err: any) {
      toast.error("Terjadi kesalahan sistem saat verifikasi");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[450px] p-0 rounded-xl border-slate-200 shadow-2xl overflow-hidden">
        <DialogHeader className="p-5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
                <CheckCircle2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold tracking-tight">Konfirmasi Tanda Tangan</DialogTitle>
                <DialogDescription className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                  Sign & Submit Material Request
                </DialogDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-slate-400 hover:text-blue-600 rounded-md"
              onClick={fetchSignatures}
              disabled={loading || verifying}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-5 max-h-[500px] overflow-y-auto bg-white">
          <div className="space-y-3">
             <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Pilih Tanda Tangan</Label>
             {signatures.length > 0 ? (
               <div className="grid grid-cols-1 gap-3">
                 {signatures.map((sig) => (
                   <button
                     key={sig.id}
                     onClick={() => setSelectedId(sig.id)}
                     disabled={verifying}
                     className={`relative flex flex-col items-center p-3 rounded-xl border-2 transition-all group ${
                       selectedId === sig.id
                         ? "border-blue-600 bg-blue-50/50"
                         : "border-slate-100 hover:border-slate-200"
                     } ${verifying ? 'opacity-50 cursor-not-allowed' : ''}`}
                   >
                     <div className="w-full bg-white rounded-lg border border-slate-50 p-3 mb-2 shadow-sm flex items-center justify-center min-h-[90px]">
                       <img
                         src={sig.image_url}
                         alt={sig.label}
                         className="max-h-[70px] object-contain"
                       />
                     </div>
                     <span className={`text-[10px] font-bold uppercase tracking-wider ${
                       selectedId === sig.id ? "text-blue-600" : "text-slate-400"
                     }`}>
                       {sig.label}
                     </span>
                     
                     {selectedId === sig.id && (
                       <div className="absolute top-1.5 right-1.5 bg-blue-600 text-white rounded-full p-0.5 shadow-md">
                         <CheckCircle2 className="h-3 w-3" />
                       </div>
                     )}
                   </button>
                 ))}
               </div>
             ) : (
               <div className="h-40 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-100 mb-3">
                     <ImageIcon className="h-5 w-5 text-slate-200" />
                  </div>
                  <p className="text-sm font-semibold text-slate-500 mb-1">Belum ada tanda tangan</p>
                  <p className="text-[10px] text-slate-400 font-medium max-w-[220px]">
                    Anda perlu membuat tanda tangan di Signature Manager terlebih dahulu.
                  </p>
               </div>
             )}
          </div>

          {selectedId && (
            <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 flex items-center gap-1.5">
                <Lock className="h-3 w-3" /> Password Signature
              </Label>
              <Input 
                type="password"
                placeholder="Masukkan password khusus signature..."
                className="h-10 border-slate-200 bg-slate-50/50 focus:bg-white text-sm font-medium"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={verifying}
              />
              <p className="text-[9px] text-red-500 font-bold uppercase tracking-tighter flex items-center gap-1 mt-1 pl-1">
                <ShieldAlert className="h-3 w-3" /> 
                HATI-HATI: Akun dinonaktifkan jika salah 5 kali berturut-turut.
              </p>
            </div>
          )}

          <div className="pt-1">
            <Link href="/signatures" target="_blank">
               <Button variant="outline" className="w-full h-10 border-slate-200 text-slate-600 font-semibold text-xs rounded-lg gap-2 hover:bg-slate-50 transition-all border-dashed" disabled={verifying}>
                  <Plus className="h-3.5 w-3.5" /> Buka Signature Manager
               </Button>
            </Link>
          </div>
        </div>

        <DialogFooter className="p-5 bg-slate-50/50 border-t border-slate-100 gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="flex-1 h-10 text-slate-400 font-semibold text-sm hover:text-slate-600 rounded-lg order-2 sm:order-1"
            onClick={() => onOpenChange(false)}
            disabled={verifying}
          >
            Batal
          </Button>
          <Button
            className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 font-bold text-sm text-white rounded-lg shadow-md transition-all active:scale-95 order-1 sm:order-2"
            onClick={handleConfirm}
            disabled={!selectedId || verifying}
          >
            {verifying ? (
              <div className="flex items-center gap-2">
                 <Loader2 className="h-3.5 w-3.5 animate-spin" />
                 <span>Memverifikasi...</span>
              </div>
            ) : (
              "Verifikasi & Sign"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

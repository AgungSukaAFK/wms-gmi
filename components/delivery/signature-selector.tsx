"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  PenTool,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifySignaturePassword } from "@/services/signature-actions";
import Link from "next/link";
import { toast } from "sonner";

interface SignatureSelectorProps {
  value: string;
  onChange: (signatureId: string) => void;
}

export function SignatureSelector({ value, onChange }: SignatureSelectorProps) {
  const supabase = createClient();
  const [signatures, setSignatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetchSignatures();
  }, []);

  useEffect(() => {
    if (open) {
      setSelectedId(value || signatures[0]?.id || null);
      setPassword("");
    }
  }, [open, value, signatures]);

  const fetchSignatures = async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("user_signatures")
        .select("id, label, printed_name, image_url")
        .eq("user_id", user.id)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false });

      setSignatures(data || []);
    } catch (err) {
      console.error("Fetch signatures error:", err);
    } finally {
      setLoading(false);
    }
  };

  const selectedSignature = signatures.find((s) => s.id === value);

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
    const result = await verifySignaturePassword(selectedId, password);
    setVerifying(false);

    if (!result.success) {
      toast.error(result.error || "Verifikasi gagal");
      return;
    }

    onChange(selectedId);
    setOpen(false);
    setPassword("");
    toast.success("Tanda tangan terverifikasi");
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-10 w-full text-left justify-start font-bold text-sm border-input bg-muted/40 rounded-lg flex items-center gap-2"
      >
        <PenTool className="h-4 w-4 text-muted-foreground" />
        {selectedSignature ? selectedSignature.label : "Pilih Tanda Tangan..."}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-112.5 p-0 rounded-xl border-slate-200 shadow-2xl overflow-hidden">
          <DialogHeader className="p-5 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
                  <CheckCircle2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold tracking-tight">
                    Konfirmasi Tanda Tangan
                  </DialogTitle>
                  <DialogDescription className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                    Sign & Submit Delivery
                  </DialogDescription>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-slate-400 hover:text-blue-600 rounded-md"
                onClick={fetchSignatures}
                disabled={loading || verifying}
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                />
              </Button>
            </div>
          </DialogHeader>

          <div className="p-5 space-y-5 max-h-125 overflow-y-auto bg-white">
            <div className="space-y-3">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">
                Pilih Tanda Tangan
              </Label>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : signatures.length === 0 ? (
                <div className="h-30 flex items-center justify-center text-center p-4 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  <p className="text-xs font-bold text-muted-foreground">
                    Belum ada tanda tangan. Buat dulu di Signature Manager.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {signatures.map((sig) => (
                    <button
                      key={sig.id}
                      type="button"
                      onClick={() => setSelectedId(sig.id)}
                      disabled={verifying}
                      className={cn(
                        "relative flex flex-col items-center p-3 rounded-xl border-2 transition-all",
                        selectedId === sig.id
                          ? "border-blue-600 bg-blue-50/50"
                          : "border-slate-100 hover:border-slate-200",
                        verifying && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      <div className="w-full bg-white rounded-lg border border-slate-50 p-3 mb-2 shadow-sm flex items-center justify-center min-h-22.5">
                        <img
                          src={sig.image_url}
                          alt={sig.label}
                          className="max-h-17.5 object-contain"
                        />
                      </div>
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider",
                          selectedId === sig.id
                            ? "text-blue-600"
                            : "text-slate-400",
                        )}
                      >
                        {sig.label}
                      </span>
                      {selectedId === sig.id && (
                        <div className="absolute top-1.5 right-1.5 bg-blue-600 text-white rounded-full p-0.5 shadow-md">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 pt-1">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 flex items-center gap-1.5">
                <Lock className="h-3 w-3" /> Password Signature
              </Label>
              <Input
                type="password"
                placeholder="Masukkan password signature..."
                className="h-10 border-slate-200 bg-slate-50/50 focus:bg-white text-sm font-medium"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={verifying || signatures.length === 0}
              />
            </div>

            <Link href="/signatures" target="_blank">
              <Button
                type="button"
                variant="outline"
                className="w-full h-10 border-slate-200 text-slate-600 font-semibold text-xs rounded-lg hover:bg-slate-50"
                disabled={verifying}
              >
                Buka Signature Manager
              </Button>
            </Link>
          </div>

          <DialogFooter className="p-5 bg-slate-50/50 border-t border-slate-100 gap-2 sm:flex-row">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 h-10 text-slate-400 font-semibold text-sm hover:text-slate-600 rounded-lg"
              onClick={() => setOpen(false)}
              disabled={verifying}
            >
              Batal
            </Button>
            <Button
              type="button"
              className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 font-bold text-sm text-white rounded-lg shadow-md"
              onClick={handleConfirm}
              disabled={!selectedId || verifying || signatures.length === 0}
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
    </>
  );
}

"use client";

// Editor jalur approval bebas untuk fitur "Moderator Edit". Dipakai di halaman
// detail MR (dan nantinya PR/PO/SPB) supaya moderator bisa mengubah approver,
// role (menyetujui/mengetahui), urutan, dan status tiap tahap secara langsung.
// Status akhir dokumen (open/approved/rejected) diturunkan otomatis dari array
// ini oleh server action — komponen ini murni edit state di client.

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebounce } from "use-debounce";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Search,
  Loader2,
  ChevronsUpDown,
} from "lucide-react";
import type { ModeratorApprovalStep } from "@/services/moderator-edit-actions";

interface ApprovalFlowEditorProps {
  steps: ModeratorApprovalStep[];
  onChange: (steps: ModeratorApprovalStep[]) => void;
}

export function ApprovalFlowEditor({ steps, onChange }: ApprovalFlowEditorProps) {
  const supabase = createClient();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (activeIndex === null) return;
    const run = async () => {
      setSearching(true);
      let query = supabase
        .from("profiles")
        .select("id, nama, email")
        .order("nama")
        .limit(10);
      if (debouncedSearch) {
        query = query.or(`nama.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%`);
      }
      const { data } = await query;
      setProfiles(data || []);
      setSearching(false);
    };
    run();
  }, [debouncedSearch, activeIndex]);

  const updateStep = (index: number, patch: Partial<ModeratorApprovalStep>) => {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === steps.length - 1) return;
    const target = direction === "up" ? index - 1 : index + 1;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addStep = () => {
    onChange([
      ...steps,
      {
        userid: "",
        nama: "",
        email: "",
        approval_role: "menyetujui",
        status: "pending",
        processed_at: null,
        signature_url: null,
        notes: null,
      },
    ]);
    setActiveIndex(steps.length);
  };

  const getStatusBadgeClass = (status: string) => {
    if (status === "approved") return "bg-success/10 text-success border-success/30";
    if (status === "rejected") return "bg-destructive/10 text-destructive border-destructive/30";
    return "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-2.5">
      {steps.map((step, index) => (
        <div
          key={index}
          className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5"
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground"
                onClick={() => moveStep(index, "up")}
                disabled={index === 0}
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <span className="text-[10px] font-black text-muted-foreground">
                {index + 1}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground"
                onClick={() => moveStep(index, "down")}
                disabled={index === steps.length - 1}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>

            <Popover
              open={activeIndex === index}
              onOpenChange={(open) => {
                setActiveIndex(open ? index : null);
                setSearch("");
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 flex-1 min-w-0 justify-between bg-background text-[12px] font-bold"
                >
                  <span className="truncate">{step.nama || "Pilih approver..."}</span>
                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-40" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="start">
                <div className="p-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      autoFocus
                      placeholder="Cari user (nama/email)..."
                      className="pl-8 h-9 text-sm"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto p-1">
                  {searching ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : profiles.length === 0 ? (
                    <p className="text-center text-[11px] text-muted-foreground py-4 italic">
                      User tidak ditemukan.
                    </p>
                  ) : (
                    profiles.map((p) => (
                      <button
                        key={p.id}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-muted/60 rounded-md"
                        onClick={() => {
                          updateStep(index, {
                            userid: p.id,
                            nama: p.nama,
                            email: p.email,
                          });
                          setActiveIndex(null);
                        }}
                      >
                        <p className="text-xs font-bold text-foreground">{p.nama}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{p.email}</p>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => removeStep(index)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-9">
            <Select
              value={step.approval_role}
              onValueChange={(val: any) => updateStep(index, { approval_role: val })}
            >
              <SelectTrigger className="h-8 w-36 text-[11px] font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="menyetujui">Menyetujui</SelectItem>
                <SelectItem value="mengetahui">Mengetahui</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={step.status}
              onValueChange={(val: any) => updateStep(index, { status: val })}
            >
              <SelectTrigger className={`h-8 w-32 text-[11px] font-bold ${getStatusBadgeClass(step.status)}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            {step.signature_url && (
              <Badge variant="outline" className="h-6 px-2 text-[9px] text-success border-success/30 bg-success/10 font-black uppercase">
                Ada TTD
              </Badge>
            )}
          </div>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50 font-semibold"
        onClick={addStep}
      >
        <Plus className="h-4 w-4" /> Tambah Tahap Approval
      </Button>
    </div>
  );
}

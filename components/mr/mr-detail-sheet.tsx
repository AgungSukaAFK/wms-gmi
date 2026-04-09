"use client";

import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  Package, 
  CheckCircle2, 
  Circle, 
  Clock, 
  MapPin, 
  AlertTriangle, 
  MessageSquare,
  Printer,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface MRDetailSheetProps {
  mrId: string | number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MRDetailSheet({ mrId, open, onOpenChange }: MRDetailSheetProps) {
  const supabase = createClient();
  const [mr, setMr] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && mrId) {
      fetchDetails();
    }
  }, [open, mrId]);

  const fetchDetails = async () => {
    setLoading(true);
    // Fetch MR primary data
    const { data: mrData } = await supabase
      .from("mrs")
      .select("*, cabang(nama_cabang)")
      .eq("id", mrId)
      .single();
    
    setMr(mrData);

    // Fetch MR Items
    const { data: itemsData } = await supabase
      .from("mr_items")
      .select("*")
      .eq("mr_id", mrId)
      .order("created_at");
    
    setItems(itemsData || []);
    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open":
        return <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-100 font-semibold text-[10px] uppercase">Open</Badge>;
      case "approved":
        return <Badge className="bg-green-600 text-white font-semibold text-[10px] uppercase">Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="font-semibold text-[10px] uppercase">Rejected</Badge>;
      case "done":
        return <Badge className="bg-slate-900 text-white font-semibold text-[10px] uppercase">Done</Badge>;
      case "closed":
        return <Badge variant="secondary" className="font-semibold text-[10px] uppercase">Closed</Badge>;
      default:
        return <Badge variant="outline" className="font-semibold text-[10px] uppercase">{status}</Badge>;
    }
  };

  const getPriorityBadge = (p: string) => {
    switch (p) {
      case "P1": return <Badge className="bg-red-600 text-white text-[10px] font-bold px-2 h-5 shrink-0">P1 - EMERGENCY</Badge>;
      case "P2": return <Badge className="bg-orange-500 text-white text-[10px] font-bold px-2 h-5 shrink-0">P2 - HIGH</Badge>;
      case "P3": return <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 text-[10px] font-bold px-2 h-5 shrink-0">P3 - NORMAL</Badge>;
      case "P4": return <Badge variant="outline" className="text-slate-400 border-slate-200 bg-slate-50 text-[10px] font-bold px-2 h-5 shrink-0">P4 - LOW</Badge>;
      default: return null;
    }
  };

  const handlePrint = () => {
    if (mrId) {
      window.open(`/mr/print/${mrId}`, "_blank");
    }
  };

  const nextApprover = mr?.mr_status === 'open' ? mr?.approvals?.find((a: any) => a.status === 'pending') : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[400px] p-0 flex flex-col gap-0 border-l border-slate-200 overflow-hidden text-slate-900 shadow-2xl">
        {loading && !mr ? (
           <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
           </div>
        ) : (
          <>
            <SheetHeader className="p-6 bg-slate-50 border-b border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400">
                   <Package className="h-4 w-4" />
                   <span className="text-[10px] font-bold uppercase tracking-tight">Material Request Detail</span>
                </div>
                <div className="flex items-center gap-2 overflow-hidden">
                   {mr && getPriorityBadge(mr.mr_priority)}
                   {mr && getStatusBadge(mr.mr_status)}
                </div>
              </div>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 overflow-hidden">
                <div className="max-w-full overflow-hidden">
                  <SheetTitle className="text-2xl font-bold text-slate-900 tracking-tight truncate">
                    {mr?.mr_kode}
                  </SheetTitle>
                  <SheetDescription className="text-xs font-medium text-slate-500 mt-1 flex items-center gap-1 overflow-hidden">
                    Oleh <span className="text-slate-900 font-bold truncate max-w-[100px]">{mr?.mr_pic}</span> 
                    <span className="mx-0.5 text-slate-300 shrink-0">•</span>
                    <MapPin className="h-3 w-3 text-red-500 shrink-0" />
                    <span className="text-slate-900 font-bold uppercase truncate">{mr?.cabang?.nama_cabang}</span>
                  </SheetDescription>
                </div>

                {nextApprover && (
                  <div className="bg-orange-50 border border-orange-100 p-2 rounded-md flex items-center gap-2 px-3 shadow-sm self-start md:self-auto max-w-full overflow-hidden shrink-0">
                     <Clock className="h-3.5 w-3.5 text-orange-500 animate-pulse shrink-0" />
                     <div className="flex flex-col overflow-hidden">
                        <span className="text-[8px] font-bold text-orange-400 uppercase leading-none">Menunggu:</span>
                        <span className="text-[11px] font-bold text-orange-700 uppercase truncate">
                          {nextApprover.nama}
                        </span>
                     </div>
                  </div>
                )}
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-20 bg-white">
              {/* Section: Priority & Remarks Info */}
              {mr?.mr_remarks && (
                <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-3 space-y-2 overflow-hidden break-words">
                   <div className="flex items-center gap-2">
                      <MessageSquare className="h-3 w-3 text-amber-600 shrink-0" />
                      <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Keterangan / Remarks</span>
                   </div>
                   <p className="text-[11px] text-slate-700 leading-relaxed font-medium whitespace-pre-wrap">
                      {mr.mr_remarks}
                   </p>
                </div>
              )}

              {/* Section: Items */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                   <div className="h-4 w-1 bg-blue-600 rounded-full shrink-0" />
                   <h3 className="text-[11px] font-bold text-slate-900 uppercase">Daftar Barang</h3>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm bg-white">
                   <Table>
                      <TableHeader className="bg-slate-50">
                         <TableRow className="hover:bg-transparent h-9 border-b border-slate-200">
                            <TableHead className="text-[9px] font-bold uppercase text-slate-500 pl-4">Part Number</TableHead>
                            <TableHead className="text-[9px] font-bold uppercase text-slate-500">Nama Barang</TableHead>
                            <TableHead className="text-[9px] font-bold uppercase text-slate-500 text-right pr-4">Qty</TableHead>
                         </TableRow>
                      </TableHeader>
                      <TableBody>
                         {items.length === 0 ? (
                           <TableRow>
                              <TableCell colSpan={3} className="h-20 text-center text-slate-400 text-[11px] italic">Belum ada barang</TableCell>
                           </TableRow>
                         ) : (
                            items.map((item) => (
                               <TableRow key={item.id} className="h-10 hover:bg-slate-50/50 border-b border-slate-100 last:border-0">
                                  <TableCell className="text-[11px] font-mono font-bold text-slate-500 uppercase pl-4 shrink-0">{item.part_number}</TableCell>
                                  <TableCell className="text-[11px] font-semibold text-slate-800 uppercase truncate max-w-[120px]">{item.part_name}</TableCell>
                                  <TableCell className="text-[11px] font-bold text-slate-900 text-right pr-4 shrink-0">
                                     {item.qty_request} <span className="text-slate-400 font-medium ml-0.5">{item.satuan}</span>
                                  </TableCell>
                               </TableRow>
                            ))
                         )}
                      </TableBody>
                   </Table>
                </div>
              </div>

              {/* Section: Approval Progress */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                   <div className="h-4 w-1 bg-green-600 rounded-full shrink-0" />
                   <h3 className="text-[11px] font-bold text-slate-900 uppercase">Proses Approval</h3>
                </div>
                <div className="space-y-6 pl-4 border-l-2 border-slate-100 ml-3">
                   {mr?.approvals?.sort((a: any, b: any) => a.step_order - b.step_order).map((approval: any, idx: number) => {
                     const isApproved = approval.status === 'approved';
                     
                     return (
                       <div key={idx} className={`relative ${!isApproved ? 'opacity-60' : ''} overflow-hidden`}>
                          <div className={`absolute -left-[27px] top-0 h-6 w-6 bg-white flex items-center justify-center rounded-full border-2 shadow-sm ${
                            isApproved ? 'border-green-600' : 'border-slate-200'
                          } shrink-0`}>
                             {isApproved ? (
                               <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                             ) : (
                               <Circle className="h-3.5 w-3.5 text-slate-300" />
                             )}
                          </div>
                          <div className="flex flex-col gap-0.5 max-w-full overflow-hidden">
                             <div className="flex items-center gap-2 text-slate-900 overflow-hidden">
                                <span className="text-xs font-bold truncate">{approval.nama}</span>
                                {isApproved ? (
                                  <Badge className="h-3.5 px-1.5 text-[8px] bg-green-100 text-green-700 border-none font-bold uppercase shrink-0">Approved</Badge>
                                ) : (
                                  <Badge variant="outline" className="h-3.5 px-1.5 text-[8px] text-slate-400 border-slate-200 bg-slate-50 font-bold uppercase shrink-0">Pending</Badge>
                                )}
                             </div>
                             <p className="text-[10px] text-slate-500 font-medium uppercase tracking-tighter truncate">{approval.role || 'Checker'}</p>
                             
                             {isApproved ? (
                               <div className="flex items-center gap-1.5 mt-1 text-slate-400 overflow-hidden">
                                  <Clock className="h-3 w-3 shrink-0" />
                                  <span className="text-[10px] font-semibold truncate">{new Date(approval.processed_at).toLocaleString("id-ID", { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                  {approval.signature_url && (
                                    <>
                                      <span className="mx-1 text-slate-200">|</span>
                                      <Badge variant="outline" className="text-[8px] h-3.5 px-1 text-blue-500 border-blue-100 bg-blue-50 cursor-default shrink-0">Signed</Badge>
                                    </>
                                  )}
                               </div>
                             ) : (
                               <div className="flex items-center gap-1.5 mt-1 text-slate-300">
                                  <Clock className="h-3 w-3 shrink-0" />
                                  <span className="text-[10px] font-medium italic">Menunggu giliran...</span>
                               </div>
                             )}
                          </div>
                       </div>
                     );
                   })}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50/80 grid grid-cols-2 gap-3 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] mt-auto">
               <Button 
                variant="outline"
                className="h-10 border-slate-200 text-slate-600 font-bold text-xs uppercase rounded-lg hover:bg-white hover:text-slate-900 transition-all flex items-center justify-center gap-2"
                onClick={() => onOpenChange(false)}
               >
                 <X className="h-3.5 w-3.5" /> Close
               </Button>
               
               {mr?.mr_status === 'approved' ? (
                 <Button 
                    className="h-10 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
                    onClick={handlePrint}
                 >
                   <Printer className="h-3.5 w-3.5" /> Cetak MR
                 </Button>
               ) : (
                 <Button 
                    variant="ghost" 
                    className="h-10 text-slate-400 font-bold text-xs uppercase cursor-not-allowed italic"
                    disabled
                 >
                   Approval Belum Lengkap
                 </Button>
               )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

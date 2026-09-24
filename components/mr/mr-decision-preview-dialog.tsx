"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileCheck2, PenTool } from "lucide-react";
import { formatDateDocument } from "@/lib/utils";

interface AllocationSharestock {
  source_cabang_id: number | string;
  qty: number | string;
  deadline?: string;
}

interface Allocation {
  mr_item_id: number;
  part_id?: number;
  part_number: string;
  part_name: string;
  qty_request: number;
  qty_pr: number;
  qty_sharestock_total: number;
  sharestocks: AllocationSharestock[];
  deadline?: string;
}

interface Cabang {
  id: number | string;
  nama_cabang: string;
}

interface MrDecisionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mr: any;
  items: any[];
  allocations: Allocation[];
  cabangs: Cabang[];
  approverName?: string | null;
  onConfirm: () => void;
}

export function MrDecisionPreviewDialog({
  open,
  onOpenChange,
  mr,
  items,
  allocations,
  cabangs,
  approverName,
  onConfirm,
}: MrDecisionPreviewDialogProps) {
  const satuanByItemId = new Map(
    (items || []).map((i: any) => [i.id, i.satuan]),
  );
  const cabangNameById = new Map(
    (cabangs || []).map((c) => [String(c.id), c.nama_cabang]),
  );

  const hasShareStock = allocations.some(
    (a) => Number(a.qty_sharestock_total) > 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 rounded-xl overflow-hidden">
        <DialogHeader className="p-5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg shrink-0">
              <FileCheck2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold tracking-tight">
                Preview Dokumen Keputusan
              </DialogTitle>
              <DialogDescription className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                Periksa alokasi sebelum melanjutkan ke tanda tangan
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto bg-slate-100 p-4 sm:p-6">
          <div className="mr-decision-preview-sheet bg-white mx-auto max-w-[190mm] p-8 font-serif shadow-sm relative">
            <div className="absolute top-6 right-8 text-[9px] font-black uppercase tracking-[0.2em] text-amber-600 border border-amber-300 bg-amber-50 px-2 py-1 rounded">
              Preview — Belum Diajukan
            </div>

            {/* Header */}
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-5 mb-6">
              <div className="space-y-1">
                <h1 className="text-2xl font-black tracking-tighter text-slate-900">
                  WMS-GMI
                </h1>
                <p className="text-[9px] uppercase font-bold text-slate-500 tracking-widest">
                  Warehouse Management System
                </p>
              </div>
              <div className="text-right">
                <h2 className="text-base font-bold text-slate-900 uppercase">
                  Dokumen Keputusan Material Request
                </h2>
                <p className="text-xs font-medium text-slate-500">
                  No. Dokumen:{" "}
                  <span className="font-bold text-slate-900">
                    {mr?.mr_kode}
                  </span>
                </p>
              </div>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-x-10 gap-y-4 mb-8 text-xs">
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Pemohon
                </span>
                <span className="font-bold text-slate-900">
                  : {mr?.mr_pic}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Tgl. Diperlukan
                </span>
                <span className="font-bold text-slate-900">
                  : {formatDateDocument(mr?.mr_due_date)}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Lokasi Site
                </span>
                <span className="font-bold text-slate-900">
                  : {mr?.cabang?.nama_cabang}
                </span>
              </div>
              <div className="flex border-b border-slate-100 pb-1.5">
                <span className="w-28 text-slate-500 font-bold uppercase text-[9px]">
                  Akan Ditandatangani
                </span>
                <span className="font-bold text-slate-900">
                  : {approverName || "-"}
                </span>
              </div>
            </div>

            {/* Items table */}
            <div className="mb-8">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-900 mb-2">
                Rencana Alokasi per Item
              </h3>
              <table className="w-full border-collapse border border-slate-900 text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold uppercase text-[9px]">
                    <th className="border border-slate-900 p-2 text-center w-10">
                      No
                    </th>
                    <th className="border border-slate-900 p-2 text-left">
                      Deskripsi Barang / Part Number
                    </th>
                    <th className="border border-slate-900 p-2 text-right w-24">
                      Qty Request
                    </th>
                    <th className="border border-slate-900 p-2 text-right w-24">
                      Rencana PR
                    </th>
                    <th className="border border-slate-900 p-2 text-right w-28">
                      Rencana Share Stock
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((alloc, index) => (
                    <tr key={alloc.mr_item_id} className="border-b border-slate-200">
                      <td className="border border-slate-900 p-2 text-center">
                        {index + 1}
                      </td>
                      <td className="border border-slate-900 p-2">
                        <div className="font-bold">{alloc.part_name}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {alloc.part_number}
                        </div>
                      </td>
                      <td className="border border-slate-900 p-2 text-right font-bold">
                        {alloc.qty_request}{" "}
                        {satuanByItemId.get(alloc.mr_item_id) || ""}
                      </td>
                      <td className="border border-slate-900 p-2 text-right font-bold text-primary">
                        {alloc.qty_pr}
                      </td>
                      <td className="border border-slate-900 p-2 text-right font-bold text-success">
                        {alloc.qty_sharestock_total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Share stock detail */}
            {hasShareStock && (
              <div className="mb-4">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-900 mb-1">
                  Rincian Share Stock (Barang dalam Pengiriman)
                </h3>
                <p className="text-[9px] text-slate-500 font-medium mb-3">
                  Gudang sumber wajib mengirim sebelum tanggal deadline yang
                  ditentukan di bawah.
                </p>
                <table className="w-full border-collapse border border-slate-900 text-xs">
                  <thead>
                    <tr className="bg-slate-700 text-white font-bold uppercase text-[9px]">
                      <th className="border border-slate-900 p-2 text-left">
                        Item
                      </th>
                      <th className="border border-slate-900 p-2 text-left">
                        Gudang Sumber
                      </th>
                      <th className="border border-slate-900 p-2 text-right w-24">
                        Qty
                      </th>
                      <th className="border border-slate-900 p-2 text-center w-32">
                        Deadline
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations
                      .filter((a) => Number(a.qty_sharestock_total) > 0)
                      .flatMap((alloc) =>
                        (alloc.sharestocks.length > 0
                          ? alloc.sharestocks
                          : [null]
                        ).map((ss, i) => (
                          <tr key={`${alloc.mr_item_id}-${i}`}>
                            <td className="border border-slate-900 p-2 align-top">
                              <div className="font-bold">
                                {alloc.part_name}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {alloc.part_number}
                              </div>
                            </td>
                            {ss ? (
                              <>
                                <td className="border border-slate-900 p-2 font-medium uppercase">
                                  {cabangNameById.get(
                                    String(ss.source_cabang_id),
                                  ) || "-"}
                                </td>
                                <td className="border border-slate-900 p-2 text-right font-bold">
                                  {ss.qty} {satuanByItemId.get(alloc.mr_item_id) || ""}
                                </td>
                                <td className="border border-slate-900 p-2 text-center font-bold">
                                  {alloc.deadline
                                    ? formatDateDocument(alloc.deadline)
                                    : "-"}
                                </td>
                              </>
                            ) : (
                              <td
                                className="border border-slate-900 p-2 text-slate-400 italic"
                                colSpan={3}
                              >
                                Belum ada alokasi gudang sumber.
                              </td>
                            )}
                          </tr>
                        )),
                      )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-5 bg-slate-50/50 border-t border-slate-100 gap-2 sm:flex-row">
          <Button
            variant="ghost"
            className="flex-1 h-10 text-slate-400 font-semibold text-sm hover:text-slate-600 rounded-lg order-2 sm:order-1"
            onClick={() => onOpenChange(false)}
          >
            Kembali & Edit Alokasi
          </Button>
          <Button
            className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 font-bold text-sm text-white rounded-lg shadow-md transition-all active:scale-95 order-1 sm:order-2 gap-2"
            onClick={onConfirm}
          >
            <PenTool className="h-3.5 w-3.5" /> Lanjut ke Tanda Tangan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

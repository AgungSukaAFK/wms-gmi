// app/(With Sidebar)/approval-templates/page.tsx

"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Search,
  PlusCircle,
  FileText,
  Settings2,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ApprovalTemplate, ApprovalType } from "@/type";
import { TemplateEditor } from "@/components/approval/template-editor";
import { Content } from "@/components/content";

import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useDebounce } from "use-debounce";

export default function ApprovalTemplatesPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ApprovalTemplate[]>([]);
  const [cabang, setCabang] = useState<any[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);

  // Editor State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ApprovalTemplate | null>(null);

  // Pagination & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch] = useDebounce(searchQuery, 500);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [cabangFilter, setCabangFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalCount, setTotalCount] = useState(0);

  const fetchData = async () => {
    setLoading(true);

    // 1. Get current user profile (cached or once)
    if (!userProfile) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*, roles:user_roles(roles(name))")
          .eq("id", user.id)
          .single();

        if (profile) {
          const processedProfile = {
            ...profile,
            isModerator: (profile.roles as any[]).some(r => r.roles.name === "moderator"),
            isAdmin: (profile.roles as any[]).some(r => r.roles.name === "admin"),
          };
          setUserProfile(processedProfile);

          if (processedProfile.isAdmin && !processedProfile.isModerator) {
            setCabangFilter(processedProfile.cabang_id.toString());
          }
        }
      }
    }

    // 2. Fetch Cabang list once
    if (cabang.length === 0) {
      const { data: cabangData } = await supabase
        .from("cabang")
        .select("*")
        .order("nama_cabang");
      setCabang(cabangData || []);
    }

    // 3. Fetch Templates with Pagination & Filters
    let query = supabase
      .from("approval_templates")
      .select("*, cabang(nama_cabang)", { count: "exact" });

    if (debouncedSearch) {
      query = query.ilike("name", `%${debouncedSearch}%`);
    }

    if (typeFilter !== "all") {
      query = query.eq("type", typeFilter);
    }

    if (cabangFilter !== "all") {
      if (cabangFilter === "global") {
        query = query.is("cabang_id", null);
      } else {
        query = query.eq("cabang_id", parseInt(cabangFilter));
      }
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("Error fetching templates:", error);
    } else {
      setTemplates(data || []);
      setTotalCount(count || 0);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [debouncedSearch, typeFilter, cabangFilter, page, limit]);

  const handleAddTemplate = () => {
    setSelectedTemplate(null);
    setIsEditorOpen(true);
  };

  const handleEditTemplate = (template: ApprovalTemplate) => {
    setSelectedTemplate(template);
    setIsEditorOpen(true);
  };

  return (
    <Content>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Approval Templates</h1>
            <p className="text-muted-foreground">
              Manajemen workflow approval untuk berbagai jenis dokumen dan lokasi.
            </p>
          </div>
          <Button
            className="shrink-0 gap-2 bg-blue-600 hover:bg-blue-700 font-bold"
            onClick={handleAddTemplate}
          >
            <Plus className="h-4 w-4" /> Tambah Template
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari nama template..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex gap-2">
            <Select value={typeFilter} onValueChange={(val) => { setTypeFilter(val); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Jenis Dokumen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Jenis</SelectItem>
                <SelectItem value="Material Request">Material Request</SelectItem>
                <SelectItem value="Purchase Request">Purchase Request</SelectItem>
                <SelectItem value="Purchase Order">Purchase Order</SelectItem>
                <SelectItem value="Item Transfer">Item Transfer</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={cabangFilter}
              onValueChange={(val) => { setCabangFilter(val); setPage(1); }}
              disabled={userProfile?.isAdmin && !userProfile?.isModerator}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Lokasi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Lokasi: Semua</SelectItem>
                <SelectItem value="global" className="font-bold text-blue-600">Global (Semua Lokasi)</SelectItem>
                {cabang.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-xl border bg-white shadow-sm overflow-hidden flex flex-col">
          <div className="flex-1">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead className="w-[50px] text-center">No</TableHead>
                  <TableHead className="w-[200px]">Nama Template</TableHead>
                  <TableHead>Jenis Dokumen</TableHead>
                  <TableHead>Lokasi</TableHead>
                  <TableHead className="w-[150px]">Pembaruan Terakhir</TableHead>
                  <TableHead className="text-right w-[100px]">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Sedang memuat data...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      Tidak ada template yang ditemukan.
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((template, index) => (
                    <TableRow key={template.id} className="hover:bg-slate-50 transition-colors">
                      <TableCell className="text-center text-muted-foreground text-xs font-medium">
                        {(page - 1) * limit + index + 1}
                      </TableCell>
                      <TableCell>
                        <span className="font-bold text-slate-900">{template.name}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-blue-500" />
                          <span className="font-medium text-slate-600 font-mono text-xs">{template.type}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {template.cabang_id ? (
                          <Badge variant="outline" className="font-normal border-slate-200 text-slate-600">
                            {template.cabang?.nama_cabang || "Unknown"}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="font-bold bg-blue-50 text-blue-600 border-blue-100">
                            Semua Lokasi (Global)
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(template.updated_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-blue-50 hover:text-blue-600"
                          onClick={() => handleEditTemplate(template)}
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="p-4 border-t bg-slate-50/30">
            <DataTablePagination
              totalCount={totalCount}
              pageSize={limit}
              currentPage={page}
              onPageChange={setPage}
              onPageSizeChange={(val) => { setLimit(parseInt(val)); setPage(1); }}
              itemLabel="Template"
            />
          </div>
        </div>

        <TemplateEditor
          open={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          template={selectedTemplate}
          cabang={cabang}
          userProfile={userProfile}
          onSuccess={fetchData}
        />
      </div>
    </Content>
  );
}

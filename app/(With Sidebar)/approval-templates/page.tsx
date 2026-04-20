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
import { Plus, Search, FileText, Settings2, Loader2 } from "lucide-react";
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
  const [selectedTemplate, setSelectedTemplate] =
    useState<ApprovalTemplate | null>(null);

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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*, roles:user_roles(roles(name))")
          .eq("id", user.id)
          .single();

        if (profile) {
          const processedProfile = {
            ...profile,
            isModerator: (profile.roles as any[]).some(
              (r) => r.roles.name === "moderator",
            ),
            isAdmin: (profile.roles as any[]).some(
              (r) => r.roles.name === "admin",
            ),
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
    <>
      <Content>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded bg-primary text-primary-foreground shadow-sm flex items-center justify-center">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">
                APPROVAL TEMPLATES
              </h1>
              <p className="text-[10px] text-muted-foreground font-bold uppercase mt-1">
                Workflow approval lintas dokumen dan lokasi
              </p>
            </div>
          </div>
          <Button
            className="shrink-0 gap-2 font-bold text-xs shadow-sm rounded-md px-4 h-9 uppercase"
            onClick={handleAddTemplate}
          >
            <Plus className="h-4 w-4" /> Tambah Template
          </Button>
        </div>
      </Content>

      <Content>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-70">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Cari nama template..."
              className="pl-9 h-9 border-input bg-muted/40 focus:bg-background transition-all rounded-md text-xs font-medium text-foreground"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <Select
              value={typeFilter}
              onValueChange={(val) => {
                setTypeFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-45 border-input bg-background text-xs font-semibold text-foreground">
                <SelectValue placeholder="Jenis Dokumen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Jenis</SelectItem>
                <SelectItem value="Material Request">
                  Material Request
                </SelectItem>
                <SelectItem value="Purchase Request">
                  Purchase Request
                </SelectItem>
                <SelectItem value="Purchase Order">Purchase Order</SelectItem>
                <SelectItem value="Item Transfer">Item Transfer</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={cabangFilter}
              onValueChange={(val) => {
                setCabangFilter(val);
                setPage(1);
              }}
              disabled={userProfile?.isAdmin && !userProfile?.isModerator}
            >
              <SelectTrigger className="h-9 w-full sm:w-45 border-input bg-background text-xs font-semibold text-foreground">
                <SelectValue placeholder="Lokasi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Lokasi: Semua</SelectItem>
                <SelectItem value="global" className="font-bold text-primary">
                  Global (Semua Lokasi)
                </SelectItem>
                {cabang.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.nama_cabang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Content>

      <Content className="overflow-hidden">
        <div className="flex-1 overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="w-12.5 text-center text-[10px] font-black uppercase text-muted-foreground">
                  No
                </TableHead>
                <TableHead className="w-50 text-[10px] font-black uppercase text-muted-foreground">
                  Nama Template
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Jenis Dokumen
                </TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">
                  Lokasi
                </TableHead>
                <TableHead className="w-37.5 text-[10px] font-black uppercase text-muted-foreground">
                  Pembaruan Terakhir
                </TableHead>
                <TableHead className="text-right w-25 text-[10px] font-black uppercase text-muted-foreground">
                  Aksi
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Sedang memuat
                      data...
                    </div>
                  </TableCell>
                </TableRow>
              ) : templates.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Tidak ada template yang ditemukan.
                  </TableCell>
                </TableRow>
              ) : (
                templates.map((template, index) => (
                  <TableRow
                    key={template.id}
                    className="hover:bg-muted/30 transition-colors border-b border-border/50"
                  >
                    <TableCell className="text-center text-muted-foreground text-xs font-medium">
                      {(page - 1) * limit + index + 1}
                    </TableCell>
                    <TableCell>
                      <span className="font-bold text-foreground">
                        {template.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        <span className="font-medium text-muted-foreground font-mono text-xs">
                          {template.type}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {template.cabang_id ? (
                        <Badge
                          variant="outline"
                          className="font-normal border-border text-muted-foreground bg-background"
                        >
                          {template.cabang?.nama_cabang || "Unknown"}
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="font-bold bg-primary/10 text-primary border-none"
                        >
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
                        className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
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

        <div className="p-4 border-t border-border bg-muted/30">
          <DataTablePagination
            totalCount={totalCount}
            pageSize={limit}
            currentPage={page}
            onPageChange={setPage}
            onPageSizeChange={(val) => {
              setLimit(parseInt(val));
              setPage(1);
            }}
            itemLabel="Template"
          />
        </div>
      </Content>

      <TemplateEditor
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        template={selectedTemplate}
        cabang={cabang}
        userProfile={userProfile}
        onSuccess={fetchData}
      />
    </>
  );
}

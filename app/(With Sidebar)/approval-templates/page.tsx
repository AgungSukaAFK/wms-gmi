// app/(With Sidebar)/approval-templates/page.tsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import {
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Plus,
  FileText,
  Settings2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ApprovalTemplate, ApprovalType } from "@/type";
import { TemplateEditor } from "@/components/approval/template-editor";
import { Content } from "@/components/content";
import {
  type ActiveFilter,
  FilterField,
  FilterFields,
  FilterPanel,
  filterOptionLabel,
} from "@/components/filter-panel";
import { ListSearchInput } from "@/components/list-search-input";
import {
  ColumnOrderReset,
  ReorderableHeaderRow,
  ReorderableTableHead,
  type ReorderableColumn,
} from "@/components/reorderable-table-head";
import { RowActionsMenu } from "@/components/row-actions-menu";
import { StickyHeaderTable } from "@/components/sticky-header-table";
import { TablePaginationFooter } from "@/components/table-pagination-footer";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useColumnOrder } from "@/hooks/use-column-order";
import { useUrlListState } from "@/hooks/use-url-list-state";
import { useUrlSearchInput } from "@/hooks/use-url-search-input";
import { MultiSelect } from "@/components/ui/multi-select";


const TEMPLATE_SORT_COLUMNS: Record<string, string> = {
  name: "name",
  type: "type",
  updated_at: "updated_at",
};

// Harus sama dengan kolom yang dicari di fetchData.
const TEMPLATE_SEARCH_FIELDS = ["Nama Template"];

const TEMPLATE_TYPE_OPTIONS = [
  "Material Request",
  "Purchase Request",
  "Purchase Order",
  "Receive Item",
  "Item Transfer",
  "Stock Out - SPB",
  "Stock Out - SPB Invoice",
  "Return SPB",
  "Working Order",
].map((value) => ({ label: value, value }));

const TEMPLATE_HEAD_CLASS = "text-[10px] font-black uppercase text-muted-foreground";

// Kolom sebelum "Aksi". Id kolom yang bisa di-sort = key di TEMPLATE_SORT_COLUMNS.
const TEMPLATE_COLUMNS = [
  { id: "name", label: "Nama Template", sortDirection: "asc", className: `w-50 ${TEMPLATE_HEAD_CLASS}` },
  { id: "type", label: "Jenis Dokumen", sortDirection: "asc", className: TEMPLATE_HEAD_CLASS },
  { id: "lokasi", label: "Lokasi", className: TEMPLATE_HEAD_CLASS },
  { id: "updated_at", label: "Pembaruan Terakhir", sortDirection: "desc", className: `w-37.5 ${TEMPLATE_HEAD_CLASS}` },
] as const satisfies readonly ReorderableColumn[];
type TemplateColumnId = (typeof TEMPLATE_COLUMNS)[number]["id"];

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
  const columnOrder = useColumnOrder("wms:table-column-order:approval-template", TEMPLATE_COLUMNS);
  const urlState = useUrlListState();
  const debouncedSearch = urlState.get("search");
  const [searchQuery, setSearchQuery, resetSearchQuery] = useUrlSearchInput(
    debouncedSearch,
    (value) => urlState.set({ search: value }, { resetPage: true }),
  );
  const typeFilters = urlState.list("jenis");
  const setTypeFilters = (v: string[]) =>
    urlState.set({ jenis: v }, { resetPage: true });
  // Admin non-moderator terkunci ke cabangnya sendiri, apa pun isi URL-nya.
  const lockedCabang =
    userProfile?.isAdmin && !userProfile?.isModerator
      ? userProfile.cabang_id?.toString()
      : undefined;
  const urlCabangFilters = urlState.list("lokasi");
  const cabangFilters = useMemo(
    () => (lockedCabang ? [lockedCabang] : urlCabangFilters),
    [lockedCabang, urlCabangFilters],
  );
  const setCabangFilters = (v: string[]) =>
    urlState.set({ lokasi: v }, { resetPage: true });
  const sortOrder = urlState.get("sort", "updated_at_desc");
  const setSortOrder = (v: string) =>
    urlState.set({ sort: v === "updated_at_desc" ? "" : v });
  const page = urlState.getNumber("page", 1);
  const setPage = (p: number) => urlState.set({ page: p === 1 ? "" : p });
  const limit = urlState.getNumber("limit", 25);
  const setLimit = (n: number) => urlState.set({ limit: n === 25 ? "" : n });
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
        }
      }
    }

    // 2. Fetch Cabang list once
    if (cabang.length === 0) {
      const { data: cabangData } = await supabase
        .from("cabang")
        .select("*")
        .eq("is_active", true)
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

    if (typeFilters.length > 0) {
      query = query.in("type", typeFilters);
    }

    if (cabangFilters.length > 0) {
      const hasGlobal = cabangFilters.includes("global");
      const cabangIds = cabangFilters
        .filter((v) => v !== "global")
        .map((v) => parseInt(v));
      if (hasGlobal && cabangIds.length > 0) {
        query = query.or(`cabang_id.is.null,cabang_id.in.(${cabangIds.join(",")})`);
      } else if (hasGlobal) {
        query = query.is("cabang_id", null);
      } else {
        query = query.in("cabang_id", cabangIds);
      }
    }

    const [sortKeyRaw, sortDirRaw] = sortOrder.split(/_(asc|desc)$/);
    const sortColumn = TEMPLATE_SORT_COLUMNS[sortKeyRaw];
    const sortField = sortColumn || "updated_at";
    const ascending = sortColumn ? sortDirRaw === "asc" : false;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, count, error } = await query
      .order(sortField, { ascending })
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
  }, [debouncedSearch, typeFilters, cabangFilters, sortOrder, page, limit]);

  const handleSortChange = (nextSort: string) => {
    setSortOrder(nextSort);
    setPage(1);
  };

  const handleAddTemplate = () => {
    setSelectedTemplate(null);
    setIsEditorOpen(true);
  };

  const handleEditTemplate = (template: ApprovalTemplate) => {
    setSelectedTemplate(template);
    setIsEditorOpen(true);
  };

  const resetFilters = () => {
    resetSearchQuery();
    urlState.reset();
  };

  const cabangOptions = [
    { label: "Global (Semua Lokasi)", value: "global" },
    ...cabang.map((c) => ({
      label: c.nama_cabang,
      value: c.id.toString(),
    })),
  ];

  // Chip filter aktif di FilterPanel (tetap tampil walau panel tertutup).
  const optionLabels = (
    options: { label: string; value: string }[],
    values: string[],
  ) => values.map((v) => filterOptionLabel(options, v)).join(", ");
  const activeFilters: ActiveFilter[] = [];
  if (typeFilters.length > 0)
    activeFilters.push({
      key: "jenis",
      label: "Jenis",
      value: optionLabels(TEMPLATE_TYPE_OPTIONS, typeFilters),
      onRemove: () => setTypeFilters([]),
    });
  if (cabangFilters.length > 0)
    activeFilters.push({
      key: "lokasi",
      label: "Lokasi",
      value: optionLabels(cabangOptions, cabangFilters),
      onRemove: lockedCabang ? undefined : () => setCabangFilters([]),
    });

  // Satu sel per id kolom; urutannya diatur useColumnOrder.
  const renderCell = (template: ApprovalTemplate, id: TemplateColumnId) => {
    switch (id) {
      case "name":
        return (
          <TableCell>
            <span className="font-bold text-foreground">
              {template.name}
            </span>
          </TableCell>
        );
      case "type":
        return (
          <TableCell>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-medium text-muted-foreground font-mono text-xs">
                {template.type}
              </span>
            </div>
          </TableCell>
        );
      case "lokasi":
        return (
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
        );
      case "updated_at":
        return (
          <TableCell className="text-muted-foreground text-xs">
            {formatDate(template.updated_at)}
          </TableCell>
        );
    }
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
        <div className="space-y-3">
          <ListSearchInput
            placeholder="Cari nama template..."
            value={searchQuery}
            onChange={setSearchQuery}
            searchableFields={TEMPLATE_SEARCH_FIELDS}
          />

          <FilterPanel activeFilters={activeFilters} onReset={resetFilters}>
            <FilterFields>
              <FilterField label="Jenis Dokumen">
                <MultiSelect
                  placeholder="Semua Jenis"
                  searchable
                  selected={typeFilters}
                  onChange={setTypeFilters}
                  options={TEMPLATE_TYPE_OPTIONS}
                />
              </FilterField>

              <FilterField label="Lokasi">
                <MultiSelect
                  placeholder="Lokasi: Semua"
                  searchable
                  disabled={!!lockedCabang}
                  selected={cabangFilters}
                  onChange={setCabangFilters}
                  options={cabangOptions}
                />
              </FilterField>
            </FilterFields>
          </FilterPanel>
        </div>
      </Content>

      <Content>
        {columnOrder.isCustomOrder && (
          <ColumnOrderReset onReset={columnOrder.resetOrder} />
        )}
        <StickyHeaderTable
          className="min-w-[900px]"
          containerClassName="rounded-md border"
          header={
            <ReorderableHeaderRow
              order={columnOrder.order}
              onMove={columnOrder.moveColumn}
              className="hover:bg-transparent h-10"
            >
              <TableHead className="w-14 text-center text-[10px] font-black uppercase text-muted-foreground">
                No
              </TableHead>
              {columnOrder.orderedColumns.map((column) => (
                <ReorderableTableHead
                  key={column.id}
                  column={column}
                  sort={{ currentSort: sortOrder, onSort: handleSortChange }}
                />
              ))}
              <TableHead className="w-20 text-right pr-4 text-[10px] font-black uppercase text-muted-foreground">
                Aksi
              </TableHead>
            </ReorderableHeaderRow>
          }
        >
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(limit, 25) }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : templates.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-40 text-center text-muted-foreground italic text-sm"
                >
                  Tidak ada template yang ditemukan.
                </TableCell>
              </TableRow>
            ) : (
              templates.map((template, index) => (
                <TableRow
                  key={template.id}
                  className="group hover:bg-muted/30 transition-all border-b border-border/50 h-14"
                >
                  <TableCell className="text-center text-[10px] font-semibold text-muted-foreground">
                    {(page - 1) * limit + index + 1}
                  </TableCell>
                  {columnOrder.order.map((id) => (
                    <React.Fragment key={id}>{renderCell(template, id)}</React.Fragment>
                  ))}
                  <TableCell className="text-right pr-4">
                    <RowActionsMenu>
                      <DropdownMenuItem
                        onSelect={() => handleEditTemplate(template)}
                      >
                        <Settings2 className="mr-2 h-4 w-4" /> Edit Template
                      </DropdownMenuItem>
                    </RowActionsMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </StickyHeaderTable>

        <TablePaginationFooter
          currentPage={page}
          totalItems={totalCount}
          limit={limit}
          itemLabel="Template"
          onPageChange={setPage}
          onLimitChange={(val) => {
            setLimit(parseInt(val, 10));
            setPage(1);
          }}
          className="mt-6"
        />
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

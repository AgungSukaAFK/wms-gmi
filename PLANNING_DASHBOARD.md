# PLANNING: Halaman Dashboard WMS-GMI

## Konteks

File target: `app/(With Sidebar)/dashboard/page.tsx`
Halaman saat ini hanya menampilkan nama cabang dan status akun.
Tujuan: rebuild menjadi dashboard informatif dengan data real dari Supabase.

---

## Arsitektur

- **Page component**: Server Component (async) — sudah ada, tinggal expand.
- **Chart components**: Client Component — buat file baru per chart di `components/dashboard/`.
- **Data fetching**: Langsung query Supabase di server component, lalu pass data sebagai props ke client chart components.
- **Layout**: Gunakan komponen `<Content>` yang sudah ada (wrapper Card dari shadcn).
- **Chart library**: Recharts — sudah terinstall, wrapper di `components/ui/chart.tsx` (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`).

---

## Layout Struktur (Top → Bottom)

```
┌─────────────────────────────────────────────────┐
│ Section 1: Header + Greeting                    │
│ "Dashboard WMS-GMI" + Nama User + Cabang        │
└─────────────────────────────────────────────────┘

┌──────────┬──────────┬──────────┬──────────┐
│ KPI 1    │ KPI 2    │ KPI 3    │ KPI 4    │
│ Total MR │ Total PR │ Total PO │ Total SPB│
│ (bulan)  │ (bulan)  │ (bulan)  │ (bulan)  │
└──────────┴──────────┴──────────┴──────────┘

┌──────────┬──────────┬──────────┬──────────┐
│ KPI 5    │ KPI 6    │ KPI 7    │ KPI 8    │
│ Pending  │ Low Stock│ Delivery │ Job Cost │
│ Approval │ Items    │ On-Going │ Open     │
└──────────┴──────────┴──────────┴──────────┘

┌────────────────────────┬───────────────────────┐
│ Chart Area:            │ Chart Bar:            │
│ Tren Dokumen 6 Bulan   │ MR per Cabang         │
│ (MR, PR, PO line)      │ (bar chart)           │
└────────────────────────┴───────────────────────┘

┌────────────────────────┬───────────────────────┐
│ Tabel:                 │ Tabel:                │
│ MR Terbaru (5 item)    │ Delivery Terbaru (5)  │
└────────────────────────┴───────────────────────┘

┌─────────────────────────────────────────────────┐
│ Tabel: Stock Menipis (Low Stock) — 5 item       │
└─────────────────────────────────────────────────┘
```

---

## Detail Per Section

### Section 1: Header + Greeting

**Lokasi**: Di atas, full width `<Content>`.

```tsx
// Data sudah ada dari query profile
<Content>
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-xl font-bold tracking-tight">Dashboard WMS-GMI</h1>
      <p className="text-[10px] font-bold uppercase text-muted-foreground mt-1">
        Selamat datang, {profile?.nama} — {profile?.cabang?.nama_cabang}
      </p>
    </div>
    <Badge variant="outline" className="text-xs font-semibold">
      {new Date().toLocaleDateString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}
    </Badge>
  </div>
</Content>
```

---

### Section 2: KPI Cards (Baris 1 — Dokumen Bulan Ini)

**Grid**: `grid grid-cols-2 md:grid-cols-4 gap-4`
Gunakan `<Content size="xs">` per card (otomatis 4 kolom di XL).

**Query Supabase** (di server component):

```ts
const now = new Date();
const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

// KPI 1: Total MR bulan ini
const { count: mrCount } = await supabase
  .from("mrs")
  .select("*", { count: "exact", head: true })
  .gte("created_at", startOfMonth);

// KPI 2: Total PR bulan ini
const { count: prCount } = await supabase
  .from("prs")
  .select("*", { count: "exact", head: true })
  .gte("created_at", startOfMonth);

// KPI 3: Total PO bulan ini
const { count: poCount } = await supabase
  .from("pos")
  .select("*", { count: "exact", head: true })
  .gte("created_at", startOfMonth);

// KPI 4: Total SPB bulan ini
const { count: spbCount } = await supabase
  .from("spb")
  .select("*", { count: "exact", head: true })
  .gte("created_at", startOfMonth);
```

**Render per card**:

```tsx
<Content size="xs">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-[10px] font-bold uppercase text-muted-foreground">
        Material Request
      </p>
      <p className="text-2xl font-bold text-foreground">{mrCount ?? 0}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">Bulan ini</p>
    </div>
    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
      <ClipboardList className="h-5 w-5 text-primary" />
    </div>
  </div>
</Content>
```

Icon per KPI:

- MR: `ClipboardList` (dari lucide)
- PR: `FileText`
- PO: `ShoppingCart`
- SPB: `PackageOpen`

---

### Section 3: KPI Cards (Baris 2 — Status & Alert)

**Query Supabase**:

```ts
// KPI 5: Pending Approval (MR + PR + PO status "open")
const { count: pendingMr } = await supabase
  .from("mrs")
  .select("*", { count: "exact", head: true })
  .eq("mr_status", "open");

const { count: pendingPr } = await supabase
  .from("prs")
  .select("*", { count: "exact", head: true })
  .eq("pr_status", "open");

const { count: pendingPo } = await supabase
  .from("pos")
  .select("*", { count: "exact", head: true })
  .eq("po_status", "open");

const totalPending = (pendingMr ?? 0) + (pendingPr ?? 0) + (pendingPo ?? 0);

// KPI 6: Low Stock Items (pakai view v_stock_with_status)
const { count: lowStockCount } = await supabase
  .from("v_stock_with_status")
  .select("*", { count: "exact", head: true })
  .eq("status", "low");

// KPI 7: Delivery On-Going (status != "done" dan != "closed")
const { count: deliveryOngoing } = await supabase
  .from("deliveries")
  .select("*", { count: "exact", head: true })
  .not("status", "in", '("done","closed")');

// KPI 8: Job Costing Open
const { count: jobOpen } = await supabase
  .from("job_costing")
  .select("*", { count: "exact", head: true })
  .eq("status", "open");
```

Icon per KPI:

- Pending Approval: `Clock` (warna warning/amber)
- Low Stock: `AlertTriangle` (warna destructive/red)
- Delivery On-Going: `Truck` (warna blue)
- Job Costing Open: `Calculator` (warna foreground)

---

### Section 4: Chart — Tren Dokumen 6 Bulan Terakhir

**File baru**: `components/dashboard/document-trend-chart.tsx`

**Tipe**: `"use client"` — AreaChart (seperti `chart-1.tsx` yang existing)

**Props**: `data: { bulan: string; mr: number; pr: number; po: number }[]`

**Query Supabase** (di server component, lalu pass sebagai props):

```ts
// Hitung 6 bulan terakhir
const months: { label: string; start: string; end: string }[] = [];
for (let i = 5; i >= 0; i--) {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  months.push({
    label: d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }),
    start: d.toISOString().split("T")[0],
    end: nextMonth.toISOString().split("T")[0],
  });
}

const trendData = await Promise.all(
  months.map(async (m) => {
    const [mr, pr, po] = await Promise.all([
      supabase
        .from("mrs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", m.start)
        .lt("created_at", m.end),
      supabase
        .from("prs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", m.start)
        .lt("created_at", m.end),
      supabase
        .from("pos")
        .select("*", { count: "exact", head: true })
        .gte("created_at", m.start)
        .lt("created_at", m.end),
    ]);
    return {
      bulan: m.label,
      mr: mr.count ?? 0,
      pr: pr.count ?? 0,
      po: po.count ?? 0,
    };
  }),
);
```

**Chart config**:

```ts
const chartConfig = {
  mr: { label: "Material Request", color: "var(--chart-1)" },
  pr: { label: "Purchase Request", color: "var(--chart-2)" },
  po: { label: "Purchase Order", color: "var(--chart-3)" },
} satisfies ChartConfig;
```

**Render**: Area chart dengan 3 area series, smooth curve, gradient fill.
**Layout**: `<Content size="md">` (setengah layar = 6 cols di LG).

---

### Section 5: Chart — MR per Cabang

**File baru**: `components/dashboard/mr-by-cabang-chart.tsx`

**Tipe**: `"use client"` — BarChart (seperti `chart-2.tsx`)

**Props**: `data: { cabang: string; count: number }[]`

**Query Supabase**:

```ts
// MR per cabang (semua waktu, atau bisa filter bulan ini)
const { data: mrByCabang } = await supabase
  .from("mrs")
  .select("cabang_id, cabang(nama_cabang)")
  .gte("created_at", startOfMonth);

// Aggregate di JS:
const cabangMap: Record<string, number> = {};
(mrByCabang ?? []).forEach((row: any) => {
  const name = row.cabang?.nama_cabang || "Unknown";
  cabangMap[name] = (cabangMap[name] || 0) + 1;
});
const mrCabangData = Object.entries(cabangMap)
  .map(([cabang, count]) => ({ cabang, count }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 10); // Top 10
```

**Render**: Bar chart, horizontal labels, rounded bars.
**Layout**: `<Content size="md">` (setengah layar).

---

### Section 6: Tabel — MR Terbaru

**Layout**: `<Content size="md">` (setengah layar)

**Query Supabase**:

```ts
const { data: recentMrs } = await supabase
  .from("mrs")
  .select(
    "id, mr_kode, mr_pic, mr_tanggal, mr_status, mr_priority, cabang(nama_cabang)",
  )
  .order("created_at", { ascending: false })
  .limit(5);
```

**Render**: Tabel simpel (tanpa pagination) dengan kolom:
| Kode MR | PIC | Cabang | Tanggal | Prioritas | Status |

Gunakan `<Table>` dari shadcn/ui. Status pakai `<Badge>` dengan warna sesuai status.
Baris bisa diklik → navigasi ke `/mr` (atau bisa juga tidak, simpel saja).

---

### Section 7: Tabel — Delivery Terbaru

**Layout**: `<Content size="md">` (setengah layar, sejajar MR Terbaru)

**Query Supabase**:

```ts
const { data: recentDeliveries } = await supabase
  .from("deliveries")
  .select(
    "id, dlv_kode, pic, status, created_at, dari_cabang:cabang!dari_cabang_id(nama_cabang), ke_cabang:cabang!ke_cabang_id(nama_cabang)",
  )
  .order("created_at", { ascending: false })
  .limit(5);
```

**Render**: Tabel simpel dengan kolom:
| Kode Delivery | Route (Dari → Ke) | PIC | Status |

---

### Section 8: Tabel — Stock Menipis

**Layout**: `<Content>` full width.

**Query Supabase**:

```ts
const { data: lowStockItems } = await supabase
  .from("v_stock_with_status")
  .select("*")
  .eq("status", "low")
  .order("qty", { ascending: true })
  .limit(5);
```

**Render**: Tabel simpel dengan kolom:
| Part Number | Part Name | Cabang | Qty | Min Qty | Status |

Status ditampilkan sebagai `<Badge variant="destructive">Low Stock</Badge>`.

---

## File yang Perlu Dibuat / Diubah

### File BARU:

1. **`components/dashboard/document-trend-chart.tsx`**
   - Client component
   - Props: `data: { bulan: string; mr: number; pr: number; po: number }[]`
   - Render: AreaChart dari recharts dengan 3 series (MR, PR, PO)
   - Import: `{ CartesianGrid, XAxis, Area, AreaChart }` dari `recharts`
   - Import: `{ ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent }` dari `@/components/ui/chart`
   - Referensi pattern: `components/chart-1.tsx`

2. **`components/dashboard/mr-by-cabang-chart.tsx`**
   - Client component
   - Props: `data: { cabang: string; count: number }[]`
   - Render: BarChart dari recharts
   - Referensi pattern: `components/chart-2.tsx`

### File DIUBAH:

3. **`app/(With Sidebar)/dashboard/page.tsx`**
   - Tetap Server Component (async)
   - Expand query Supabase untuk semua KPI, trend, recent data
   - Import dan render semua section di atas
   - Import: `Content` dari `@/components/content`
   - Import: `Badge` dari `@/components/ui/badge`
   - Import: `Table, TableBody, TableCell, TableHead, TableHeader, TableRow` dari `@/components/ui/table`
   - Import: icon dari `lucide-react`
   - Import: 2 chart component baru

---

## Styling Rules (WAJIB diikuti)

1. **Semua text label**: `text-[10px] font-bold uppercase text-muted-foreground`
2. **Angka KPI besar**: `text-2xl font-bold text-foreground`
3. **Sub-text**: `text-[10px] text-muted-foreground`
4. **Icon container**: `h-10 w-10 rounded-md bg-{color}/10 flex items-center justify-center`
5. **Badge status**:
   - open → `bg-blue-100 text-blue-700 border-blue-200`
   - approved → `bg-green-100 text-green-700 border-green-200`
   - rejected → `bg-red-100 text-red-700 border-red-200`
   - done → `bg-emerald-100 text-emerald-700 border-emerald-200`
   - closed → `bg-gray-100 text-gray-600 border-gray-200`
6. **Table header**: `text-[10px] font-black uppercase text-muted-foreground`
7. **Table row**: `text-xs font-medium text-foreground`
8. **Card (Content)**: Pakai `<Content>`, `<Content size="md">`, atau `<Content size="xs">` sesuai layout grid.

---

## Catatan Penting

- **JANGAN** ubah file lain selain yang disebutkan di atas.
- **JANGAN** tambah package baru — recharts dan semua shadcn components sudah terinstall.
- **JANGAN** buat API route — query langsung dari Server Component.
- **JANGAN** pakai `"use client"` di page.tsx — hanya chart components yang client.
- **Semua query** gunakan `createClient` dari `@/lib/supabase/server` (bukan `/client`).
- `<Content>` otomatis jadi card (shadcn Card wrapper). Size `"xs"` = 3 cols XL, `"md"` = 6 cols LG, `"lg"` (default) = 12 cols.
- Jika view `v_stock_with_status` error, fallback: query `stock` table dan cek `qty < min_qty` secara manual.
- Format tanggal: `new Date(value).toLocaleDateString("id-ID")` untuk tampilan Indonesia.
- Priority badge MR: P1=destructive, P2=warning, P3=primary, P4=muted.

---

## Urutan Pengerjaan

1. Buat `components/dashboard/document-trend-chart.tsx`
2. Buat `components/dashboard/mr-by-cabang-chart.tsx`
3. Rewrite `app/(With Sidebar)/dashboard/page.tsx` — semua query + render
4. Validasi: `get_errors` pada 3 file
5. Test visual di browser

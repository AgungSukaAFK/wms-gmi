import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpFromLine,
  Bell,
  BookOpen,
  BookText,
  CheckCircle2,
  ChevronRight,
  FileSignature,
  HelpCircle,
  Lightbulb,
  ListChecks,
  Rocket,
  Sparkles,
  User,
  Workflow,
} from "lucide-react";
import { Content } from "@/components/content";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  type Flow,
  type FlowStep,
  faqs,
  flows,
  gettingStarted,
  glossary,
  inputRules,
  otherFeatures,
  stockMoves,
} from "./content";

const stockStyle: Record<
  NonNullable<FlowStep["stock"]>["kind"],
  { icon: typeof ArrowDownToLine; className: string; label: string }
> = {
  in: {
    icon: ArrowDownToLine,
    className: "border-success/30 bg-success/10 text-success",
    label: "Stok masuk",
  },
  out: {
    icon: ArrowUpFromLine,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    label: "Stok keluar",
  },
  move: {
    icon: ArrowRightLeft,
    className: "border-primary/30 bg-primary/10 text-primary",
    label: "Stok pindah",
  },
};

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof BookOpen; title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FlowStrip({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, i) => (
        <div key={step.short + i} className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-semibold">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {i + 1}
            </span>
            {step.short}
          </span>
          {i < steps.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

function StepCard({ step, index, last }: { step: FlowStep; index: number; last: boolean }) {
  const stock = step.stock ? stockStyle[step.stock.kind] : null;
  const StockIcon = stock?.icon;
  return (
    <li className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {index + 1}
        </span>
        {!last && <span className="mt-1 w-px flex-1 bg-border" />}
      </div>

      <div className={cn("min-w-0 flex-1 rounded-lg border bg-background p-4", !last && "mb-3")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">{step.title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" /> {step.who}
            </p>
          </div>
          {step.url && (
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Link href={step.url}>
                Buka <ChevronRight className="h-3 w-3" />
              </Link>
            </Button>
          )}
        </div>

        <ul className="mt-3 space-y-1.5">
          {step.input.map((line) => (
            <li key={line} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {stock && StockIcon && step.stock && (
          <div className={cn("mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs", stock.className)}>
            <StockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-bold">{stock.label}:</span> {step.stock.text}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

function FlowPanel({ flow }: { flow: Flow }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{flow.summary}</p>
      <FlowStrip steps={flow.steps} />
      <ol className="pt-2">
        {flow.steps.map((step, i) => (
          <StepCard key={step.title} step={step} index={i} last={i === flow.steps.length - 1} />
        ))}
      </ol>
      {flow.notes && flow.notes.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase text-warning">
            <Lightbulb className="h-3.5 w-3.5" /> Perlu Diketahui
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
            {flow.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function DokumentasiPage() {
  return (
    <>
      <Content>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">DOKUMENTASI</h1>
              <p className="mt-1 text-[10px] font-bold uppercase text-muted-foreground">
                Panduan Penginputan & Penggunaan WMS-GMI
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline" className="h-9 px-4 text-xs font-bold uppercase">
              <Link href="/signatures">
                <FileSignature className="h-4 w-4" /> Tanda Tangan
              </Link>
            </Button>
            <Button asChild className="h-9 px-4 text-xs font-bold uppercase">
              <Link href="/notifications">
                <Bell className="h-4 w-4" /> Approval Saya
              </Link>
            </Button>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-4">
          <SectionTitle icon={Rocket} title="Mulai di Sini" hint="Lakukan sekali sebelum menggunakan WMS" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {gettingStarted.map((item, index) => {
              const body = (
                <>
                  <p className="text-[10px] font-bold uppercase text-primary">Langkah {index + 1}</p>
                  <p className="mt-1 text-sm font-bold text-foreground">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
                </>
              );
              return item.url ? (
                <Link
                  key={item.title}
                  href={item.url}
                  className="rounded-lg border bg-background p-4 transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  {body}
                </Link>
              ) : (
                <div key={item.title} className="rounded-lg border bg-background p-4">
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-4">
          <SectionTitle icon={Workflow} title="Alur Kerja" hint="Pilih alur sesuai pekerjaan Anda" />
          <Tabs defaultValue={flows[0].key}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
              {flows.map((flow) => (
                <TabsTrigger key={flow.key} value={flow.key} className="flex-none text-xs">
                  {flow.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {flows.map((flow) => (
              <TabsContent key={flow.key} value={flow.key} className="pt-3">
                <FlowPanel flow={flow} />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </Content>

      <Content>
        <div className="space-y-4">
          <SectionTitle icon={ArrowRightLeft} title="Kapan Stok Berubah?" />
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-bold uppercase">Dokumen</th>
                  <th className="px-3 py-2 font-bold uppercase text-destructive">Stok Berkurang</th>
                  <th className="px-3 py-2 font-bold uppercase text-success">Stok Bertambah</th>
                </tr>
              </thead>
              <tbody>
                {stockMoves.map((row) => (
                  <tr key={row.doc} className="border-t">
                    <td className="px-3 py-2 font-semibold">{row.doc}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.out}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.in}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Riwayat keluar-masuk tiap barang dapat dilihat di menu Stock, tab Riwayat.
          </p>
        </div>
      </Content>

      <Content>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <SectionTitle icon={ListChecks} title="Aturan Saat Input" />
            <ol className="space-y-2">
              {inputRules.map((rule, i) => (
                <li key={rule} className="flex gap-3 rounded-lg border p-3 text-xs leading-relaxed">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground">{rule}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-4">
            <SectionTitle icon={BookText} title="Istilah" />
            <dl className="divide-y rounded-lg border">
              {glossary.map((item) => (
                <div key={item.term} className="flex gap-3 px-3 py-2 text-xs">
                  <dt className="w-24 shrink-0">
                    <Badge variant="secondary" className="text-[10px] font-bold">
                      {item.term}
                    </Badge>
                  </dt>
                  <dd className="leading-relaxed text-muted-foreground">{item.meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-4">
          <SectionTitle icon={Sparkles} title="Fitur Lainnya" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {otherFeatures.map((item) => (
              <Link
                key={item.name}
                href={item.url}
                className="group rounded-lg border p-4 transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <p className="flex items-center justify-between text-sm font-bold text-foreground">
                  {item.name}
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </Content>

      <Content>
        <div className="space-y-3">
          <SectionTitle icon={HelpCircle} title="Pertanyaan Umum" />
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((item, i) => (
              <AccordionItem key={item.q} value={`faq-${i}`}>
                <AccordionTrigger className="text-xs font-bold">{item.q}</AccordionTrigger>
                <AccordionContent className="text-xs leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Content>
    </>
  );
}

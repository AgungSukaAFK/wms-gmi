import { Content } from "@/components/content";

export default function ComingSoonPage() {
  return (
    <Content>
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Coming Soon</h1>
        <p className="text-lg text-muted-foreground">
          Halaman ini sedang dalam tahap pengembangan dan ditargetkan rilis pada <strong>20 April 2026</strong>.
        </p>
      </div>
    </Content>
  );
}

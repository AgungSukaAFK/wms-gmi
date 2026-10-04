import Image from "next/image";
import { cn } from "@/lib/utils";

// Lourdes = induk (atas); GMI & GIS sejajar di bawahnya dipisah garis vertikal.
export function CompanyLogos({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <Image
        src="/lourdes-logo.webp"
        alt="Lourdes Auto Parts"
        width={1024}
        height={392}
        priority
        className="h-14 w-auto sm:h-16 lg:h-20"
      />
      <div className="flex w-full items-center justify-center gap-3 sm:gap-5 lg:gap-6">
        <div className="flex min-w-0 flex-1 justify-end">
          <Image
            src="/gmi-landscape-stroke.webp"
            alt="PT. Garuda Mart Indonesia"
            width={1098}
            height={148}
            priority
            className="h-auto w-full max-w-[190px] lg:max-w-[235px]"
          />
        </div>
        <span className="h-9 w-px shrink-0 bg-border lg:h-12" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 justify-start">
          <Image
            src="/gis-landscape.webp"
            alt="PT. Global Inti Sejati"
            width={1080}
            height={261}
            priority
            className="h-auto w-full max-w-[160px] lg:max-w-[195px]"
          />
        </div>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { ImportCenter } from "@/components/import/import-center";

export default function ImportPage() {
  return (
    <Suspense>
      <ImportCenter />
    </Suspense>
  );
}

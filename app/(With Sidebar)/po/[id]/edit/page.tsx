"use client";

import React, { Suspense, use } from "react";
import { Loader2 } from "lucide-react";
import { PoForm } from "@/components/po/po-form";

export default function EditPOPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="col-span-12 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PoForm editPoId={Number(id)} />
    </Suspense>
  );
}

"use client";

import Link from "next/link";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGoBack } from "@/hooks/use-go-back";

export function NotFoundActions() {
  const goBack = useGoBack("/dashboard");

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Button
        type="button"
        variant="outline"
        className="font-semibold"
        onClick={goBack}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Kembali
      </Button>
      <Button asChild className="font-semibold">
        <Link href="/dashboard">
          <Home className="mr-2 h-4 w-4" />
          Ke Dashboard
        </Link>
      </Button>
    </div>
  );
}

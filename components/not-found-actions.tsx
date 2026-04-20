"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotFoundActions() {
  const router = useRouter();

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
      <Button
        type="button"
        variant="outline"
        className="font-semibold"
        onClick={() => router.back()}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
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

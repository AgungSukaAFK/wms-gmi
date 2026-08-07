"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function PODetailRedirectPage() {
  const { id } = useParams();
  const router = useRouter();

  useEffect(() => {
    if (id) router.replace(`/po?id=${id}`);
  }, [id, router]);

  return null;
}

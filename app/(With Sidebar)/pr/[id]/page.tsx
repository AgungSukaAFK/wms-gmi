"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function PRDetailRedirectPage() {
  const { id } = useParams();
  const router = useRouter();

  useEffect(() => {
    if (id) router.replace(`/pr?id=${id}`);
  }, [id, router]);

  return null;
}

"use client";

import { use } from "react";
import { SoForm } from "@/components/so-reguler/so-form";

export default function EditSoRegulerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SoForm editSoId={Number(id)} />;
}

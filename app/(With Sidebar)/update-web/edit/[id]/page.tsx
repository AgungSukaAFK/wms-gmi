// Halaman edit postingan Update Web (khusus publisher). Perubahan otomatis
// tersimpan sebagai draft per post, lihat components/update-web/UpdatePostForm.tsx.

"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UpdatePostForm } from "@/components/update-web/UpdatePostForm";
import { useUpdateWebPublisher } from "@/hooks/use-update-web-publisher";
import { fetchUpdateWebPostById } from "@/services/update-web-client";
import { UpdateWebPost } from "@/type/update-web";

export default function EditUpdateWebPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const postId = Number(id);
  const { viewer, checking } = useUpdateWebPublisher();
  const [post, setPost] = useState<UpdateWebPost | null>(null);
  const validId = Number.isInteger(postId) && postId > 0;
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!validId) return;
    fetchUpdateWebPostById(postId)
      .then(setPost)
      .catch(() => setNotFound(true));
  }, [postId, validId]);

  const error = !validId
    ? "ID postingan tidak valid."
    : notFound
      ? "Postingan tidak ditemukan."
      : null;

  if (error) {
    return (
      <Content title="Edit Update Web" description={error}>
        <Button variant="outline" asChild>
          <Link href="/update-web">Kembali ke Update Web</Link>
        </Button>
      </Content>
    );
  }

  if (checking || !viewer || !post) {
    return <Skeleton className="col-span-12 h-[70vh] w-full rounded-xl" />;
  }

  return (
    <UpdatePostForm
      mode="edit"
      userId={viewer.userId}
      initialPost={post}
      latestVersion={null}
    />
  );
}

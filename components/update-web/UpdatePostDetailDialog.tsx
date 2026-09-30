// Modal detail 1 postingan Update Web - dibuka dari UpdatePostCard. Setelah
// kirim komentar, post di-refetch (RPC return void). Publisher dapat tombol
// Edit & Hapus.

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { UpdatePostArticle } from "./UpdatePostArticle";
import { UpdatePostComments } from "./UpdatePostComments";
import { UpdatePostReactions } from "./UpdatePostReactions";
import {
  addUpdateWebPostComment,
  deleteUpdateWebPost,
  fetchUpdateWebPostById,
} from "@/services/update-web-client";
import {
  UpdateWebPost,
  UpdateWebPostReactionSummary,
  UpdateWebReactionEmoji,
} from "@/type/update-web";

interface UpdatePostDetailDialogProps {
  post: UpdateWebPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reactions: UpdateWebPostReactionSummary[];
  onToggleReaction: (emoji: UpdateWebReactionEmoji) => void;
  isLatest: boolean;
  isPublisher: boolean;
  currentUserId: string | null;
  onPostUpdated: (post: UpdateWebPost) => void;
  onEdit: (post: UpdateWebPost) => void;
  onDeleted: (postId: number) => void;
}

export function UpdatePostDetailDialog({
  post,
  open,
  onOpenChange,
  reactions,
  onToggleReaction,
  isLatest,
  isPublisher,
  currentUserId,
  onPostUpdated,
  onEdit,
  onDeleted,
}: UpdatePostDetailDialogProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!post) return null;

  const handleSubmitComment = async (message: string) => {
    await addUpdateWebPostComment(post.id, message);
    onPostUpdated(await fetchUpdateWebPostById(post.id));
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteUpdateWebPost(post.id);
      toast.success("Postingan berhasil dihapus.");
      setDeleteOpen(false);
      onOpenChange(false);
      onDeleted(post.id);
    } catch (error: any) {
      toast.error("Gagal menghapus postingan", { description: error.message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl lg:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-xl">
              <Badge variant="secondary">v{post.version}</Badge>
              {isLatest && <Badge>Terbaru</Badge>}
              <span>{post.title}</span>
            </DialogTitle>
            <DialogDescription>
              Diposting{" "}
              {new Date(post.created_at).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {post.created_by_profile?.nama
                ? ` oleh ${post.created_by_profile.nama}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-6">
            {isPublisher && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => onEdit(post)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Hapus
                </Button>
              </div>
            )}

            <UpdatePostArticle
              title={post.title}
              thumbnailUrl={post.thumbnail_url}
              highlights={post.highlights}
              content={post.content}
            />

            <UpdatePostReactions
              summaries={reactions}
              onSelect={onToggleReaction}
            />

            <UpdatePostComments
              comments={post.comments ?? []}
              currentUserId={currentUserId}
              onSubmit={handleSubmitComment}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus postingan ini?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{post.title}&rdquo; (v{post.version}) akan dihapus permanen
              beserta seluruh komentar dan reaction-nya. Tindakan ini tidak bisa
              dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

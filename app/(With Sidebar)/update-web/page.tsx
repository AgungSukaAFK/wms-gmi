// Halaman "Update Web" - changelog/pengumuman aplikasi untuk semua user login:
// daftar card, detail (modal), reaction, dan komentar. Publisher (moderator +
// it) dapat tombol "Buat Update" serta Edit/Hapus di modal detail.
// Membuka halaman ini = "sudah dilihat" (badge sidebar & banner dashboard padam).
// Deep link /update-web?post=<id> (link notifikasi balasan komentar) langsung
// membuka modal detail post tsb.

"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";
import { Content } from "@/components/content";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UpdatePostCard } from "@/components/update-web/UpdatePostCard";
import { UpdatePostDetailDialog } from "@/components/update-web/UpdatePostDetailDialog";
import { useUpdateWebBadge } from "@/hooks/use-update-web-badge";
import { fireEmojiConfetti } from "@/lib/emoji-confetti";
import {
  fetchUpdateWebPostReactions,
  fetchUpdateWebPosts,
  fetchUpdateWebViewer,
  setUpdateWebPostReaction,
  UpdateWebViewer,
} from "@/services/update-web-client";
import {
  UpdateWebPost,
  UpdateWebPostReactionSummary,
  UpdateWebReactionEmoji,
} from "@/type/update-web";

// useSearchParams butuh Suspense boundary supaya route tetap bisa diprerender.
export default function UpdateWebPage() {
  return (
    <Suspense fallback={null}>
      <UpdateWebPageContent />
    </Suspense>
  );
}

function UpdateWebPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkPostParam = searchParams.get("post");
  // Param ?post yang sudah diproses, supaya modal tidak terbuka ulang tiap
  // `posts` berubah (reaction/komentar). Di-reset saat modal ditutup.
  const handledDeepLink = useRef<string | null>(null);
  const [viewer, setViewer] = useState<UpdateWebViewer | null>(null);
  // Fetch reaction HARUS menunggu viewer selesai dicek, kalau tidak
  // `reactedByMe` dihitung dengan userId null (semua false).
  const [viewerLoaded, setViewerLoaded] = useState(false);
  const [posts, setPosts] = useState<UpdateWebPost[]>([]);
  const [reactionsByPost, setReactionsByPost] = useState<
    Map<number, UpdateWebPostReactionSummary[]>
  >(new Map());
  const [loading, setLoading] = useState(true);
  // Response request lama diabaikan supaya tidak menimpa state yang lebih baru.
  const loadRequestId = useRef(0);

  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const userId = viewer?.userId ?? null;
  const { loading: badgeLoading, markSeen } = useUpdateWebBadge(userId);

  useEffect(() => {
    fetchUpdateWebViewer()
      .then(setViewer)
      .catch(() => setViewer(null))
      .finally(() => setViewerLoaded(true));
  }, []);

  useEffect(() => {
    if (userId && !badgeLoading) markSeen();
  }, [userId, badgeLoading, markSeen]);

  const loadPosts = useCallback(async (currentUserId: string | null) => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    try {
      const data = await fetchUpdateWebPosts();
      const reactions = await fetchUpdateWebPostReactions(
        data.map((p) => p.id),
        currentUserId,
      );
      if (requestId !== loadRequestId.current) return;
      setPosts(data);
      setReactionsByPost(reactions);
    } catch (error: any) {
      if (requestId !== loadRequestId.current) return;
      toast.error("Gagal memuat Update Web", { description: error.message });
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewerLoaded) loadPosts(userId);
  }, [viewerLoaded, userId, loadPosts]);

  // 1 reaction aktif per user per post: klik emoji yang sama = hapus, emoji
  // lain = ganti.
  const handleSetReaction = async (
    postId: number,
    emoji: UpdateWebReactionEmoji,
  ) => {
    if (!viewer) {
      toast.error("Anda harus login untuk memberi reaction.");
      return;
    }
    const me = { id: viewer.userId, nama: viewer.nama };
    const current = reactionsByPost.get(postId) ?? [];
    const previousEmoji = current.find((s) => s.reactedByMe)?.emoji ?? null;
    const nextEmoji = previousEmoji === emoji ? null : emoji;
    if (nextEmoji) fireEmojiConfetti(nextEmoji);

    // Optimistic: reaction hanya milik user sendiri, aman diubah lokal.
    setReactionsByPost((prev) => {
      const next = new Map(prev);
      let list = (next.get(postId) ?? []).map((s) => ({
        ...s,
        reactors: [...s.reactors],
      }));

      if (previousEmoji) {
        list = list
          .map((s) =>
            s.emoji === previousEmoji
              ? {
                  ...s,
                  count: s.count - 1,
                  reactedByMe: false,
                  reactors: s.reactors.filter((r) => r.id !== me.id),
                }
              : s,
          )
          .filter((s) => s.count > 0);
      }

      if (nextEmoji) {
        const existing = list.find((s) => s.emoji === nextEmoji);
        if (existing) {
          existing.count += 1;
          existing.reactedByMe = true;
          existing.reactors = [...existing.reactors, me];
        } else {
          list = [
            ...list,
            { emoji: nextEmoji, count: 1, reactedByMe: true, reactors: [me] },
          ];
        }
      }

      next.set(postId, list);
      return next;
    });

    try {
      await setUpdateWebPostReaction(postId, viewer.userId, nextEmoji);
    } catch (error: any) {
      toast.error("Gagal menyimpan reaction", { description: error.message });
      loadPosts(viewer.userId);
    }
  };

  useEffect(() => {
    if (loading || !deepLinkPostParam) return;
    if (handledDeepLink.current === deepLinkPostParam) return;
    handledDeepLink.current = deepLinkPostParam;

    const postId = Number(deepLinkPostParam);
    if (Number.isInteger(postId) && posts.some((p) => p.id === postId)) {
      setSelectedPostId(postId);
      setDetailOpen(true);
    } else {
      toast.error("Postingan tidak ditemukan atau sudah dihapus.");
    }
  }, [loading, deepLinkPostParam, posts]);

  const handleDetailOpenChange = (open: boolean) => {
    setDetailOpen(open);
    // Bersihkan ?post supaya refresh tidak membuka modal lagi, dan klik
    // notifikasi yang sama berikutnya tetap membuka modal.
    if (!open && deepLinkPostParam) {
      handledDeepLink.current = null;
      router.replace("/update-web", { scroll: false });
    }
  };

  const selectedPost = posts.find((p) => p.id === selectedPostId) ?? null;

  return (
    <Content
      title="Update Web"
      description="Daftar pembaruan & pengumuman aplikasi."
      cardAction={
        viewer?.isPublisher ? (
          <Button asChild>
            <Link href="/update-web/buat">
              <Plus className="h-4 w-4" /> Buat Update
            </Link>
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-xl" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
          <Megaphone className="h-10 w-10" />
          <p>Belum ada postingan update.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, index) => (
            <UpdatePostCard
              key={post.id}
              post={post}
              reactions={reactionsByPost.get(post.id) ?? []}
              isLatest={index === 0}
              onOpen={() => {
                setSelectedPostId(post.id);
                setDetailOpen(true);
              }}
              onToggleReaction={(emoji) => handleSetReaction(post.id, emoji)}
            />
          ))}
        </div>
      )}

      <UpdatePostDetailDialog
        post={selectedPost}
        open={detailOpen}
        onOpenChange={handleDetailOpenChange}
        reactions={
          selectedPost ? (reactionsByPost.get(selectedPost.id) ?? []) : []
        }
        isLatest={!!selectedPost && selectedPost.id === posts[0]?.id}
        onToggleReaction={(emoji) =>
          selectedPost && handleSetReaction(selectedPost.id, emoji)
        }
        isPublisher={!!viewer?.isPublisher}
        currentUserId={userId}
        onPostUpdated={(post) =>
          setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)))
        }
        onEdit={(post) => router.push(`/update-web/edit/${post.id}`)}
        onDeleted={(postId) =>
          setPosts((prev) => prev.filter((p) => p.id !== postId))
        }
      />
    </Content>
  );
}

// Service fitur "Update Web" - BUKAN server action: semua query jalan dari
// browser lewat supabase-js, akses dijaga RLS + RPC di DB (lihat
// supabase/migrations/20260930110000_update_web.sql). Pengecekan publisher di
// client cuma untuk UX (sembunyikan tombol / redirect).
//
// Upload media juga langsung dari browser ke bucket "update-web", jadi file
// besar (video) tidak lewat Vercel dan tidak kena limit body 4.5MB.

import { createClient } from "@/lib/supabase/client";
import {
  UPDATE_WEB_MAX_UPLOAD_BYTES,
  UpdateWebComment,
  UpdateWebPost,
  UpdateWebPostReactionSummary,
  UpdateWebReactionEmoji,
} from "@/type/update-web";

const POST_SELECT = "*, created_by_profile:profiles(nama, email)";
const BUCKET = "update-web";

export interface UpdateWebViewer {
  userId: string;
  nama: string | null;
  isPublisher: boolean;
}

// User login + apakah boleh publish (moderator DAN it, sama dengan
// is_update_web_publisher() di DB). null kalau belum login.
export async function fetchUpdateWebViewer(): Promise<UpdateWebViewer | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("nama, roles:user_roles(roles(name))")
    .eq("id", user.id)
    .single();

  const roleNames: string[] = ((profile?.roles as any[]) ?? [])
    .map((r) => r.roles?.name)
    .filter(Boolean);

  return {
    userId: user.id,
    nama: profile?.nama ?? null,
    isPublisher: roleNames.includes("moderator") && roleNames.includes("it"),
  };
}

export async function fetchUpdateWebPosts(): Promise<UpdateWebPost[]> {
  const { data, error } = await createClient()
    .from("update_web_posts")
    .select(POST_SELECT)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as UpdateWebPost[];
}

export async function fetchUpdateWebPostById(
  id: number,
): Promise<UpdateWebPost> {
  const { data, error } = await createClient()
    .from("update_web_posts")
    .select(POST_SELECT)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as UpdateWebPost;
}

// Post terbaru - untuk badge "update baru" & banner dashboard.
export async function fetchLatestUpdateWebPost(): Promise<UpdateWebPost | null> {
  const { data, error } = await createClient()
    .from("update_web_posts")
    .select(POST_SELECT)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as UpdateWebPost) ?? null;
}

// Versi tertinggi (bukan post terbaru) - untuk preview "Otomatis (akan jadi
// vX.Y.Z)". Nomor final tetap dihitung server di create_update_web_post.
export async function fetchHighestUpdateWebVersion() {
  const { data, error } = await createClient()
    .from("update_web_posts")
    .select("version_major, version_minor, version_patch")
    .order("version_major", { ascending: false })
    .order("version_minor", { ascending: false })
    .order("version_patch", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        major: data.version_major as number,
        minor: data.version_minor as number,
        patch: data.version_patch as number,
      }
    : null;
}

// Semua reaction untuk sekumpulan post dalam 1 query, lalu diagregasi per
// emoji di JS (volume reaction app internal kecil).
export async function fetchUpdateWebPostReactions(
  postIds: number[],
  currentUserId: string | null,
): Promise<Map<number, UpdateWebPostReactionSummary[]>> {
  const result = new Map<number, UpdateWebPostReactionSummary[]>();
  if (postIds.length === 0) return result;

  const { data, error } = await createClient()
    .from("update_web_post_reactions")
    .select("post_id, emoji, user:profiles(id, nama)")
    .in("post_id", postIds)
    .order("created_at", { ascending: true });
  if (error) throw error;

  for (const row of (data ?? []) as any[]) {
    const list = result.get(row.post_id) ?? [];
    const reactor = { id: row.user?.id ?? "", nama: row.user?.nama ?? null };
    const existing = list.find((s) => s.emoji === row.emoji);
    if (existing) {
      existing.count += 1;
      existing.reactors.push(reactor);
      if (reactor.id === currentUserId) existing.reactedByMe = true;
    } else {
      list.push({
        emoji: row.emoji,
        count: 1,
        reactedByMe: reactor.id === currentUserId,
        reactors: [reactor],
      });
    }
    result.set(row.post_id, list);
  }

  return result;
}

// Ganti reaction milik sendiri - emoji null = hapus. Selalu delete dulu lalu
// insert, karena unique (post_id, user_id): ganti emoji = ganti baris.
export async function setUpdateWebPostReaction(
  postId: number,
  userId: string,
  emoji: UpdateWebReactionEmoji | null,
): Promise<void> {
  const supabase = createClient();
  const { error: deleteError } = await supabase
    .from("update_web_post_reactions")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  if (emoji) {
    const { error: insertError } = await supabase
      .from("update_web_post_reactions")
      .insert({ post_id: postId, user_id: userId, emoji });
    if (insertError) throw insertError;
  }
}

export async function fetchUpdateWebSeenState(
  userId: string,
): Promise<number | null> {
  const { data, error } = await createClient()
    .from("update_web_seen")
    .select("last_seen_post_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.last_seen_post_id ?? null;
}

export async function markUpdateWebSeen(
  userId: string,
  postId: number,
): Promise<void> {
  const { error } = await createClient().from("update_web_seen").upsert({
    user_id: userId,
    last_seen_post_id: postId,
    last_seen_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export interface UpdateWebPostPayload {
  title: string;
  thumbnail_url: string | null;
  highlights: string[];
  content: Record<string, unknown>;
}

// version null = otomatis (patch +1, dihitung atomic di server).
export async function createUpdateWebPost(
  payload: UpdateWebPostPayload & { version: string | null },
): Promise<UpdateWebPost> {
  const { data, error } = await createClient().rpc("create_update_web_post", {
    p_title: payload.title,
    p_thumbnail_url: payload.thumbnail_url,
    p_highlights: payload.highlights,
    p_content: payload.content,
    p_version: payload.version,
  });
  if (error) throw error;
  return data as UpdateWebPost;
}

export async function updateUpdateWebPost(
  id: number,
  payload: UpdateWebPostPayload & {
    version_major: number;
    version_minor: number;
    version_patch: number;
  },
): Promise<void> {
  const { data, error } = await createClient()
    .from("update_web_posts")
    .update(payload)
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23505") {
      throw new Error("Versi tersebut sudah dipakai postingan lain.");
    }
    throw error;
  }
  // RLS menolak update secara diam-diam (0 baris), bukan error.
  if (!data?.length) {
    throw new Error("Tidak punya akses atau postingan sudah dihapus.");
  }
}

export async function deleteUpdateWebPost(id: number): Promise<void> {
  const { data, error } = await createClient()
    .from("update_web_posts")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data?.length) {
    throw new Error("Tidak punya akses atau postingan sudah dihapus.");
  }
}

// `replyTo` = komentar yang dibalas, cukup user_id + timestamp aslinya; nama &
// kutipan diambil server. Server juga mengirim notifikasi ke pemiliknya.
// p_reply_to HANYA dikirim kalau memang membalas, supaya komentar biasa tetap
// jalan di DB yang belum menerima migration reply.
export async function addUpdateWebPostComment(
  id: number,
  message: string,
  replyTo?: Pick<UpdateWebComment, "user_id" | "timestamp"> | null,
): Promise<void> {
  const { error } = await createClient().rpc("add_update_web_post_comment", {
    p_id: id,
    p_message: message,
    ...(replyTo
      ? {
          p_reply_to: {
            user_id: replyTo.user_id,
            timestamp: replyTo.timestamp,
          },
        }
      : {}),
  });
  if (error) throw error;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function getUpdateWebUploadSizeError(file: File): string | null {
  if (file.size <= UPDATE_WEB_MAX_UPLOAD_BYTES) return null;
  return `File "${file.name}" berukuran ${formatFileSize(file.size)}, melebihi batas ${formatFileSize(UPDATE_WEB_MAX_UPLOAD_BYTES)}.`;
}

// Upload ke bucket "update-web" lalu kembalikan public URL. `folder` mis.
// "thumbnails" atau "posts/12".
export async function uploadUpdateWebMedia(
  file: File | Blob,
  folder: string,
  fileName: string,
): Promise<string> {
  const supabase = createClient();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `${folder}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) {
    if (/fetch|network/i.test(error.message)) {
      throw new Error(
        "Koneksi terputus atau file terlalu besar. Periksa koneksi lalu coba lagi.",
      );
    }
    throw error;
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

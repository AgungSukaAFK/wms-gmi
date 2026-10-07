// Type fitur "Update Web" (changelog/pengumuman aplikasi) - lihat
// supabase/migrations/20260930110000_update_web.sql & services/update-web-client.ts.

// Snapshot komentar yang dibalas - dibangun server dari komentar asli
// (lihat migration 20261005110000_update_web_comment_reply.sql).
export interface UpdateWebCommentReplyRef {
  user_id: string;
  user_name: string;
  timestamp: string;
  excerpt: string;
}

export interface UpdateWebComment {
  user_id: string;
  user_name: string;
  message: string;
  timestamp: string;
  reply_to?: UpdateWebCommentReplyRef;
}

export interface UpdateWebPost {
  id: number;
  version: string; // "1.4.2", generated column
  version_major: number;
  version_minor: number;
  version_patch: number;
  title: string;
  thumbnail_url: string | null;
  highlights: string[];
  content: Record<string, unknown>; // Tiptap JSON doc
  comments: UpdateWebComment[];
  created_by: string | null;
  created_by_profile?: { nama: string | null; email: string | null } | null;
  created_at: string;
  updated_at: string;
}

// HARUS sama dengan CHECK constraint update_web_post_reactions.emoji di DB.
export const UPDATE_WEB_REACTION_EMOJIS = [
  "👍",
  "❤️",
  "🎉",
  "😂",
  "😮",
  "🙏",
] as const;

export type UpdateWebReactionEmoji =
  (typeof UPDATE_WEB_REACTION_EMOJIS)[number];

export interface UpdateWebReactor {
  id: string;
  nama: string | null;
}

// Agregasi reaction per emoji untuk 1 post. 1 user cuma boleh 1 emoji aktif
// per post, jadi `reactedByMe` paling banyak true di satu summary.
export interface UpdateWebPostReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  reactors: UpdateWebReactor[];
}

export type UpdateWebVersion = { major: number; minor: number; patch: number };

// Thumbnail sementara disembunyikan (form, card, detail). Kolom
// thumbnail_url & bucket tetap ada; set true untuk menampilkan lagi.
export const UPDATE_WEB_THUMBNAIL_ENABLED = false;

// Samakan dengan file_size_limit bucket "update-web" di migration.
export const UPDATE_WEB_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

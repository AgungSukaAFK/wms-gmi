// Komentar teks sederhana untuk 1 postingan Update Web - daftar komentar +
// textarea, plus "Balas" per komentar. Controlled: persist dilakukan caller
// lewat `onSubmit` (RPC add_update_web_post_comment, yang juga mengirim
// notifikasi ke pemilik komentar yang dibalas), lalu caller merender ulang
// `comments`.

"use client";

import { useRef, useState } from "react";
import { CornerDownRight, Loader2, MessageSquare, Reply, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { UpdateWebComment } from "@/type/update-web";

const MAX_LENGTH = 2000;

interface UpdatePostCommentsProps {
  comments: UpdateWebComment[];
  currentUserId: string | null;
  onSubmit: (message: string, replyTo: UpdateWebComment | null) => Promise<void>;
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

// Timestamp dibandingkan sebagai waktu (milidetik), bukan string - sama
// dengan pencocokan di RPC.
function isSameComment(
  c: Pick<UpdateWebComment, "user_id" | "timestamp">,
  ref: Pick<UpdateWebComment, "user_id" | "timestamp">,
) {
  return (
    c.user_id === ref.user_id &&
    new Date(c.timestamp).getTime() === new Date(ref.timestamp).getTime()
  );
}

function excerpt(text: string, max = 120) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function UpdatePostComments({
  comments,
  currentUserId,
  onSubmit,
}: UpdatePostCommentsProps) {
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<UpdateWebComment | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const handleSubmit = async () => {
    const text = message.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(text, replyTo);
      setMessage("");
      setReplyTo(null);
    } catch (error: any) {
      toast.error("Gagal mengirim komentar", { description: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  const startReply = (c: UpdateWebComment) => {
    setReplyTo(c);
    textareaRef.current?.focus();
  };

  const jumpTo = (ref: Pick<UpdateWebComment, "user_id" | "timestamp">) => {
    const index = comments.findIndex((c) => isSameComment(c, ref));
    const el = itemRefs.current[index];
    if (index < 0 || !el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashIndex(index);
    window.setTimeout(
      () => setFlashIndex((cur) => (cur === index ? null : cur)),
      1500,
    );
  };

  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="h-4 w-4" /> Komentar ({comments.length})
      </h3>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada komentar.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c, i) => {
            const mine = c.user_id === currentUserId;
            return (
              <li
                key={`${c.timestamp}-${i}`}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className="flex gap-3"
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    mine
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {initials(c.user_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "rounded-lg bg-muted/50 px-3 py-2 transition-colors duration-500",
                      flashIndex === i && "bg-primary/15",
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">
                        {c.user_name}
                        {mine && (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            (Anda)
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(c.timestamp).toLocaleString("id-ID", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {c.reply_to && (
                      <button
                        type="button"
                        onClick={() => jumpTo(c.reply_to!)}
                        className="mt-1 flex w-full min-w-0 items-start gap-1.5 rounded border-l-2 border-primary/60 bg-background/60 px-2 py-1 text-left text-xs text-muted-foreground hover:bg-background"
                        title="Lihat komentar yang dibalas"
                      >
                        <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="min-w-0">
                          <span className="font-medium text-foreground">
                            {c.reply_to.user_name}
                          </span>
                          : <span className="break-words">{c.reply_to.excerpt}</span>
                        </span>
                      </button>
                    )}
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                      {c.message}
                    </p>
                  </div>
                  {currentUserId && (
                    <button
                      type="button"
                      onClick={() => startReply(c)}
                      className="mt-1 inline-flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Reply className="h-3 w-3" /> Balas
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2">
        {replyTo && (
          <div className="flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/50 px-3 py-2 text-xs">
            <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Membalas {replyTo.user_name}
                {replyTo.user_id === currentUserId ? " (Anda)" : ""}
              </div>
              <div className="break-words text-muted-foreground">
                {excerpt(replyTo.message)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Batal membalas"
              disabled={submitting}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
          placeholder={
            replyTo
              ? `Balas ${replyTo.user_name}... (Ctrl+Enter untuk kirim)`
              : "Tulis komentar... (Ctrl+Enter untuk kirim)"
          }
          rows={3}
          disabled={submitting}
          aria-label="Tulis komentar"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSubmit();
            } else if (e.key === "Escape" && replyTo) {
              // Jangan sampai Esc menutup modal saat cuma mau batal balas.
              e.preventDefault();
              e.stopPropagation();
              setReplyTo(null);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {message.length}/{MAX_LENGTH}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !message.trim()}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Kirim
          </Button>
        </div>
      </div>
    </section>
  );
}

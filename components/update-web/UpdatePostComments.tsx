// Komentar teks sederhana untuk 1 postingan Update Web - daftar komentar +
// textarea. Controlled: persist dilakukan caller lewat `onSubmit` (RPC
// add_update_web_post_comment), lalu caller merender ulang `comments`.

"use client";

import { useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { UpdateWebComment } from "@/type/update-web";

const MAX_LENGTH = 2000;

interface UpdatePostCommentsProps {
  comments: UpdateWebComment[];
  currentUserId: string | null;
  onSubmit: (message: string) => Promise<void>;
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

export function UpdatePostComments({
  comments,
  currentUserId,
  onSubmit,
}: UpdatePostCommentsProps) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const text = message.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(text);
      setMessage("");
    } catch (error: any) {
      toast.error("Gagal mengirim komentar", { description: error.message });
    } finally {
      setSubmitting(false);
    }
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
              <li key={`${c.timestamp}-${i}`} className="flex gap-3">
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
                <div className="min-w-0 flex-1 rounded-lg bg-muted/50 px-3 py-2">
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
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                    {c.message}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
          placeholder="Tulis komentar... (Ctrl+Enter untuk kirim)"
          rows={3}
          disabled={submitting}
          aria-label="Tulis komentar"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSubmit();
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

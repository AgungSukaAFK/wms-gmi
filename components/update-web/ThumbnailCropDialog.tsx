// Dialog pilih & crop thumbnail Update Web ke 16:9, output 1280x720 JPEG.
// `initialFile` diisi kalau gambar sudah didapat dari drag & drop / paste;
// null berarti user memilih file di dalam dialog. `onSave` melakukan upload,
// dan error-nya ditampilkan di dialog (dialog tetap terbuka).

"use client";

import { useEffect, useRef, useState } from "react";
import Cropper, { Area } from "react-easy-crop";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";

const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

// Baca gambar dari clipboard (tombol "Tempel"). Butuh izin clipboard-read.
export async function readImageFromClipboard(): Promise<File | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) {
        const blob = await item.getType(type);
        return new File([blob], `clipboard.${type.split("/")[1]}`, { type });
      }
    }
    toast.error("Clipboard tidak berisi gambar.");
  } catch {
    toast.error("Tidak bisa membaca clipboard", {
      description: "Coba tekan Ctrl+V di area thumbnail.",
    });
  }
  return null;
}

async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const image = new Image();
  image.src = src;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung canvas.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT,
  );

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Gagal memproses gambar.")),
      "image/jpeg",
      0.88,
    ),
  );
}

interface ThumbnailCropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFile: File | null;
  onSave: (blob: Blob) => Promise<void>;
}

export function ThumbnailCropDialog({
  open,
  onOpenChange,
  initialFile,
  onSave,
}: ThumbnailCropDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("Ukuran gambar maksimal 10 MB.");
      return;
    }
    setError(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  useEffect(() => {
    if (open && initialFile) loadFile(initialFile);
    if (!open) {
      setSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setError(null);
    }
  }, [open, initialFile]);

  const handleSave = async () => {
    if (!src || !area) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await cropToBlob(src, area));
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message ?? "Gagal mengunggah thumbnail.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {src ? "Sesuaikan Thumbnail" : "Pilih Thumbnail"}
          </DialogTitle>
          <DialogDescription>
            Gambar maksimal 10 MB. Hasil akhir berasio 16:9 (1280×720).
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) loadFile(file);
          }}
        />

        {src ? (
          <div className="space-y-4">
            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={16 / 9}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Zoom</span>
              <Slider
                value={[zoom]}
                min={1}
                max={3}
                step={0.05}
                onValueChange={([v]) => setZoom(v)}
                aria-label="Zoom"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={saving}
              >
                Ganti gambar
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/25 text-sm text-muted-foreground hover:border-primary/50 hover:bg-muted/40"
          >
            <ImagePlus className="h-6 w-6" />
            Klik untuk memilih gambar
          </button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Batal
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!src || !area || saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Pakai Thumbnail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

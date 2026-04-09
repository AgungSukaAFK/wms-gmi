"use client";

import React, { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { RotateCcw, RotateCw, ZoomIn } from "lucide-react";

interface SignatureEditorProps {
  image: string;
  onCropComplete: (croppedImage: Blob) => void;
  onCancel: () => void;
}

export function SignatureEditor({ image, onCropComplete, onCancel }: SignatureEditorProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState(2 / 1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const onCropChange = (crop: { x: number; y: number }) => {
    setCrop(crop);
  };

  const onZoomChange = (zoom: number) => {
    setZoom(zoom);
  };

  const onRotationChange = (rotation: number) => {
    setRotation(rotation);
  };

  const resetAdjustments = () => {
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    setRotation(0);
  };

  const onCropCompleteInternal = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const createImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(image));
      image.addEventListener("error", (error) => reject(error));
      image.setAttribute("crossOrigin", "anonymous");
      image.src = url;
    });

  const rotateSize = (width: number, height: number, rotation: number) => {
    const rotRad = (rotation * Math.PI) / 180;
    return {
      width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
      height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
    };
  };

  const getCroppedImg = async () => {
    try {
      const img = await createImage(image);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) return;

      const rotRad = (rotation * Math.PI) / 180;

      // 1. Hitung ukuran bounding box setelah rotasi
      const { width: bBoxWidth, height: bBoxHeight } = rotateSize(img.width, img.height, rotation);

      // 2. Set ukuran kanvas pertama ke bounding box tersebut
      canvas.width = bBoxWidth;
      canvas.height = bBoxHeight;

      // 3. Gambar gambar asli yang sudah diputar ke kanvas pertama
      ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
      ctx.rotate(rotRad);
      ctx.translate(-img.width / 2, -img.height / 2);
      ctx.drawImage(img, 0, 0);

      // 4. Buat kanvas kedua khusus untuk hasil potong (cropping)
      const croppedCanvas = document.createElement("canvas");
      const croppedCtx = croppedCanvas.getContext("2d");

      if (!croppedCtx) return;

      croppedCanvas.width = croppedAreaPixels.width;
      croppedCanvas.height = croppedAreaPixels.height;

      // 5. Ambil bagian dari kanvas pertama dan gambar ke kanvas kedua
      // Metode drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) sangat akurat
      croppedCtx.drawImage(
        canvas,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        croppedAreaPixels.width,
        croppedAreaPixels.height
      );

      return new Promise<Blob>((resolve) => {
        croppedCanvas.toBlob((file) => {
          if (file) resolve(file);
        }, "image/png");
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDone = async () => {
    const croppedBlob = await getCroppedImg();
    if (croppedBlob) {
      onCropComplete(croppedBlob);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-lg overflow-hidden border shadow-inner">
      <div className="relative h-[400px] w-full bg-slate-900">
        <Cropper
          image={image}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          onCropChange={onCropChange}
          onCropComplete={onCropCompleteInternal}
          onZoomChange={onZoomChange}
          minZoom={0.1}
          maxZoom={5}
        />
      </div>

      <div className="p-4 space-y-4 bg-white border-t">
        {/* Aspect Ratio Presets */}
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Rasio Bingkai</span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "1:1", val: 1 / 1 },
              { label: "3:2", val: 3 / 2 },
              { label: "2:1", val: 2 / 1 },
              { label: "3:1", val: 3 / 1 },
              { label: "4:1", val: 4 / 1 },
            ].map((ratio) => (
              <Button
                key={ratio.label}
                variant={aspect === ratio.val ? "default" : "outline"}
                size="sm"
                className="text-[10px] h-6 px-2.5"
                onClick={() => setAspect(ratio.val)}
              >
                {ratio.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium flex items-center gap-2 text-slate-600">
                <ZoomIn className="h-3 w-3" /> Zoom
              </span>
              <span className="text-[10px] text-slate-400 font-mono">{Math.round(zoom * 100)}%</span>
            </div>
            <Slider
              value={[zoom]}
              min={0.1}
              max={3}
              step={0.05}
              onValueChange={(val: number[]) => setZoom(val[0])}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium flex items-center gap-2 text-slate-600">
                <RotateCw className="h-3 w-3" /> Rotation
              </span>
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1 text-blue-600" onClick={resetAdjustments}>
                <RotateCcw className="h-3 w-3 mr-1" /> Reset All
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Slider
                className="flex-1"
                value={[rotation]}
                min={0}
                max={360}
                step={1}
                onValueChange={(val: number[]) => setRotation(val[0])}
              />
              <span className="text-[10px] text-slate-400 w-8 font-mono">{rotation}°</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="ghost" onClick={onCancel}>Batal</Button>
          <Button onClick={handleDone} className="bg-blue-600 hover:bg-blue-700 text-white shadow-md">
            Selesai Potong
          </Button>
        </div>
      </div>
    </div>
  );
}

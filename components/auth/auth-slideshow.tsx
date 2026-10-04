"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Arah gerak Ken Burns (kbFrom → kbTo) & titik fokus foto disetel per slide.
const SLIDES = [
  { src: "/slide2.webp", alt: "Excavator Komatsu PC3000 di area tambang", kbFrom: "-2%, 1%", kbTo: "2%, -1%", position: "50% 55%" },
  { src: "/slide.webp", alt: "Smart Power Management Controller Lourdes Auto Parts", kbFrom: "1%, 1%", kbTo: "-2%, -2%", position: "60% 40%" },
  { src: "/slide3.webp", alt: "Tim lapangan di depan alat berat Komatsu", kbFrom: "2%, 0%", kbTo: "-2%, 1%", position: "50% 60%" },
  { src: "/slide4.webp", alt: "Pemasangan lampu kerja pada kabin excavator", kbFrom: "0%, 2%", kbTo: "-1%, -2%", position: "50% 40%" },
  { src: "/slide5.webp", alt: "Teknisi memasang perangkat di kabin unit baru", kbFrom: "-1%, -1%", kbTo: "2%, 1%", position: "50% 45%" },
  { src: "/slide6.webp", alt: "Instalasi perangkat di atap kabin, area yard unit", kbFrom: "2%, -1%", kbTo: "-1%, 1%", position: "50% 50%" },
];

const INTERVAL_MS = 6000; // tiap slide tampil 6 detik
const FADE_MS = 1400; // durasi crossfade

export function AuthSlideshow({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  // Slide sebelumnya tetap dianimasikan selama fade-out supaya tidak "loncat".
  const [prev, setPrev] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);

  // Jeda rotasi saat tab tidak aktif agar tidak melompati beberapa slide sekaligus.
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setPrev(index);
      setIndex((index + 1) % SLIDES.length);
    }, INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [index, visible]);

  useEffect(() => {
    if (prev === null) return;
    const timer = setTimeout(() => setPrev(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [prev]);

  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      {SLIDES.map((slide, i) => {
        const active = i === index;
        const animated = active || i === prev;
        return (
          <div
            key={slide.src}
            className={cn(
              "absolute inset-0 transition-opacity ease-in-out",
              active ? "opacity-100" : "opacity-0",
            )}
            style={{ transitionDuration: `${FADE_MS}ms` }}
          >
            <Image
              src={slide.src}
              alt=""
              fill
              priority={i === 0}
              sizes="(min-width: 1024px) 60vw, 100vw"
              className={cn("object-cover", animated && "auth-kenburns")}
              style={
                {
                  objectPosition: slide.position,
                  "--kb-from": slide.kbFrom,
                  "--kb-to": slide.kbTo,
                  "--kb-duration": `${INTERVAL_MS + FADE_MS * 2}ms`,
                } as React.CSSProperties
              }
            />
          </div>
        );
      })}
      {/* Overlay agar teks & form selalu terbaca di atas foto */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/55 to-slate-950/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/60 via-transparent to-transparent" />
    </div>
  );
}

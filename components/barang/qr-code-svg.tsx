"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

interface QrCodeSvgProps {
  value: string;
  className?: string;
}

// Render QR code (isi part_number) sebagai SVG hitam-putih murni yang scale
// mengikuti ukuran container — dipakai baik di preview dialog maupun
// berulang kali di halaman cetak (satu sticker = satu instance).
export function QrCodeSvg({ value, className }: QrCodeSvgProps) {
  const [svgMarkup, setSvgMarkup] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSvgMarkup("");
      return;
    }

    QRCode.toString(value, {
      type: "svg",
      margin: 0,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((svg) => {
        if (cancelled) return;
        // Library tidak menaruh width/height/style di root <svg>, jadi
        // defaultnya 300x150px — paksa isi 100% container lewat style inline.
        setSvgMarkup(
          svg.replace(
            "<svg ",
            '<svg style="width:100%;height:100%;display:block" ',
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setSvgMarkup("");
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}

// src/hooks/use-url-search-input.ts
//
// State kotak pencarian yang disinkronkan ke query string URL (?search=...)
// dengan debounce.
//
// Kenapa tidak pakai pola `useState(searchTerm)` + useEffect yang push kalau
// `searchInput !== searchTerm`? Karena waktu URL berubah dari LUAR (tombol
// Back/Forward browser, reset filter), `searchInput` tidak ikut berubah, lalu
// efeknya push ulang URL lama secara otomatis. Akibatnya Back user "dibatalkan",
// history forward hilang, dan - karena push itu terjadi tanpa interaksi user -
// Chrome menandai entri history-nya "skippable" sehingga Back berikutnya
// melompati halaman (A -> B -> C, Back malah ke A).
//
// Aturan hook ini:
// - Push ke URL HANYA terjadi dari ketikan user (onChange), setelah debounce.
// - Kalau URL berubah dari luar, nilai input mengikuti URL (tanpa push),
//   kecuali user sedang mengetik (debounce masih menunggu).

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useUrlSearchInput(
  urlValue: string,
  onCommit: (value: string) => void,
  delay = 500,
) {
  const [value, setValue] = useState(urlValue);
  // true selama debounce masih menunggu (user sedang mengetik).
  const [typing, setTyping] = useState(false);
  const [prevUrlValue, setPrevUrlValue] = useState(urlValue);
  const timerRef = useRef<number | null>(null);
  const urlValueRef = useRef(urlValue);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  // URL berubah dari luar -> input mengikuti, kecuali user sedang mengetik.
  // (Disesuaikan saat render, bukan di effect, supaya tidak render dua kali.)
  if (urlValue !== prevUrlValue) {
    setPrevUrlValue(urlValue);
    if (!typing) setValue(urlValue);
  }

  useEffect(() => {
    urlValueRef.current = urlValue;
  }, [urlValue]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** Dipanggil dari onChange input - satu-satunya jalur yang boleh push ke URL. */
  const onChange = useCallback(
    (next: string) => {
      setValue(next);
      setTyping(true);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setTyping(false);
        if (next !== urlValueRef.current) onCommitRef.current(next);
      }, delay);
    },
    [delay],
  );

  /** Reset tanpa push (mis. tombol "Reset filter" yang sudah navigasi sendiri). */
  const reset = useCallback((next = "") => {
    clearTimer();
    setTyping(false);
    setValue(next);
  }, []);

  return [value, onChange, reset] as const;
}

// src/hooks/use-column-order.ts
//
// Urutan kolom tabel list yang bisa diatur user dengan menggeser header
// (components/reorderable-table-head.tsx). Disimpan di localStorage per
// tabel, jadi berlaku per browser - tidak ikut pindah device.
//
// Isi storage selalu dicocokkan ulang dengan daftar kolom di kode: id yang
// sudah tidak ada dibuang, kolom baru disisipkan di posisi bawaannya. Jadi
// menambah / menghapus kolom tidak perlu migrasi storage. Kalau urutannya
// kembali sama dengan bawaan, storage dihapus supaya perubahan urutan bawaan
// di kode nantinya ikut berlaku.

"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// Cadangan kalau storage tidak tersedia (mis. private mode) - cukup berlaku
// di sesi ini.
const memoryOrders = new Map<string, string | null>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Event `storage` = perubahan dari tab lain.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRawOrder(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryOrders.get(key) ?? null;
  }
}

function writeStoredOrder(key: string, order: string[] | null) {
  const raw = order ? JSON.stringify(order) : null;
  memoryOrders.set(key, raw);
  try {
    if (raw) window.localStorage.setItem(key, raw);
    else window.localStorage.removeItem(key);
  } catch {
    // Sudah tersimpan di memoryOrders.
  }
  listeners.forEach((listener) => listener());
}

function parseOrder(raw: string | null) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : null;
  } catch {
    return null;
  }
}

function reconcileOrder<Id extends string>(
  stored: string[],
  defaults: readonly Id[],
): Id[] {
  const known = new Set<string>(defaults);
  const result = [...new Set(stored)].filter((id): id is Id => known.has(id));
  defaults.forEach((id, i) => {
    if (!result.includes(id)) result.splice(Math.min(i, result.length), 0, id);
  });
  return result;
}

function isSameOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function useColumnOrder<C extends { id: string }>(
  storageKey: string,
  // Harus referensi stabil (konstanta di luar komponen).
  columns: readonly C[],
) {
  type Id = C["id"];
  const defaultOrder = useMemo(() => columns.map((c) => c.id as Id), [columns]);

  // Snapshot server = null, jadi render server & client pertama sama.
  const raw = useSyncExternalStore(
    subscribe,
    () => readRawOrder(storageKey),
    () => null,
  );
  const order = useMemo(() => {
    const stored = parseOrder(raw);
    return stored ? reconcileOrder(stored, defaultOrder) : defaultOrder;
  }, [raw, defaultOrder]);

  // Pindahkan `from` ke posisi `to`: digeser ke kanan -> jatuh setelah `to`,
  // ke kiri -> sebelum `to`.
  const moveColumn = useCallback(
    (from: string, to: string) => {
      const fromIndex = order.indexOf(from as Id);
      const toIndex = order.indexOf(to as Id);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      const next = [...order];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from as Id);
      writeStoredOrder(
        storageKey,
        isSameOrder(next, defaultOrder) ? null : next,
      );
    },
    [order, storageKey, defaultOrder],
  );

  const resetOrder = useCallback(() => {
    writeStoredOrder(storageKey, null);
  }, [storageKey]);

  const orderedColumns = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    return order.map((id) => byId.get(id)!);
  }, [columns, order]);

  return {
    order,
    orderedColumns,
    moveColumn,
    resetOrder,
    isCustomOrder: !isSameOrder(order, defaultOrder),
  };
}

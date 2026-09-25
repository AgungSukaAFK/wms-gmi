"use client";

import { useCallback, useEffect, useState } from "react";
import type { SoundPresetId } from "@/lib/notifications/sound";

export type NotifSettings = {
  enabled: boolean; // master switch - matiin ini, suara/browser notif/toast semua berhenti (badge & DB tetap jalan)
  sound: boolean;
  volume: number; // 0..1
  soundType: SoundPresetId;
  browser: boolean; // toggle OS-level Notification API
};

export const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  enabled: true,
  sound: true,
  volume: 0.6,
  soundType: "tritone",
  browser: true,
};

const STORAGE_KEY = "wms-notif-settings";
const SYNC_EVENT = "wms-notif-settings-changed";

function readSettings(): NotifSettings {
  if (typeof window === "undefined") return DEFAULT_NOTIF_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIF_SETTINGS;
    return { ...DEFAULT_NOTIF_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_NOTIF_SETTINGS;
  }
}

function writeSettings(settings: NotifSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: settings }));
  } catch {
    // localStorage bisa gagal (private mode/quota) - abaikan, setting cuma preferensi lokal
  }
}

export function useNotifSettings() {
  const [settings, setSettings] = useState<NotifSettings>(DEFAULT_NOTIF_SETTINGS);

  useEffect(() => {
    setSettings(readSettings());

    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<NotifSettings>).detail;
      if (detail) setSettings(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSettings(readSettings());
    };

    window.addEventListener(SYNC_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<NotifSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeSettings(next);
      return next;
    });
  }, []);

  return { settings, updateSettings };
}

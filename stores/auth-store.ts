import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ProfileWithRoles } from '@/type';

interface AuthState {
  profile: ProfileWithRoles | null;
  permissions: string[]; // Array page_path yang boleh diakses user
  lastLoginDate: string | null; // Format 'YYYY-MM-DD'

  setSession: (profile: ProfileWithRoles, permissions: string[]) => void;
  clearSession: () => void;
  isNewDay: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      profile: null,
      permissions: [],
      lastLoginDate: null,

      setSession: (profile, permissions) => {
        // Gunakan local date string (sv-SE = YYYY-MM-DD)
        const today = new Date().toLocaleDateString('sv-SE'); 
        set({ profile, permissions, lastLoginDate: today });
      },

      clearSession: () => {
        set({ profile: null, permissions: [], lastLoginDate: null });
      },

      isNewDay: () => {
        const { lastLoginDate } = get();
        if (!lastLoginDate) return false; // Belum ada session, bukan ganti hari
        const today = new Date().toLocaleDateString('sv-SE');
        return lastLoginDate !== today;
      },
    }),
    {
      name: 'wms-auth-session', // key di localStorage
      storage: createJSONStorage(() => localStorage),
    }
  )
);

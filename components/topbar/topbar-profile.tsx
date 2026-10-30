"use client";

// Menu profil di top bar - isinya sama dgn NavUser di bawah sidebar
// (My Profile, Log out).

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, SquareUserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import { getInitials } from "@/lib/utils";
import type { TopbarProfileData } from "./topbar";

function ProfileAvatar({
  displayName,
  className,
}: {
  displayName: string;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
        {getInitials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

export function TopbarProfile({
  profile,
}: {
  profile: TopbarProfileData | null;
}) {
  const router = useRouter();
  const [logoutDialog, setLogoutDialog] = useState(false);

  if (!profile) return <Skeleton className="size-8 shrink-0 rounded-full sm:size-9" />;

  const displayName = profile.nama || profile.email;

  async function handleLogout() {
    await createClient().auth.signOut();
    useAuthStore.getState().clearSession();
    router.push("/auth/login");
  }

  return (
    <>
      <ConfirmDialog
        open={logoutDialog}
        onOpenChange={setLogoutDialog}
        title="Keluar dari aplikasi?"
        description="Anda perlu login lagi untuk masuk."
        confirmText="Log out"
        destructive
        onConfirm={handleLogout}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Menu profil"
            className="flex items-center gap-2 rounded-full p-0.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent lg:pr-2.5"
          >
            <ProfileAvatar
              displayName={displayName}
              className="size-8 sm:size-9"
            />
            <span className="hidden max-w-32 truncate text-sm font-medium lg:block">
              {profile.nama || "-"}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="w-[min(15rem,calc(100vw-1rem))] rounded-lg"
        >
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <ProfileAvatar
                displayName={displayName}
                className="size-8 rounded-lg"
              />
              <div className="grid flex-1 leading-tight">
                <span className="truncate font-medium">
                  {profile.nama || "-"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {profile.email}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <SquareUserRound />
                My Profile
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:text-destructive dark:text-red-400 dark:focus:bg-red-950/40 dark:focus:text-red-300 dark:[&_svg]:text-red-400"
            onSelect={() => setLogoutDialog(true)}
          >
            <LogOut />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

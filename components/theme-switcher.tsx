"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CloudMoon, Laptop, Moon, Sun, SunDim } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { runViewTransition } from "@/lib/view-transition";

export const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "soft-light", label: "Soft Light", icon: SunDim },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "soft-dark", label: "Soft Dark", icon: CloudMoon },
  { value: "system", label: "System", icon: Laptop },
] as const;

const subscribeNoop = () => () => {};

const ThemeSwitcher = () => {
  // Tema baru diketahui di client - sebelum mount jangan render apa pun.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const { theme, setTheme } = useTheme();

  if (!mounted) {
    return null;
  }

  const ICON_SIZE = 16;
  const ActiveIcon =
    THEME_OPTIONS.find((o) => o.value === theme)?.icon ?? Laptop;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={"sm"}>
          <ActiveIcon
            key={theme}
            size={ICON_SIZE}
            className={"text-muted-foreground"}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-content" align="start">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(e) => runViewTransition(() => setTheme(e))}
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              className="flex gap-2"
              value={value}
            >
              <Icon size={ICON_SIZE} className="text-muted-foreground" />{" "}
              <span>{label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { ThemeSwitcher };

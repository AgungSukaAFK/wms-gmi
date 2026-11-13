import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tipe input yang memang boleh diisi otomatis oleh browser
 * (selama pemanggil memberi `autoComplete` secara eksplisit, mis. form login).
 */
const CREDENTIAL_TYPES = new Set(["email", "password"]);

/**
 * Atribut agar password manager (Chrome, 1Password, LastPass, Bitwarden, dll.)
 * tidak menganggap input biasa sebagai field username/email.
 */
const IGNORE_PASSWORD_MANAGER_PROPS = {
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

/**
 * Default `autoComplete` bila pemanggil tidak menentukan:
 * - password → "new-password": browser tidak mengisi password tersimpan dan
 *   tidak mencari "field username" di sekitarnya (penyebab email ter-isi ke
 *   search bar / search sidebar saat dialog password signature dibuka).
 * - selain itu → "off".
 * Form login/sign-up tetap bisa autofill karena memberi `autoComplete` eksplisit.
 */
function defaultAutoComplete(type: string | undefined) {
  return type === "password" ? "new-password" : "off";
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, autoComplete, ...props }, ref) => {
    const explicit = autoComplete !== undefined;
    const ignoreManager = !explicit && !CREDENTIAL_TYPES.has(type ?? "text");

    return (
      <input
        type={type}
        autoComplete={explicit ? autoComplete : defaultAutoComplete(type)}
        {...(ignoreManager ? IGNORE_PASSWORD_MANAGER_PROPS : {})}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

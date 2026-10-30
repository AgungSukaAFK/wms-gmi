"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  // Tema soft-* tidak dikenal sonner -> petakan ke terang/gelap.
  const { resolvedTheme } = useTheme()
  const theme: ToasterProps["theme"] = resolvedTheme?.endsWith("dark")
    ? "dark"
    : "light"

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

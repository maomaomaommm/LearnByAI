// Theme hook using localStorage and system preference
import { useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme") as Theme;
      return stored || "system";
    }
    return "system";
  });

  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = document.documentElement;
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

    const resolved = theme === "system" ? systemTheme : theme;
    setResolvedTheme(resolved);

    root.classList.remove("light", "dark");
    root.classList.add(resolved);

    // Update CSS variables for the theme
    if (resolved === "light") {
      root.style.setProperty("--background", "0 0% 100%");
      root.style.setProperty("--foreground", "0 0% 10%");
      root.style.setProperty("--card", "0 0% 100%");
      root.style.setProperty("--card-foreground", "0 0% 10%");
      root.style.setProperty("--popover", "0 0% 100%");
      root.style.setProperty("--popover-foreground", "0 0% 10%");
      root.style.setProperty("--primary", "0 0% 10%");
      root.style.setProperty("--primary-foreground", "0 0% 98%");
      root.style.setProperty("--secondary", "0 0% 96%");
      root.style.setProperty("--secondary-foreground", "0 0% 10%");
      root.style.setProperty("--muted", "0 0% 96%");
      root.style.setProperty("--muted-foreground", "0 0% 45%");
      root.style.setProperty("--accent", "0 0% 96%");
      root.style.setProperty("--accent-foreground", "0 0% 10%");
      root.style.setProperty("--border", "0 0% 90%");
      root.style.setProperty("--input", "0 0% 90%");
      root.style.setProperty("--ring", "0 0% 10%");
    } else {
      root.style.setProperty("--background", "0 0% 4%");
      root.style.setProperty("--foreground", "0 0% 95%");
      root.style.setProperty("--card", "0 0% 6%");
      root.style.setProperty("--card-foreground", "0 0% 95%");
      root.style.setProperty("--popover", "0 0% 6%");
      root.style.setProperty("--popover-foreground", "0 0% 95%");
      root.style.setProperty("--primary", "0 0% 95%");
      root.style.setProperty("--primary-foreground", "0 0% 4%");
      root.style.setProperty("--secondary", "0 0% 12%");
      root.style.setProperty("--secondary-foreground", "0 0% 95%");
      root.style.setProperty("--muted", "0 0% 12%");
      root.style.setProperty("--muted-foreground", "0 0% 60%");
      root.style.setProperty("--accent", "0 0% 12%");
      root.style.setProperty("--accent-foreground", "0 0% 95%");
      root.style.setProperty("--border", "0 0% 18%");
      root.style.setProperty("--input", "0 0% 18%");
      root.style.setProperty("--ring", "0 0% 80%");
    }

    localStorage.setItem("theme", theme);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return { theme, setTheme, resolvedTheme };
}

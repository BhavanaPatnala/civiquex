"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    // Dark is CiviqueX's signature look — every first-time visitor gets it,
    // regardless of OS preference. The toggle (top-right) is the only way to
    // switch to light, and that choice is remembered from then on.
    const stored = localStorage.getItem("civiquex-theme") as Theme | null;
    const initial = stored ?? "dark";
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  function setTheme(next: Theme) {
    setThemeState(next);
    applyTheme(next);
    localStorage.setItem("civiquex-theme", next);
  }

  return { theme, toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark") };
}

"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { eps } from "./eps";

type Theme = "light" | "dark";

/** The sun/moon pill. Theme lives on <html data-theme>, stored by motion.js under localStorage "eps.theme". */
export function ThemePill() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    document.addEventListener("eps:theme", read);
    return () => document.removeEventListener("eps:theme", read);
  }, []);
  function pick(t: Theme) {
    try {
      localStorage.setItem("eps.theme.chosen", "1"); // admin stops following the OS once the founder picks
    } catch {
      // storage blocked: the pick still applies to this page
    }
    const api = eps();
    if (api) api.theme.set(t);
    else {
      document.documentElement.setAttribute("data-theme", t);
      try {
        localStorage.setItem("eps.theme", t);
      } catch {
        // storage blocked: the theme still applies to this page
      }
    }
    setTheme(t);
  }
  return (
    <div className="theme-pill" role="group" aria-label="Theme">
      <button type="button" aria-label="Light" aria-pressed={theme === "light"} onClick={() => pick("light")}>
        <Icon name="sun" className="i-sm" />
      </button>
      <button type="button" aria-label="Dark" aria-pressed={theme === "dark"} onClick={() => pick("dark")}>
        <Icon name="moon" className="i-sm" />
      </button>
    </div>
  );
}

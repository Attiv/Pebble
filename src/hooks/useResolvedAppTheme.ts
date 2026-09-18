import { useEffect, useState } from "react";
import { resolveTheme, useUIStore } from "@/stores/ui.store";

/**
 * The app's light/dark mode, resolved and kept live.
 *
 * `resolveTheme` answers `"system"` by reading the OS preference, and the app
 * only re-applies the answer to the DOM — no store value changes — so a
 * component that asked once would keep whatever it was told at mount and never
 * hear about a switch. The message templates need it as a value rather than as a
 * CSS rule, because a fixed palette cannot switch itself: the colours it paints
 * with are literals, and the `[data-theme]` selector has nothing to grab.
 */
export function useResolvedAppTheme(): "light" | "dark" {
  const theme = useUIStore((state) => state.theme);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(theme));

  useEffect(() => {
    setResolved(resolveTheme(theme));
    if (theme !== "system") return;
    // Outside a browser (jsdom, a worker) there is nothing to listen to.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(resolveTheme("system"));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  return resolved;
}

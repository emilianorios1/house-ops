"use client";
import { useEffect } from "react";
import { SESSION_REFRESH_MS } from "@/lib/session-policy";
export function AppRuntime() {
  useEffect(() => {
    let inFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/auth/get-session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.ok && !(await response.json())?.user) {
          const month = new URL(location.href).searchParams.get("month");
          location.assign(
            month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
              ? `/login?month=${month}`
              : "/login",
          );
        }
      } catch {
        /* Keep the page usable during a temporary connection loss. */
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, SESSION_REFRESH_MS);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return null;
}

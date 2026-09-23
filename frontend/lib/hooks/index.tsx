"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";

import { fetcher } from "@/lib/api/client";
import type { Settings, User } from "@/types";

/** One shared 1-second clock, so hundreds of countdowns do not each run their own timer. */
const NowContext = createContext<number>(0);

export function NowProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export const useNow = () => useContext(NowContext) || Date.now();

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function useMe() {
  return useSWR<User>("/api/auth/me", fetcher, { shouldRetryOnError: false, revalidateOnFocus: false });
}

export function useSettings() {
  const swr = useSWR<Settings>("/api/settings", fetcher, { revalidateOnFocus: false });
  return { ...swr, timezone: swr.data?.timezone ?? "Asia/Jakarta" };
}

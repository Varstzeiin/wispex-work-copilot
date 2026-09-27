"use client";

/**
 * English / Indonesian UI text.
 *
 * Text is written in place as t("English", "Indonesia"), so both versions sit side by side and
 * none can go missing. The language is a per-device preference (localStorage), defaulting to the
 * browser language. Changing it re-renders the whole app, so plain functions and label maps
 * (see localize) pick up the new language without hooks.
 *
 * Every API request sends the language in the X-Language header, so text made by the server
 * (priority reasons, advice, error messages) follows it too. Drafts for other people stay English.
 */

import { createContext, useContext, useEffect, useState } from "react";
import { mutate } from "swr";

export type Lang = "en" | "id";

const STORAGE_KEY = "wispex-lang";
let current: Lang = "en";

export function getLang(): Lang {
  return current;
}

/** Switch the language used by t() and localize(). Components use setLang from useLang instead. */
export function applyLang(lang: Lang): void {
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

/** The text for the active language. */
export function t(en: string, id: string): string {
  return current === "id" ? id : en;
}

/** Locale for dates and numbers. */
export function dateLocale(): string {
  return current === "id" ? "id-ID" : "en-GB";
}

/**
 * A label map that follows the active language. `id` holds the Indonesian text per key; for maps
 * of objects, `field` names the property it replaces (usually "label"). Missing keys fall back to
 * English.
 */
export function localize<K extends string, V>(
  base: Record<K, V>,
  id: Partial<Record<K, string>>,
  field?: V extends object ? keyof V : never,
): Record<K, V> {
  return new Proxy(base, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (current !== "id" || typeof key !== "string" || !(key in id)) return value;
      const text = id[key as K] as string;
      return field ? { ...(value as object), [field]: text } : text;
    },
  });
}

function preferredLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "id") return saved;
  } catch {
    // storage blocked (private mode): fall back to the browser language
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("id") ? "id" : "en";
}

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: "en",
  setLang: () => undefined,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en"); // matches the server render, then switches

  useEffect(() => {
    // Only an explicit choice is saved, so a browser-language default can still follow the browser
    const preferred = preferredLang();
    applyLang(preferred);
    if (preferred !== "en") void mutate(() => true); // data fetched before this point is in English
    setLangState(preferred);
  }, []);

  function setLang(next: Lang) {
    applyLang(next);
    // Cached server data holds text in the previous language: fetch it again
    void mutate(() => true);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not saved: the choice still applies until the page is closed
    }
    setLangState(next);
  }

  current = lang;
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {/* key: a language change re-renders everything, including text built outside components */}
      <div key={lang} className="contents">
        {children}
      </div>
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}

/** EN | ID switch. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div
      role="group"
      aria-label={t("Language", "Bahasa")}
      className={`inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold ${className}`}
    >
      {(["en", "id"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLang(option)}
          aria-pressed={lang === option}
          className={`rounded-md px-2.5 py-1 ${lang === option ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {option === "en" ? "EN" : "ID"}
        </button>
      ))}
    </div>
  );
}

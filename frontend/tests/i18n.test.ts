import { afterEach, describe, expect, it } from "vitest";

import { applyLang, localize, t } from "@/lib/i18n";
import { DEADLINE_STYLE, STATUS_LABEL } from "@/lib/utils/labels";
import { formatMinutes } from "@/lib/utils/time";

afterEach(() => applyLang("en"));

describe("t", () => {
  it("returns the text for the active language", () => {
    expect(t("Sign out", "Keluar")).toBe("Sign out");
    applyLang("id");
    expect(t("Sign out", "Keluar")).toBe("Keluar");
  });
});

describe("localize", () => {
  it("follows the language and falls back to English for missing keys", () => {
    const labels = localize({ A: "Apple", B: "Banana" }, { A: "Apel" });
    expect(labels.A).toBe("Apple");
    applyLang("id");
    expect(labels.A).toBe("Apel");
    expect(labels.B).toBe("Banana");
    expect(Object.values(labels)).toEqual(["Apel", "Banana"]);
  });

  it("replaces only the named field in maps of objects", () => {
    applyLang("id");
    expect(STATUS_LABEL.COMPLETED).toBe("Selesai");
    expect(DEADLINE_STYLE.OVERDUE).toMatchObject({ label: "TERLAMBAT", bg: "bg-red-100" });
  });
});

describe("formatMinutes", () => {
  it("uses Indonesian units", () => {
    expect(formatMinutes(80)).toBe("1h 20m");
    applyLang("id");
    expect(formatMinutes(80)).toBe("1j 20m");
    expect(formatMinutes(1500)).toBe("1h 1j");
  });
});

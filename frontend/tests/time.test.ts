import { describe, expect, it } from "vitest";

import { formatCountdown, formatDateTime, formatMinutes, toLocalInput } from "@/lib/utils/time";

describe("formatCountdown", () => {
  const now = Date.parse("2026-09-23T03:00:00Z");

  it("shows hh:mm:ss under 24 hours", () => {
    expect(formatCountdown("2026-09-23T03:42:15Z", now)).toEqual({ text: "00:42:15", overdue: false });
  });

  it("shows days and hours beyond 24 hours", () => {
    expect(formatCountdown("2026-09-25T05:00:00Z", now).text).toBe("2d 2h");
  });

  it("marks overdue deadlines with a minus sign", () => {
    expect(formatCountdown("2026-09-23T02:55:00Z", now)).toEqual({ text: "-00:05:00", overdue: true });
  });
});

describe("formatMinutes", () => {
  it.each([
    [45, "45m"],
    [80, "1h 20m"],
    [1500, "1d 1h"],
    [-30, "30m"],
  ])("%i -> %s", (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });
});

describe("timezone handling", () => {
  it("formats UTC timestamps in the profile timezone (Asia/Jakarta, UTC+7)", () => {
    expect(formatDateTime("2026-09-23T15:00:00Z", "Asia/Jakarta")).toBe("23 Sept, 22:00");
  });

  it("converts UTC to a datetime-local value in the profile timezone", () => {
    expect(toLocalInput("2026-12-01T03:00:00Z", "Asia/Jakarta")).toBe("2026-12-01T10:00");
    expect(toLocalInput("2026-12-01T03:00:00Z", "UTC")).toBe("2026-12-01T03:00");
  });

  it("returns an empty input value for missing dates", () => {
    expect(toLocalInput(null, "Asia/Jakarta")).toBe("");
    expect(formatDateTime(null, "Asia/Jakarta")).toBe("—");
  });
});

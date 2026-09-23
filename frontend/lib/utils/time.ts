/** Time helpers. All values from the API are UTC ISO strings; display uses the profile timezone. */

export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatFullDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

/** Minutes as "1h 20m" / "2d 3h" / "45m". */
export function formatMinutes(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Live countdown text: "00:42:15" under 24h, "1d 2h" beyond, "-00:05:10" when overdue. */
export function formatCountdown(deadlineIso: string, now: number): { text: string; overdue: boolean } {
  const diffMs = new Date(deadlineIso).getTime() - now;
  const overdue = diffMs < 0;
  const total = Math.floor(Math.abs(diffMs) / 1000);
  if (total >= 86400) {
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    return { text: `${overdue ? "-" : ""}${days}d ${hours}h`, overdue };
  }
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return { text: `${overdue ? "-" : ""}${h}:${m}:${s}`, overdue };
}

/** UTC ISO -> "YYYY-MM-DDTHH:mm" wall-clock value in the given timezone, for datetime-local inputs. */
export function toLocalInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

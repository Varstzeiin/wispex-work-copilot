"use client";

import clsx from "clsx";
import { useState } from "react";

/**
 * Single-series bar charts built from plain HTML.
 * One color (a single series needs no legend), values in text ink, hover/focus tooltip,
 * and a screen-reader table so the numbers are never available by color or shape only.
 */

interface Datum {
  label: string;
  value: number;
  detail?: string;
  muted?: boolean; // e.g. future days
}

export function ColumnChart({ data, title, height = 120 }: { data: Datum[]; title: string; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <div className="relative" style={{ height: height + 20 }} aria-hidden>
        {/* recessive gridlines at half and max */}
        <div className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ top: 0 }} />
        <div className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ top: height / 2 }} />
        <span className="absolute -top-2 right-0 bg-white pl-1 text-[10px] tabular-nums text-slate-400">{max}</span>
        <div className="absolute inset-x-0 top-0 flex items-end gap-[2px]" style={{ height }}>
          {data.map((d, i) => (
            <div
              key={d.label}
              className="relative flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}
            >
              <div
                className={clsx(
                  "w-full max-w-10 rounded-t-[4px] transition-opacity",
                  d.muted ? "bg-slate-200" : "bg-brand-500",
                  active !== null && active !== i && "opacity-50",
                )}
                style={{ height: d.value ? `${Math.max(4, (d.value / max) * height)}px` : "2px" }}
              />
              {active === i && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-xs text-white shadow">
                  <span className="font-semibold tabular-nums">{d.value}</span> · {d.detail ?? d.label}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 flex gap-[2px] border-t border-slate-300" style={{ top: height }}>
          {data.map((d) => (
            <span key={d.label} className="flex-1 truncate pt-1 text-center text-[10px] text-slate-500">
              {d.label}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.detail ?? d.label}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars for a ranked breakdown (magnitude, one hue). */
export function BarList({ data, title, empty = "No data yet" }: { data: Datum[]; title: string; empty?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const shown = data.filter((d) => d.value > 0);
  if (!shown.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <ul className="space-y-2">
        {shown.map((d) => (
          <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-2 text-sm">
            <span className="truncate text-slate-700" title={d.label}>
              {d.label}
            </span>
            <span className="h-3 overflow-hidden rounded-r-[4px] bg-slate-100">
              <span className="block h-full rounded-r-[4px] bg-brand-500" style={{ width: `${(d.value / max) * 100}%` }} />
            </span>
            <span className="text-right font-semibold tabular-nums text-slate-900">{d.value}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui";

/** Copy to the clipboard, so the user sends the message themselves in their own channel. */
export function CopyButton({ text, label = "Copy", onCopied }: { text: string; label?: string; onCopied?: () => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      onCopied?.();
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2500);
  }

  return (
    <Button variant="secondary" onClick={copy} disabled={!text.trim()}>
      {state === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy manually" : label}
    </Button>
  );
}

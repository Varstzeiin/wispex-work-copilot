import { NextActionPanel } from "@/components/assistant/NextActionPanel";
import { ComingLater } from "@/components/ui/ComingLater";

export default function AssistantPage() {
  return (
    <ComingLater
      title="Assistant"
      phase="MVP 4 · AI copilot"
      summary="“What should I work on now?” is active and runs on your own priority rules (no AI provider involved). The AI-assisted features below come in a later phase."
      planned={[
        "“I'm not sure” assistant: collects context, field, issue, deadline and documents",
        "Question drafting in the format Context → Specific issue → Evidence → Deadline → Question",
        "Knowledge search over training notes, SOP references and resolved cases (with sources)",
        "Communication drafts: clarification, missing documents, discrepancy, escalation, correction, status update",
        "Error analysis and adaptive personal checklist suggestions (always with your confirmation)",
      ]}
      principles={[
        "Answers only from trusted sources you stored. If none exist: “No reliable source found”",
        "Never invents an SOP or decides customs, compliance or financial questions",
        "Drafts only. You review, approve and send every message yourself",
      ]}
    >
      <NextActionPanel />
    </ComingLater>
  );
}

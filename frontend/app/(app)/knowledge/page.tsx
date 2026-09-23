import { ComingLater } from "@/components/ui/ComingLater";

export default function KnowledgePage() {
  return (
    <ComingLater
      title="Knowledge"
      phase="MVP 4 · AI copilot"
      summary="A searchable personal knowledge base, so you can check trusted sources before asking others."
      planned={[
        "Training notes, SOP references, document explanations, terminology, resolved questions, lessons and common mistakes",
        "Retrieval-based search that shows the source of every answer",
        "Knowledge-first flow before escalation: training → SOP → personal notes → resolved cases → senior notes",
      ]}
      principles={[
        "Never invents an SOP. If no reliable source is found, it says so and suggests asking the appropriate person",
        "Personal notes stay separate from company data",
      ]}
    />
  );
}

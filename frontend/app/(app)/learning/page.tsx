import { ComingLater } from "@/components/ui/ComingLater";

export default function LearningPage() {
  return (
    <ComingLater
      title="Learning"
      phase="MVP 2 · Performance"
      summary="Track what you learn, which feedback you applied, and review each shift and week."
      planned={[
        "Daily log and end-of-shift review: completed, pending, critical, errors, discrepancies, escalations, average processing time, tomorrow's priorities",
        "Weekly review",
        "Learning tracker and skill matrix",
      ]}
    />
  );
}

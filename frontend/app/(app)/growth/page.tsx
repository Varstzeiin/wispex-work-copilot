import { ComingLater } from "@/components/ui/ComingLater";

export default function GrowthPage() {
  return (
    <ComingLater
      title="Growth"
      phase="MVP 2 · Performance"
      summary="Personal Reliability Indicators and 30 / 60 / 90 day development, shown with evidence rather than a single score."
      planned={[
        "Personal Reliability Indicators: on-time completion, repeated errors, feedback applied, clear questions, early reporting, independent completion, consistency, documentation quality",
        "Day 30: understanding · Day 60: consistency · Day 90: independence and reliability",
      ]}
      principles={["Personal indicators for your own development. Never presented as an official company evaluation"]}
    />
  );
}

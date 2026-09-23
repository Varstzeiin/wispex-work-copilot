import { ComingLater } from "@/components/ui/ComingLater";

export default function ErrorsPage() {
  return (
    <ComingLater
      title="Errors"
      phase="MVP 2 · Performance"
      summary="A transparent Report an Error workflow and personal error analytics. Reporting early is always the right move."
      planned={[
        "Report an Error: stop and verify, exact field, correct value, source document, submission time, impact, who to notify, correction, resolution, root cause",
        "Error log with categories: typographical, data reading, data entry, missing information, cross-document discrepancy, SOP/procedure, communication, time management, other",
        "Error rate, severity, recurring errors, correction time and trends",
      ]}
      principles={[
        "The app encourages early reporting and never helps hide or delay an error report",
        "Personal analytics only. Not an official company evaluation",
      ]}
    />
  );
}

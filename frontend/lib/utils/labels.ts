import type { DeadlineStatus, Guidance, IssueType, PriorityLevel, TaskStatus } from "@/types";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  NEW: "New",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
  NEEDS_REVIEW: "Needs review",
  ESCALATED: "Escalated",
  COMPLETED: "Completed",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
};

export const LEVEL_STYLE: Record<PriorityLevel, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-amber-100 text-amber-900",
  LOW: "bg-slate-100 text-slate-700",
  NONE: "bg-slate-100 text-slate-500",
};

export const DEADLINE_STYLE: Record<DeadlineStatus, { text: string; bg: string; label: string; dot: string }> = {
  OVERDUE: { text: "text-red-800", bg: "bg-red-100", label: "OVERDUE", dot: "🔴" },
  CRITICAL: { text: "text-red-700", bg: "bg-red-50", label: "CRITICAL", dot: "🔴" },
  URGENT: { text: "text-orange-700", bg: "bg-orange-50", label: "URGENT", dot: "🟠" },
  WATCH: { text: "text-amber-700", bg: "bg-amber-50", label: "WATCH", dot: "🟡" },
  SAFE: { text: "text-emerald-700", bg: "bg-emerald-50", label: "SAFE", dot: "🟢" },
  NO_DEADLINE: { text: "text-slate-500", bg: "bg-slate-50", label: "NO DEADLINE", dot: "⚪" },
};

/** The human-in-the-loop status model. Guidance only, never a decision. */
export const GUIDANCE: Record<Guidance, { emoji: string; label: string; style: string }> = {
  SAFE_TO_PROCEED: { emoji: "🟢", label: "Safe to proceed", style: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  VERIFY: { emoji: "🟡", label: "Verify", style: "bg-amber-50 text-amber-900 border-amber-200" },
  ASK: { emoji: "🟠", label: "Ask", style: "bg-orange-50 text-orange-900 border-orange-200" },
  ESCALATE: { emoji: "🔴", label: "Escalate", style: "bg-red-50 text-red-800 border-red-200" },
  HOLD: { emoji: "⚫", label: "Hold", style: "bg-slate-100 text-slate-800 border-slate-300" },
};

export const ISSUE_LABEL: Record<IssueType, string> = {
  QUANTITY_MISMATCH: "Quantity mismatch",
  WEIGHT_MISMATCH: "Weight mismatch",
  DESCRIPTION_MISMATCH: "Description mismatch",
  VALUE_MISMATCH: "Value mismatch",
  MISSING_INFORMATION: "Missing information",
  LOW_CONFIDENCE: "Hard to read / low confidence",
  COMPLIANCE_QUESTION: "Compliance question",
  OTHER: "Other",
};

export const FACTOR_LABEL: Record<string, string> = {
  deadline: "Deadline proximity",
  eta: "ETA proximity",
  risk: "Open issues",
  missing_documents: "Missing documents",
  client_priority: "Client priority",
  complexity: "Processing time",
  task_age: "Task age",
};

export const COMMON_DOCUMENTS = [
  "Commercial Invoice",
  "Packing List",
  "Bill of Lading",
  "Air Waybill",
  "Certificate of Origin",
  "Insurance Certificate",
];

// ---------- MVP 2 ----------

export const ERROR_CATEGORY_LABEL: Record<string, string> = {
  TYPOGRAPHICAL: "Typographical",
  DATA_READING: "Data reading",
  DATA_ENTRY: "Data entry",
  MISSING_INFORMATION: "Missing information",
  CROSS_DOCUMENT: "Cross-document discrepancy",
  SOP_PROCEDURE: "SOP / procedure",
  COMMUNICATION: "Communication",
  TIME_MANAGEMENT: "Time management",
  OTHER: "Other",
};

export const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-100 text-orange-900",
  MEDIUM: "bg-amber-100 text-amber-900",
  LOW: "bg-slate-100 text-slate-700",
};

export const ERROR_STATUS: Record<string, { label: string; style: string }> = {
  REPORTED: { label: "Reported", style: "bg-red-100 text-red-800" },
  NOTIFIED: { label: "Notified", style: "bg-orange-100 text-orange-900" },
  CORRECTING: { label: "Correcting", style: "bg-sky-100 text-sky-800" },
  RESOLVED: { label: "Resolved", style: "bg-emerald-100 text-emerald-800" },
};

export const LEARNING_CATEGORY_LABEL: Record<string, string> = {
  SOP: "SOP",
  DOCUMENT: "Document",
  TERMINOLOGY: "Terminology",
  PROCEDURE: "Procedure",
  SYSTEM: "System",
  LESSON: "Lesson learned",
  OTHER: "Other",
};

export const LEARNING_STATUS: Record<string, { label: string; style: string }> = {
  TO_LEARN: { label: "To learn", style: "bg-slate-100 text-slate-700" },
  LEARNING: { label: "Learning", style: "bg-sky-100 text-sky-800" },
  UNDERSTOOD: { label: "Understood", style: "bg-emerald-100 text-emerald-800" },
  APPLIED: { label: "Applied", style: "bg-emerald-600 text-white" },
};

/** Status palette is reserved for state and always shown with an icon and a label. */
export const INDICATOR_STATUS: Record<string, { label: string; icon: string; style: string }> = {
  GOOD: { label: "Good", icon: "✓", style: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  WATCH: { label: "Watch", icon: "!", style: "bg-amber-50 text-amber-900 border-amber-200" },
  NEEDS_ATTENTION: { label: "Needs attention", icon: "▲", style: "bg-red-50 text-red-800 border-red-200" },
  NO_DATA: { label: "No data yet", icon: "–", style: "bg-slate-50 text-slate-600 border-slate-200" },
};

// ---------- MVP 3 ----------

export const DOC_TYPE_LABEL: Record<string, string> = {
  INVOICE: "Commercial Invoice",
  PACKING_LIST: "Packing List",
  BILL_OF_LADING: "Bill of Lading",
  AIR_WAYBILL: "Air Waybill",
  OTHER: "Other document",
  UNKNOWN: "Type not set",
};

export const DOC_FIELD_LABEL: Record<string, string> = {
  invoice_number: "Invoice number",
  invoice_date: "Invoice date",
  document_date: "Document date",
  seller: "Seller",
  buyer: "Buyer",
  consignee: "Consignee",
  shipment_reference: "Shipment reference",
  transport_document_number: "BL / AWB number",
  currency: "Currency",
  total_value: "Total value",
  quantity: "Quantity",
  quantity_unit: "Quantity unit",
  gross_weight: "Gross weight",
  net_weight: "Net weight",
  weight_unit: "Weight unit",
  product_description: "Product description",
};

export const PROCESSING_STATUS: Record<string, { label: string; style: string }> = {
  UPLOADED: { label: "Uploaded", style: "bg-slate-100 text-slate-700" },
  QUEUED: { label: "Queued", style: "bg-sky-100 text-sky-800" },
  PROCESSING: { label: "Analysing…", style: "bg-sky-100 text-sky-800" },
  EXTRACTED: { label: "Ready to verify", style: "bg-emerald-50 text-emerald-800" },
  NEEDS_REVIEW: { label: "Needs review", style: "bg-amber-100 text-amber-900" },
  VERIFIED: { label: "Verified", style: "bg-emerald-600 text-white" },
  FAILED: { label: "Failed", style: "bg-red-100 text-red-800" },
  AI_NOT_PERMITTED: { label: "Manual entry", style: "bg-slate-100 text-slate-700" },
};

export const DISCREPANCY_STATUS: Record<string, { label: string; style: string }> = {
  OPEN: { label: "Open", style: "bg-red-100 text-red-800" },
  RESOLVED: { label: "Resolved", style: "bg-emerald-100 text-emerald-800" },
  DISMISSED: { label: "Dismissed", style: "bg-slate-100 text-slate-700" },
  SUPERSEDED: { label: "Values changed", style: "bg-slate-100 text-slate-700" },
};

export function confidenceStyle(confidence: number, threshold = 0.85): string {
  if (confidence >= threshold) return "text-emerald-700";
  if (confidence >= 0.6) return "text-amber-700";
  return "text-red-700";
}

// ---------- MVP 4 ----------

export const KNOWLEDGE_CATEGORY_LABEL: Record<string, string> = {
  TRAINING: "Training note",
  SOP_REFERENCE: "SOP reference",
  DOCUMENT_EXPLANATION: "Document explanation",
  TERMINOLOGY: "Terminology",
  RESOLVED_QUESTION: "Resolved question",
  LESSON: "Personal lesson",
  COMMON_MISTAKE: "Common mistake",
  PROCEDURE: "Useful procedure",
  SENIOR_NOTE: "Senior / team note",
};

export const DRAFT_KIND_LABEL: Record<string, string> = {
  CLARIFICATION: "Clarification request",
  MISSING_DOCUMENT: "Missing documents",
  DISCREPANCY: "Document discrepancy",
  ESCALATION: "Escalation",
  CORRECTION: "Correction notification",
  STATUS_UPDATE: "Status update",
};

export const RECOMMENDATION_STYLE: Record<string, { label: string; style: string }> = {
  VERIFY: { label: "Verify first", style: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  ASK: { label: "Ask a precise question", style: "border-amber-200 bg-amber-50 text-amber-900" },
  ESCALATE: { label: "Consider escalating", style: "border-red-200 bg-red-50 text-red-900" },
};

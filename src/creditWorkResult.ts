import type { McpToolResult } from "./types";

/** Public projection of account-bound, persisted work. Never pass an unfiltered
 * database row or provider response as the saved result. */
export type McpCreditWorkSnapshot = {
  budget: number;
  charged: number;
  status: "running" | "completed" | "failed";
  result: string | null;
};

const savedResult = (value: string | null): unknown => {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Keep text-only and structured-only hosts on the same result contract. This
 * pure formatter never starts, retries, approves, or settles work. Use it for
 * initial completion, duplicate requests, and read-only recovery alike. */
export const createCreditWorkResult = (
  requestId: string,
  work: McpCreditWorkSnapshot,
): McpToolResult => {
  if (
    typeof requestId !== "string" ||
    !requestId ||
    requestId.length > 128 ||
    !Number.isSafeInteger(work.budget) ||
    work.budget < 0 ||
    !Number.isSafeInteger(work.charged) ||
    work.charged < 0 ||
    work.charged > work.budget ||
    !["running", "completed", "failed"].includes(work.status) ||
    (work.result !== null && typeof work.result !== "string")
  )
    throw new Error("Invalid saved credit work");
  const summary = {
    requestId,
    status: work.status,
    maxCredits: work.budget,
    creditsCharged: work.charged,
    // Nested, never spread: tool output cannot replace trusted accounting fields.
    result: savedResult(work.result),
    ...(work.result === null
      ? {
          message:
            "No saved result is available. Poll get_credit_work with the same requestId; do not restart it with a new ID.",
        }
      : {}),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(summary) }],
    structuredContent: summary,
    isError: work.status === "failed",
  };
};

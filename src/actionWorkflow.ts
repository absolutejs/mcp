import { isRecord } from "./guards";
import type { McpToolRegistry, McpToolResult } from "./types";
export type ActionReview = {
  maxCredits?: number;
  /** Set by the tool factory from the available confirmation capability. */
  canConfirm?: boolean;
  actionId: string;
  revision: string;
  title: string;
  expiresAt: string;
  recipients: string[];
  subject: string;
  body: string;
  consequence: string;
};
export type ActionConfirmation = {
  actionId: string;
  expectedRevision: string;
  maxCredits?: number;
};
export type ActionJob = {
  creditUsage?: {
    workId: string;
    maxCredits: number;
    creditsCharged: number;
    status: "reserved" | "settled";
  };
  actionId: string;
  status:
    | "awaiting_approval"
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "unknown"
    | "denied"
    | "expired";
  title: string;
  summary: string;
};
const budget = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw Error("maxCredits must be a positive safe integer");
  return value;
};
const budgetSchema = {
  type: "integer",
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
  description:
    "Explicit user-approved maximum service-credit charge for this deferred action. Unused credits are released after definite completion; unknown outcomes remain reserved.",
};
const text = (value: unknown, max = 256): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error("Invalid action value");
  return value;
};
export const projectActionReview = (value: unknown): ActionReview => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.recipients) ||
    !value.recipients.length ||
    value.recipients.length > 100
  )
    throw Error("Invalid review");
  const expiresAt = text(value.expiresAt);
  if (!Number.isFinite(Date.parse(expiresAt)))
    throw Error("Invalid review expiry");
  return {
    ...(value.maxCredits !== undefined
      ? { maxCredits: budget(value.maxCredits) }
      : {}),
    canConfirm: value.canConfirm === true,
    actionId: text(value.actionId, 128),
    revision: text(value.revision, 128),
    title: text(value.title, 512),
    expiresAt,
    recipients: value.recipients.map((v) => text(v, 512)),
    subject: text(value.subject, 2000),
    body: text(value.body, 100000),
    consequence: text(value.consequence, 2000),
  };
};
export const projectActionJob = (value: unknown): ActionJob => {
  if (!isRecord(value)) throw Error("Invalid job");
  const statuses: ActionJob["status"][] = [
    "awaiting_approval",
    "queued",
    "running",
    "succeeded",
    "failed",
    "unknown",
    "denied",
    "expired",
  ];
  const status = statuses.find((s) => s === value.status);
  if (!status) throw Error("Invalid job status");
  const usage = value.creditUsage;
  if (
    usage !== undefined &&
    (!isRecord(usage) ||
      budget(usage.maxCredits) === undefined ||
      !Number.isSafeInteger(usage.creditsCharged) ||
      typeof usage.creditsCharged !== "number" ||
      usage.creditsCharged < 0 ||
      (usage.status !== "reserved" && usage.status !== "settled") ||
      usage.creditsCharged > (budget(usage.maxCredits) ?? 0))
  )
    throw Error("Invalid job credits");
  return {
    ...(isRecord(usage)
      ? {
          creditUsage: {
            workId: text(usage.workId, 128),
            maxCredits: budget(usage.maxCredits)!,
            creditsCharged: usage.creditsCharged as number,
            status: usage.status as "reserved" | "settled",
          },
        }
      : {}),
    actionId: text(value.actionId, 128),
    status,
    title: text(value.title, 512),
    summary: text(value.summary, 4000),
  };
};
const result = (data: ActionReview | ActionJob): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: { ...data },
});
const idArgs = (args: unknown) => {
  if (!isRecord(args) || Object.keys(args).some((k) => k !== "actionId"))
    throw Error("Only actionId is accepted");
  return text(args.actionId, 128);
};
/** Bind readers and confirmation to the authenticated owner. confirm must compare
 * the exact reviewed revision and expiry under a database lock, authorize the
 * immutable payload, and commit its decision plus durable outbox atomically.
 * Every draft writer must refuse edits after that claim. Never send inline.
 * Job reads/resume only reattach to saved work, including ambiguous outcomes. */
export const createActionWorkflowTools = (adapter: {
  requiresBudget?: boolean;
  review: (actionId: string, maxCredits?: number) => Promise<ActionReview>;
  job: (actionId: string) => Promise<ActionJob>;
  confirm?: (request: ActionConfirmation) => Promise<ActionJob>;
}): McpToolRegistry => {
  const inputSchema = {
    type: "object",
    properties: { actionId: { type: "string", minLength: 1, maxLength: 128 } },
    required: ["actionId"],
    additionalProperties: false,
  };
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const readJob = async (args: unknown) => {
    const actionId = idArgs(args),
      data = projectActionJob(await adapter.job(actionId));
    if (data.actionId !== actionId) throw Error("Job identity mismatch");
    return result(data);
  };
  return {
    get_action_review: {
      annotations,
      inputSchema: {
        ...inputSchema,
        properties: { ...inputSchema.properties, maxCredits: budgetSchema },
      },
      description:
        "Read the exact recipients, subject, message, consequences, revision and expiry of one owned pending action. No approval or send. For prepaid approval supply the user-chosen maxCredits and show its hold/charge limit along with the complete review before asking for approval.",
      handler: async (args) => {
        if (
          !isRecord(args) ||
          Object.keys(args).some((k) => k !== "actionId" && k !== "maxCredits")
        )
          throw Error("Invalid review arguments");
        const actionId = text(args.actionId, 128),
          maxCredits = budget(args.maxCredits);
        const data = projectActionReview({
          ...(await adapter.review(actionId, maxCredits)),
          canConfirm:
            Boolean(adapter.confirm) &&
            (!adapter.requiresBudget || maxCredits !== undefined),
        });
        if (data.maxCredits !== maxCredits)
          throw Error("Review budget mismatch");
        if (data.actionId !== actionId) throw Error("Review identity mismatch");
        return result(data);
      },
    },
    get_action_job: {
      annotations,
      inputSchema,
      description:
        "Read durable status of an owned action. No work starts or retries; unknown means reconcile before any resend. Available at zero credits.",
      handler: readJob,
    },
    resume_action_job: {
      annotations,
      inputSchema,
      description:
        "Resume tracking an existing action by reopening its saved durable status after leaving chat. This only reads: it never restarts, resends, retries or changes the job. Unknown outcomes must be reconciled; never create a new action to bypass them.",
      handler: readJob,
    },
    ...(adapter.confirm
      ? {
          confirm_action_review: {
            ...(adapter.requiresBudget
              ? {
                  commerce: {
                    action: "paid_access" as const,
                    categories: ["usage_credits" as const],
                  },
                }
              : {}),
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              openWorldHint: true,
            },
            inputSchema: {
              type: "object",
              properties: {
                actionId: { type: "string", minLength: 1, maxLength: 128 },
                maxCredits: budgetSchema,
                expectedRevision: {
                  type: "string",
                  minLength: 1,
                  maxLength: 128,
                },
              },
              required: ["actionId", "expectedRevision"],
              additionalProperties: false,
            },
            description:
              "Approve and queue exactly the reviewed version of an outbound action, only after the user explicitly approves its complete recipients, message, consequences and any maxCredits reservation. Echo the reviewed maxCredits exactly. This may SEND outside the service. Do not call on render, inference or automatic retry. Stale/expired/already-decided approvals fail; use get_action_job after an uncertain response.",
            handler: async (args: unknown) => {
              if (
                !isRecord(args) ||
                Object.keys(args).some(
                  (k) =>
                    k !== "actionId" &&
                    k !== "expectedRevision" &&
                    k !== "maxCredits",
                )
              )
                throw Error("Invalid confirmation");
              const actionId = text(args.actionId, 128),
                expectedRevision = text(args.expectedRevision, 128);
              if (adapter.requiresBudget && args.maxCredits === undefined)
                throw Error(
                  "Prepaid confirmation requires the reviewed maxCredits",
                );
              const data = projectActionJob(
                await adapter.confirm!({
                  actionId,
                  expectedRevision,
                  ...(args.maxCredits !== undefined
                    ? { maxCredits: budget(args.maxCredits) }
                    : {}),
                }),
              );
              if (data.actionId !== actionId)
                throw Error(
                  "Confirmation identity mismatch; read job status before proceeding",
                );
              return result(data);
            },
          },
        }
      : {}),
  };
};

import { isRecord } from "./guards";
import type { McpToolRegistry, McpToolResult } from "./types";
export type McpSetupStatus = {
  business: string | null;
  businessCount: number;
  portalAccess: boolean;
  availableCredits: number;
};
export type McpWorkPreviewRequest = { operation: string; maxCredits: number };
export type McpWorkPreview = McpWorkPreviewRequest & {
  summary: string;
  availableCredits: number;
  eligible: boolean;
  reason: string;
};
const label = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 512)
    throw Error("Invalid workflow label");
  return value;
};
const amount = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0)
    throw Error("Invalid credit amount");
  return value;
};
export const projectSetupStatus = (value: unknown): McpSetupStatus => {
  if (!isRecord(value) || typeof value.portalAccess !== "boolean")
    throw Error("Invalid setup status");
  return {
    business: value.business === null ? null : label(value.business),
    businessCount: amount(value.businessCount),
    portalAccess: value.portalAccess,
    availableCredits: amount(value.availableCredits),
  };
};
export const projectWorkPreview = (value: unknown): McpWorkPreview => {
  if (!isRecord(value) || typeof value.eligible !== "boolean")
    throw Error("Invalid work preview");
  const maxCredits = amount(value.maxCredits);
  if (maxCredits < 1) throw Error("A positive budget is required");
  return {
    operation: label(value.operation),
    maxCredits,
    summary: label(value.summary),
    availableCredits: amount(value.availableCredits),
    eligible: value.eligible,
    reason: label(value.reason),
  };
};
const result = (text: string, data: object): McpToolResult => ({
  content: [{ type: "text", text }],
  structuredContent: { ...data },
});
/** Readers must close over the authenticated identity. No executor, reservation,
 * checkout or account-selector callback belongs in this read-only contract. */
export const createWorkflowTools = (readers: {
  setup: () => Promise<McpSetupStatus>;
  operations: readonly string[];
  preview: (request: McpWorkPreviewRequest) => Promise<McpWorkPreview>;
}): McpToolRegistry => {
  const operations = [...readers.operations];
  if (
    !operations.length ||
    operations.some((name) => !/^[a-z][a-z0-9_]{0,63}$/.test(name)) ||
    new Set(operations).size !== operations.length
  )
    throw Error("Invalid preview operations");
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  return {
    get_setup_status: {
      annotations,
      description:
        "Read account and business setup status. Available without credits; does not change setup, reserve credits or start work.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: async (args) => {
        if (!isRecord(args) || Object.keys(args).length)
          throw Error("This tool takes no arguments");
        const data = projectSetupStatus(await readers.setup());
        return result(
          `Business: ${data.business ?? "No active business selected"}. ${data.businessCount} businesses. ${data.availableCredits} service credits available. Portal access: ${data.portalAccess ? "enabled" : "not enabled"}. No setup changes made.`,
          data,
        );
      },
    },
    preview_credit_work: {
      annotations,
      commerce: { action: "entitlement_status", categories: ["usage_credits"] },
      description:
        "Preview a proposed service-credit budget and current eligibility for a supported operation. This is not an estimate, approval or reservation. It never executes work. Availability is checked again at execution.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", enum: operations },
          maxCredits: { type: "integer", minimum: 1, maximum: 1000000 },
        },
        required: ["operation", "maxCredits"],
        additionalProperties: false,
      },
      handler: async (args) => {
        if (
          !isRecord(args) ||
          Object.keys(args).some(
            (key) => key !== "operation" && key !== "maxCredits",
          ) ||
          typeof args.operation !== "string" ||
          !operations.includes(args.operation)
        )
          throw Error("Unsupported work preview");
        const maxCredits = amount(args.maxCredits);
        if (maxCredits < 1 || maxCredits > 1000000)
          throw Error("Invalid proposed budget");
        const request = { operation: args.operation, maxCredits };
        const data = projectWorkPreview(await readers.preview(request));
        if (
          data.operation !== request.operation ||
          data.maxCredits !== request.maxCredits
        )
          throw Error("Preview does not match the request");
        return result(
          `${data.summary} Proposed maximum: ${data.maxCredits} service credits (not an estimate). Available: ${data.availableCredits}. ${data.eligible ? "Eligible now" : "Unavailable"}: ${data.reason} No credits reserved; no work started. Execution requires a separate explicit request and rechecks eligibility.`,
          data,
        );
      },
    },
  };
};

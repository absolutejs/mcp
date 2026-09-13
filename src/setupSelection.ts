import { isRecord } from "./guards";
import type { McpToolRegistry, McpToolResult } from "./types";
export type SetupOption = { id: string; label: string };
export type SetupSelection = {
  revision: string;
  selectedId: string | null;
  options: SetupOption[];
};
export type SetupConfirmation = {
  expectedRevision: string;
  selectedId: string | null;
};
const text = (value: unknown, limit = 128): string => {
  if (typeof value !== "string" || !value.length || value.length > limit)
    throw Error("Invalid setup value");
  return value;
};
export const projectSetupSelection = (value: unknown): SetupSelection => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.options) ||
    value.options.length > 200
  )
    throw Error("Invalid setup options");
  const options = value.options.map((option) => {
    if (!isRecord(option)) throw Error("Invalid setup option");
    return { id: text(option.id), label: text(option.label, 512) };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length)
    throw Error("Duplicate setup options");
  const selectedId = value.selectedId === null ? null : text(value.selectedId);
  if (
    selectedId !== null &&
    !options.some((option) => option.id === selectedId)
  )
    throw Error("Unknown current selection");
  return { revision: text(value.revision), selectedId, options };
};
const result = (state: SetupSelection, confirmed = false): McpToolResult => ({
  content: [
    {
      type: "text",
      text: `${confirmed ? "Selection confirmed." : "Review setup options before confirming a change."} Current selection: ${state.options.find((option) => option.id === state.selectedId)?.label ?? "All businesses"}. Revision: ${state.revision}. Options: ${state.options.map((option) => `${option.label} (${option.id})`).join("; ") || "None"}. Use confirm_setup_selection only after explicit approval of the exact selection and revision. No credit charge or outbound action.`,
    },
  ],
  structuredContent: { ...state },
});
/** Bind to the authenticated owner. confirm MUST atomically compare the revision,
 * validate option ownership, change selection and advance the revision. All
 * writers must advance it, including A→B→A. Retries with an old revision fail
 * without effects. Recover by reading; never auto-retry against a new revision. */
export const createSetupSelectionTools = (adapter: {
  read: () => Promise<SetupSelection>;
  confirm: (request: SetupConfirmation) => Promise<SetupSelection>;
}): McpToolRegistry => ({
  get_setup_options: {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      "Read owned business-selection options and the current setup revision. No setup changes or charges. Available at zero credits.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!isRecord(args) || Object.keys(args).length)
        throw Error("This tool takes no arguments");
      return result(projectSetupSelection(await adapter.read()));
    },
  },
  confirm_setup_selection: {
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      "Apply an explicitly approved business selection to the exact reviewed setup revision. This changes the active business across the service. Never call from rendering or without the user's approval. Stale/repeated confirmation fails without changing setup; read current options to recover. No credits or outbound effects.",
    inputSchema: {
      type: "object",
      properties: {
        expectedRevision: { type: "string", minLength: 1, maxLength: 128 },
        selectedId: { type: ["string", "null"], minLength: 1, maxLength: 128 },
      },
      required: ["expectedRevision", "selectedId"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (
        !isRecord(args) ||
        Object.keys(args).some(
          (key) => key !== "expectedRevision" && key !== "selectedId",
        )
      )
        throw Error("Invalid setup confirmation");
      const request = {
        expectedRevision: text(args.expectedRevision),
        selectedId: args.selectedId === null ? null : text(args.selectedId),
      };
      return result(
        projectSetupSelection(await adapter.confirm(request)),
        true,
      );
    },
  },
});

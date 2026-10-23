import type { McpSessionStore, McpTool, McpToolResult } from "./types";
import { isRecord } from "./guards";
export const MCP_APP_MIME = "text/html;profile=mcp-app";
export type McpAppResource = { name: string; html: string };
export type McpAppsConfig = {
  /** Only enable for a host build whose upstream rendering fix has been verified. */
  allowKnownBrokenHosts?: boolean;
  resources: Record<string, McpAppResource>;
  /** Legacy URI -> current resource URI. Read-only compatibility aliases inherit
   * the current resource's tool authorization and are not advertised in lists. */
  resourceAliases?: Record<string, string>;
  store?: McpSessionStore;
};
/** Capability is presentation only; never a commerce or authorization decision. */
export const clientSupportsMcpApps = (
  params: unknown,
  options: Pick<McpAppsConfig, "allowKnownBrokenHosts"> = {},
) => {
  if (
    !isRecord(params) ||
    !isRecord(params.capabilities) ||
    !isRecord(params.capabilities.extensions)
  )
    return false;
  // https://github.com/microsoft/vscode/issues/335908
  // A stale host startup can replace a connected iframe and leave Apps blank.
  // Scope this presentation fallback to versions checked in our investigation.
  if (
    !options.allowKnownBrokenHosts &&
    isRecord(params.clientInfo) &&
    params.clientInfo.name === "Visual Studio Code" &&
    (params.clientInfo.version === "1.135.0" ||
      params.clientInfo.version === "1.136.1")
  )
    return false;
  const ui = params.capabilities.extensions["io.modelcontextprotocol/ui"];
  return (
    isRecord(ui) &&
    Array.isArray(ui.mimeTypes) &&
    ui.mimeTypes.includes(MCP_APP_MIME)
  );
};
export const withMcpApp = (tool: McpTool, resourceUri: string): McpTool => {
  if (
    !resourceUri.startsWith("ui://") ||
    new URL(resourceUri).protocol !== "ui:"
  )
    throw new Error("MCP Apps require a ui:// resource URI");
  return { ...tool, ui: { resourceUri } };
};
/** Offline templates: all data comes through authenticated tool results and the
 * official host bridge. Network, nested frames and privileged permissions are not requested. */
export const appResourceContent = (resource: McpAppResource, uri: string) => {
  if (!uri.startsWith("ui://") || !/^<!doctype html>/i.test(resource.html))
    throw new Error("Invalid MCP App resource");
  return {
    uri,
    mimeType: MCP_APP_MIME,
    text: resource.html,
    _meta: {
      ui: {
        csp: {
          connectDomains: [],
          resourceDomains: [],
          frameDomains: [],
          baseUriDomains: [],
        },
        permissions: {},
        prefersBorder: true,
      },
    },
  };
};

export { createBillingApps } from "./billingApps";

export { createWorkflowApps } from "./workflowApps";
export {
  createWorkflowTools,
  projectSetupStatus,
  projectWorkPreview,
  type McpSetupStatus,
  type McpWorkPreview,
  type McpWorkPreviewRequest,
} from "./workflowTools";

export {
  createSetupSelectionTools,
  projectSetupSelection,
  type SetupSelection,
  type SetupConfirmation,
  type SetupOption,
} from "./setupSelection";

export {
  createActionWorkflowTools,
  projectActionReview,
  projectActionJob,
  type ActionReview,
  type ActionConfirmation,
  type ActionJob,
} from "./actionWorkflow";

/** Keep complete presentation state out of model context. The compact model data
 * must include outcomes, blockers and authorized retrieval references. This is
 * projection, not truncation; callers decide which facts the model needs. */
export const createMcpAppResult = (input: {
  model: Record<string, unknown>;
  view: Record<string, unknown>;
  text?: string;
  isError?: boolean;
  meta?: Record<string, unknown>;
}): McpToolResult => ({
  content: [{ type: "text", text: input.text ?? JSON.stringify(input.model) }],
  structuredContent: input.model,
  _meta: { ...input.meta, "absolutejs/app-view": input.view },
  ...(input.isError === undefined ? {} : { isError: input.isError }),
});

/** Read the full host-only view, accepting older results during rolling upgrades. */
export const readMcpAppView = (
  result: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(result)) return undefined;
  const view = isRecord(result._meta)
    ? result._meta["absolutejs/app-view"]
    : undefined;
  return isRecord(view)
    ? view
    : isRecord(result.structuredContent)
      ? result.structuredContent
      : undefined;
};

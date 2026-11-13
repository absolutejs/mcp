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
// https://github.com/microsoft/vscode/issues/335908, fixed by
// microsoft/vscode#346646 on main after 1.146.0 was cut. Every earlier stable
// and Insiders build carries the unguarded mount, which can replace a
// connected iframe and leave an App blank. VS Code reports
// productService.nameLong/version, so Insiders arrives as its own name with a
// plain x.y.z version. An unparseable version is not evidence of the bug.
const VS_CODE_NAMES = new Set([
  "Visual Studio Code",
  "Visual Studio Code - Insiders",
]);
const VS_CODE_MOUNT_FIX = [1, 147] as const;
const hasVsCodeMountRace = (clientInfo: unknown) => {
  if (!isRecord(clientInfo) || typeof clientInfo.name !== "string")
    return false;
  if (!VS_CODE_NAMES.has(clientInfo.name)) return false;
  const match = /^(\d+)\.(\d+)\.\d+/.exec(String(clientInfo.version));
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return (
    major < VS_CODE_MOUNT_FIX[0] ||
    (major === VS_CODE_MOUNT_FIX[0] && minor < VS_CODE_MOUNT_FIX[1])
  );
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
  if (!options.allowKnownBrokenHosts && hasVsCodeMountRace(params.clientInfo))
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

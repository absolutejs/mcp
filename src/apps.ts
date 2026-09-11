import type { McpSessionStore, McpTool } from "./types";
import { isRecord } from "./guards";
export const MCP_APP_MIME = "text/html;profile=mcp-app";
export type McpAppResource = { name: string; html: string };
export type McpAppsConfig = {
  /** Only enable for a host build whose upstream rendering fix has been verified. */
  allowKnownBrokenHosts?: boolean;
  resources: Record<string, McpAppResource>;
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

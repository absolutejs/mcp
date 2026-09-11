import type { McpSessionStore, McpTool } from "./types";
import { isRecord } from "./guards";
export const MCP_APP_MIME = "text/html;profile=mcp-app";
export type McpAppResource = { name: string; html: string };
export type McpAppsConfig = {
  resources: Record<string, McpAppResource>;
  store?: McpSessionStore;
};
/** Capability is presentation only; never a commerce or authorization decision. */
export const clientSupportsMcpApps = (params: unknown) => {
  if (
    !isRecord(params) ||
    !isRecord(params.capabilities) ||
    !isRecord(params.capabilities.extensions)
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

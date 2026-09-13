import { workflowAppScript, workflowAppCss } from "./workflowApp.generated";
import { withMcpApp, type McpAppResource } from "./apps";
import type { McpToolRegistry } from "./types";
const views = {
  get_setup_status: "setup",
  preview_credit_work: "preview",
} as const;
export const createWorkflowApps = () => {
  const resources: Record<string, McpAppResource> = {};
  for (const view of Object.values(views))
    resources[`ui://absolute-workflow/${view}.html`] = {
      name: `Workflow ${view}`,
      html: `<!doctype html><html lang="en" data-view="${view}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account and work</title><style>${workflowAppCss}</style></head><body><script type="module">${workflowAppScript}</script></body></html>`,
    };
  return {
    resources,
    decorateTools: (tools: McpToolRegistry): McpToolRegistry =>
      Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => {
          const view = views[name as keyof typeof views];
          if (!view) return [name, tool];
          if (tool.annotations?.readOnlyHint !== true)
            throw Error("Workflow views require read-only tools");
          return [
            name,
            withMcpApp(tool, `ui://absolute-workflow/${view}.html`),
          ];
        }),
      ),
  };
};

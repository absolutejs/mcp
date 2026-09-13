import { setupSelectionScript } from "./setupSelection.generated";
import { workflowAppScript, workflowAppCss } from "./workflowApp.generated";
import { withMcpApp, type McpAppResource } from "./apps";
import type { McpToolRegistry } from "./types";
const views = {
  get_setup_status: "setup",
  get_setup_options: "selection",
  confirm_setup_selection: "selection",
  preview_credit_work: "preview",
} as const;
export const createWorkflowApps = () => {
  const resources: Record<string, McpAppResource> = {};
  for (const view of new Set(Object.values(views)))
    resources[`ui://absolute-workflow/${view}.html`] = {
      name: `Workflow ${view}`,
      html: `<!doctype html><html lang="en" data-view="${view}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account and work</title><style>${workflowAppCss}</style></head><body><script type="module">${view === "selection" ? setupSelectionScript : workflowAppScript}</script></body></html>`,
    };
  return {
    resources,
    decorateTools: (tools: McpToolRegistry): McpToolRegistry =>
      Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => {
          const view = views[name as keyof typeof views];
          if (!view) return [name, tool];
          if (
            tool.annotations?.readOnlyHint !==
            (name !== "confirm_setup_selection")
          )
            throw Error("Workflow tool mutability does not match its view");
          return [
            name,
            withMcpApp(tool, `ui://absolute-workflow/${view}.html`),
          ];
        }),
      ),
  };
};

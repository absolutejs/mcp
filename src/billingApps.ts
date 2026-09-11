import { billingAppScript, billingAppCss } from "./billingApp.generated";
import { withMcpApp, type McpAppResource } from "./apps";
import type { McpToolRegistry } from "./types";
const views = {
  get_billing_status: "status",
  get_usage_report: "usage",
  list_receipts: "receipts",
} as const;
/** Read-only reusable views. No checkout links, auth secrets, analytics, external
 * requests or provider fields are embedded. Existing tool gates remain intact. */
export const createBillingApps = () => {
  const resources: Record<string, McpAppResource> = {};
  for (const view of Object.values(views))
    resources[`ui://absolute-billing/${view}.html`] = {
      name: `Billing ${view}`,
      html: `<!doctype html><html lang="en" data-view="${view}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Billing report</title><style>${billingAppCss}</style></head><body><script type="module">${billingAppScript}</script></body></html>`,
    };
  return {
    resources,
    decorateTools: (tools: McpToolRegistry): McpToolRegistry =>
      Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => {
          const view = views[name as keyof typeof views];
          if (!view) return [name, tool];
          if (tool.annotations?.readOnlyHint !== true)
            throw Error("Billing Apps require read-only report tools");
          return [name, withMcpApp(tool, `ui://absolute-billing/${view}.html`)];
        }),
      ),
  };
};

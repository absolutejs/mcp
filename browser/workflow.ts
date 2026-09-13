import { App } from "@modelcontextprotocol/ext-apps";
import {
  projectSetupStatus,
  projectWorkPreview,
  type McpWorkPreviewRequest,
} from "../src/workflowTools";
const view = document.documentElement.dataset.view;
if (view !== "setup" && view !== "preview")
  throw Error("Unknown workflow view");
const app = new App(
  { name: "Account and work", version: "1.0.0" },
  {},
  { autoResize: true },
);
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};
const root = element("main");
document.body.append(root);
root.append(
  element("h1", view === "setup" ? "Your workspace" : "Before you start"),
);
const status = element("p", "Waiting for your assistant…");
status.setAttribute("role", "status");
const output = element("section");
const refresh = element("button", "Refresh");
refresh.disabled = true;
root.append(
  status,
  output,
  refresh,
  element(
    "p",
    "Service credits are separate from your assistant’s tokens. This view makes no changes and starts no work.",
  ),
);
let ready = false,
  busy = false;
let request: McpWorkPreviewRequest | null = null;
const render = (result: unknown) => {
  output.replaceChildren();
  request = null;
  try {
    if (
      !result ||
      typeof result !== "object" ||
      !("structuredContent" in result) ||
      ("isError" in result && result.isError)
    )
      throw Error("Unavailable");
    if (view === "setup") {
      const data = projectSetupStatus(result.structuredContent);
      output.append(
        element("h2", data.business ?? "No active business selected"),
        element(
          "p",
          `${data.businessCount} businesses · ${data.availableCredits} credits available`,
        ),
        element(
          "p",
          `Portal access: ${data.portalAccess ? "enabled" : "not enabled"}`,
        ),
      );
    } else {
      const data = projectWorkPreview(result.structuredContent);
      request = { operation: data.operation, maxCredits: data.maxCredits };
      output.append(
        element("h2", data.summary),
        element("p", `Proposed maximum: ${data.maxCredits} service credits`),
        element("p", `Available: ${data.availableCredits}`),
        element(
          "p",
          `${data.eligible ? "Eligible now" : "Unavailable"}: ${data.reason}`,
        ),
        element(
          "p",
          "This budget is not a cost estimate or an approval. Ask your assistant to execute only when you are ready. Execution checks availability again.",
        ),
      );
    }
    status.textContent = "Current snapshot. Refresh to check for changes.";
  } catch {
    status.textContent =
      "This view is unavailable. Ask your assistant to run it again.";
  }
  refresh.disabled = !ready || busy || (view === "preview" && !request);
};
refresh.addEventListener("click", async () => {
  if (!ready || busy || (view === "preview" && !request)) return;
  busy = true;
  refresh.disabled = true;
  const args = view === "setup" ? {} : { ...request! };
  output.replaceChildren();
  status.textContent = "Refreshing…";
  try {
    render(
      await app.callServerTool({
        name: view === "setup" ? "get_setup_status" : "preview_credit_work",
        arguments: args,
      }),
    );
  } catch {
    request = null;
    status.textContent =
      "Refresh failed. Your session may have expired. Ask your assistant to run the view again.";
  } finally {
    busy = false;
    refresh.disabled = !ready || (view === "preview" && !request);
  }
});
app.ontoolresult = render;
app.ontoolcancelled = () => {
  output.replaceChildren();
  request = null;
  refresh.disabled = true;
  status.textContent = "Canceled. Ask your assistant to run the view again.";
};
await app
  .connect()
  .then(() => {
    ready = true;
    refresh.disabled = view === "preview" && !request;
  })
  .catch(() => {
    status.textContent =
      "Use your assistant’s text result; this host could not open the view.";
  });

import { createActionWorkflowTools } from "../../src/actionWorkflow";
import { createWorkflowApps } from "../../src/workflowApps";
import { createWorkflowTools } from "../../src/workflowTools";
import {
  createSetupSelectionTools,
  type SetupSelection,
} from "../../src/setupSelection";
let state: SetupSelection = {
  revision: "one",
  selectedId: null,
  options: [
    { id: "owned", label: "Example business <script>not markup</script>" },
  ],
};
let writes = 0;
const selectionTools = createSetupSelectionTools({
  read: async () => state,
  confirm: async (request) => {
    if (request.expectedRevision !== state.revision)
      throw Error("Stale revision");
    if (request.selectedId !== null && request.selectedId !== "owned")
      throw Error("Foreign option");
    writes++;
    state = {
      ...state,
      revision: String(writes + 1),
      selectedId: request.selectedId,
    };
    return state;
  },
});
const actionTools = createActionWorkflowTools({
  review: async () => ({
    actionId: "fixture",
    revision: "v1",
    title: "Synthetic outreach",
    expiresAt: "2099-01-01T00:00:00Z",
    recipients: ["nobody@example.test"],
    subject: "Synthetic subject",
    body: "<script>inert</script>\nFull reviewed message.",
    consequence: "Synthetic fixture only; no email can be sent.",
  }),
  job: async () => ({
    actionId: "fixture",
    status: writes ? "queued" : "awaiting_approval",
    title: "Synthetic outreach",
    summary: "No real external effect",
  }),
  confirm: async (request) => {
    if (
      request.actionId !== "fixture" ||
      request.expectedRevision !== "v1" ||
      writes
    )
      throw Error("Stale");
    writes++;
    return {
      actionId: "fixture",
      status: "queued",
      title: "Synthetic outreach",
      summary: "No real external effect",
    };
  },
});
const apps = createWorkflowApps();
const tools = createWorkflowTools({
  operations: ["read_business"],
  setup: async () => ({
    business: "Example business <script>not markup</script>",
    businessCount: 1,
    portalAccess: false,
    availableCredits: 0,
  }),
  preview: async (request) => ({
    ...request,
    summary: "Read your business",
    availableCredits: 0,
    eligible: false,
    reason: "The proposed budget exceeds your balance.",
  }),
});
const bundle = await Bun.build({
  entrypoints: ["test/fixtures/workflowHost.ts"],
  target: "browser",
});
if (!bundle.success) throw Error("Fixture build failed");
const host = await bundle.outputs[0]!.text();
Bun.serve({
  hostname: "127.0.0.1",
  port: 4418,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/counts") return Response.json({ writes });
    if (url.pathname === "/host.js")
      return new Response(host, {
        headers: { "content-type": "text/javascript" },
      });
    if (url.pathname === "/view") {
      const resource =
        apps.resources[
          `ui://absolute-workflow/${url.searchParams.get("kind")}.html`
        ];
      return new Response(resource?.html ?? "Not found", {
        status: resource ? 200 : 404,
        headers: {
          "content-type": "text/html",
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        },
      });
    }
    if (url.pathname === "/fixture") {
      const preview = url.searchParams.get("view") === "preview";
      const args = await request.json();
      const tool =
        url.searchParams.get("view") === "action"
          ? actionTools[url.searchParams.get("tool") ?? "get_action_review"]!
          : url.searchParams.get("view") === "selection"
            ? selectionTools[
                url.searchParams.get("tool") ?? "get_setup_options"
              ]!
            : tools[preview ? "preview_credit_work" : "get_setup_status"]!;
      return Response.json(
        await tool.handler(
          url.searchParams.get("view") === "action" && !Object.keys(args).length
            ? { actionId: "fixture" }
            : preview && !Object.keys(args).length
              ? { operation: "read_business", maxCredits: 1 }
              : args,
          { caller: {}, request, meta: {} },
        ),
      );
    }
    return new Response(
      '<!doctype html><html><body><script type="module" src="/host.js"></script></body></html>',
      { headers: { "content-type": "text/html" } },
    );
  },
});

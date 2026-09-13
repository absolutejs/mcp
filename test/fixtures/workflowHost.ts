import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
const frame = document.createElement("iframe");
frame.sandbox.add("allow-scripts");
frame.style.cssText = "width:100%;height:850px;border:0";
document.body.append(frame);
const kind = new URL(location.href).searchParams.get("view") ?? "setup";
const bridge = new AppBridge(
  null,
  { name: "Local conformance fixture", version: "1" },
  { serverTools: {} },
  { hostContext: { theme: "light", displayMode: "inline" } },
);
let calls = 0;
const result = async (
  args: Record<string, unknown> = {},
  name = kind === "action" ? "get_action_review" : "get_setup_options",
) => {
  const response = await fetch(`/fixture?view=${kind}&tool=${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  return response.json();
};
bridge.oncalltool = async (params) => {
  const names: Record<string, string> = {
    setup: "get_setup_status",
    preview: "preview_credit_work",
    status: "get_billing_status",
    usage: "get_usage_report",
    receipts: "list_receipts",
  };
  if (
    kind === "action"
      ? ![
          "get_action_review",
          "confirm_action_review",
          "get_action_job",
          "resume_action_job",
        ].includes(params.name)
      : kind === "selection"
        ? !["get_setup_options", "confirm_setup_selection"].includes(
            params.name,
          )
        : params.name !== names[kind]
  )
    throw Error("Unexpected tool");
  calls++;
  document.documentElement.dataset.calls = String(calls);
  return result(params.arguments, params.name);
};
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult(await result());
};
await bridge.connect(
  new PostMessageTransport(frame.contentWindow!, frame.contentWindow!),
);
frame.src = `/view?kind=${kind}`;

const toggle = document.createElement("button");
toggle.textContent = "Toggle host theme";
document.body.prepend(toggle);
let dark = false;
toggle.onclick = () => {
  dark = !dark;
  bridge.setHostContext({
    theme: dark ? "dark" : "light",
    displayMode: "inline",
  });
};

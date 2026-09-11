import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
const frame = document.createElement("iframe");
frame.sandbox.add("allow-scripts");
frame.style.cssText = "width:100%;height:850px;border:0";
document.body.append(frame);
const kind = new URL(location.href).searchParams.get("view") ?? "usage";
const bridge = new AppBridge(
  null,
  { name: "Local conformance fixture", version: "1" },
  { serverTools: {} },
  { hostContext: { theme: "light", displayMode: "inline" } },
);
let calls = 0;
const result = async (args: Record<string, unknown> = {}) => {
  const response = await fetch(`/fixture?view=${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  return response.json();
};
bridge.oncalltool = async (params) => {
  const names: Record<string, string> = {
    status: "get_billing_status",
    usage: "get_usage_report",
    receipts: "list_receipts",
  };
  if (params.name !== names[kind]) throw Error("Unexpected tool");
  calls++;
  document.documentElement.dataset.calls = String(calls);
  return result(params.arguments);
};
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult(await result());
};
await bridge.connect(
  new PostMessageTransport(frame.contentWindow!, frame.contentWindow!),
);
frame.src = `/view?kind=${kind}`;

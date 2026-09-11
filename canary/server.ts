/** Synthetic host canary. Never mount this handler in a customer application. */
import {
  createMcpHandler,
  createBillingApps,
  createBillingReportTools,
} from "@absolutejs/mcp";
import { encodeReceiptCursor } from "@absolutejs/billing/reports";
const apps = createBillingApps();
const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-09-01T00:00:00.000Z";
const readers = createBillingReportTools({
  status: async () => ({
    automaticRefill: false,
    credits: {
      remaining: 0,
      reserved: 12,
      purchased: 0,
      promotional: 0,
      debt: 0,
    },
    portalAccess: false,
    subscription: null,
  }),
  receipts: async ({ cursor }) => ({
    receipts: cursor
      ? []
      : [
          {
            id,
            issuedAt: at,
            source: "credit_purchase",
            amountCents: 1000,
            refundedAmountCents: 200,
            currency: "USD",
            status: "partially_refunded",
          },
        ],
    nextCursor: cursor ? null : encodeReceiptCursor({ at, id }),
  }),
  usage: async (range) => ({
    ...range,
    creditsConsumed: 8,
    events: 2,
    byFeature: [{ feature: "fixture_workflow", credits: 8, events: 2 }],
    byDay: [{ day: range.from, credits: 8, events: 2 }],
  }),
});
const handler = createMcpHandler({
  issuer: "http://127.0.0.1:4428",
  path: "/mcp",
  serverInfo: { name: "absolute-billing-canary", version: "1" },
  authorize: async () => ({
    ok: true,
    caller: "synthetic-fixture",
    scopes: [],
  }),
  commerce: () => ({ profiles: ["unknown"] }),
  apps: { resources: apps.resources },
  tools: () => apps.decorateTools(readers),
});
// Fail before accepting a host if synthetic records violate the public contract.
for (const [name, args] of [
  ["get_billing_status", {}],
  ["get_usage_report", { from: "2026-09-01", to: "2026-09-11" }],
  ["list_receipts", {}],
  ["list_receipts", { cursor: encodeReceiptCursor({ at, id }) }],
] as const) {
  const response = await handler(
    new Request("http://127.0.0.1:4428/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const body = await response?.json();
  if (!response?.ok || !body?.result || body.error || body.result.isError)
    throw Error(`Canary preflight failed: ${name}`);
}
Bun.serve({
  hostname: "127.0.0.1",
  port: 4428,
  fetch: async (request) => {
    let rpc;
    try {
      if (request.method === "POST") rpc = await request.clone().json();
    } catch {
      /* Handler owns malformed input. */
    }
    const response =
      (await handler(request)) ?? new Response("Not found", { status: 404 });
    let body;
    if (response.headers.get("content-type")?.includes("application/json")) {
      try {
        body = await response.clone().json();
      } catch {
        /* No raw response logging. */
      }
    }
    // Only explicit protocol fields: never headers, tokens, session IDs, arguments or report bodies.
    console.log(
      JSON.stringify({
        method: rpc?.method ?? request.method,
        status: response.status,
        protocolHeader: request.headers.get("mcp-protocol-version"),
        ...(rpc?.method === "initialize"
          ? {
              client: rpc.params?.clientInfo?.name,
              version: rpc.params?.clientInfo?.version,
              requestedProtocol: rpc.params?.protocolVersion,
              negotiatedProtocol: body?.result?.protocolVersion,
              appsMimeTypes:
                rpc.params?.capabilities?.extensions?.[
                  "io.modelcontextprotocol/ui"
                ]?.mimeTypes ?? [],
              elicitation: !!rpc.params?.capabilities?.elicitation,
            }
          : {}),
        ...(rpc?.method === "tools/list"
          ? {
              tools: body?.result?.tools?.map(
                (tool: { name: string; _meta?: { ui?: unknown } }) => ({
                  name: tool.name,
                  ui: !!tool._meta?.ui,
                }),
              ),
            }
          : {}),
        ...(rpc?.method === "tools/call"
          ? {
              tool: rpc.params?.name,
              isError: body?.result?.isError ?? !!body?.error,
            }
          : {}),
      }),
    );
    return response;
  },
});
console.log(
  JSON.stringify({
    ready: true,
    url: "http://127.0.0.1:4428/mcp",
    data: "synthetic",
    payments: false,
  }),
);

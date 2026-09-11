import { createBillingApps } from "../../src/billingApps";
const apps = createBillingApps();
const bundled = await Bun.build({
  entrypoints: ["test/fixtures/appsHost.ts"],
  target: "browser",
});
if (!bundled.success) throw Error("Host fixture build failed");
const host = await bundled.outputs[0]!.text();
Bun.serve({
  hostname: "127.0.0.1",
  port: 4417,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/host.js")
      return new Response(host, {
        headers: { "content-type": "text/javascript" },
      });
    if (url.pathname === "/view") {
      const resource =
        apps.resources[
          `ui://absolute-billing/${url.searchParams.get("kind")}.html`
        ];
      return resource
        ? new Response(resource.html, {
            headers: {
              "content-type": "text/html",
              "content-security-policy":
                "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
            },
          })
        : new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/fixture") {
      const args = await request.json();
      const view = url.searchParams.get("view");
      const data =
        view === "status"
          ? {
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
            }
          : view === "receipts"
            ? {
                receipts: [
                  {
                    issuedAt: "2026-09-01T00:00:00.000Z",
                    source: "credit_purchase",
                    amountCents: 1000,
                    refundedAmountCents: 200,
                    currency: "USD",
                    status: "partially_refunded",
                  },
                ],
                nextCursor: args.cursor ? null : "bmV4dA",
              }
            : {
                from: args.from ?? "2026-09-01",
                to: args.to ?? "2026-09-11",
                creditsConsumed: 8,
                events: 2,
                byFeature: [
                  {
                    feature: '<img src=x onerror="window.injected=true">',
                    credits: 8,
                    events: 2,
                  },
                ],
                byDay: [
                  { day: "2026-09-01", credits: 3, events: 1 },
                  { day: "2026-09-02", credits: 5, events: 1 },
                ],
              };
      return Response.json({
        content: [{ type: "text", text: "Fixture report" }],
        structuredContent: data,
      });
    }
    return new Response(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP Apps conformance fixture</title></head><body><script type="module" src="/host.js"></script></body></html>',
      { headers: { "content-type": "text/html" } },
    );
  },
});
console.log("MCP_APPS_FIXTURE_READY");

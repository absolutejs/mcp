/** Synthetic external-checkout fixture. No accounts, card inputs or gateway. */
import {
  createCheckoutHandoffTool,
  createMcpHandler,
  createPurchaseStatusTool,
} from "@absolutejs/mcp";

export function createCheckoutCanary(origin: string, now = () => Date.now()) {
  const publicUrl = new URL(origin);
  if (publicUrl.protocol !== "https:" || publicUrl.origin !== origin)
    throw Error("Provide an exact HTTPS checkout origin");
  const purchases = new Map<
    string,
    { token: string; expires: number; approved: boolean }
  >();
  const started = now();
  const checkout = createCheckoutHandoffTool({
    origin,
    issue: async (productId) => {
      if (productId !== "synthetic-1000")
        throw Error("Only synthetic-1000 is supported");
      if (purchases.size >= 100)
        throw Error("Restart the canary before creating more fixtures");
      const purchaseId = crypto.randomUUID();
      const token = crypto.randomUUID();
      const expires = now() + 15 * 60_000;
      purchases.set(purchaseId, { token, expires, approved: false });
      return {
        purchaseId,
        url: `${origin}/checkout#${purchaseId}/${token}`,
        expiresAt: new Date(expires).toISOString(),
      };
    },
  });
  const status = createPurchaseStatusTool({
    read: async (purchaseId) => {
      const purchase = purchases.get(purchaseId);
      return purchase
        ? {
            purchaseId,
            status: purchase.approved ? "approved" : "not_started",
            creditsGranted: purchase.approved ? 1000 : 0,
          }
        : null;
    },
  });
  const handler = createMcpHandler({
    issuer: "http://127.0.0.1:4428",
    path: "/mcp",
    serverInfo: { name: "absolute-checkout-canary", version: "1" },
    authorize: async () => ({
      ok: true,
      caller: "synthetic-fixture",
      scopes: [],
    }),
    // This review authorizes only this synthetic developer fixture. Never reuse
    // it for a real merchant or infer a commerce binding from clientInfo.
    commerce: () => ({
      profiles: ["direct-mcp"],
      capabilities: { externalLinks: true },
      reviews: [
        {
          id: "operator-synthetic-checkout-canary",
          profile: "direct-mcp",
          actions: ["external_checkout"],
          categories: ["usage_credits"],
          reviewedAt: new Date(started).toISOString(),
          expiresAt: new Date(started + 60 * 60_000).toISOString(),
          sourceUrls: ["https://code.visualstudio.com/license"],
        },
      ],
    }),
    tools: () => ({
      prepare_test_checkout: {
        ...checkout,
        description: `SYNTHETIC TEST ONLY. Use productId synthetic-1000. ${checkout.description}`,
      },
      get_test_purchase_status: status,
    }),
  });
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  };
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MCP checkout test</title><style>:root{color-scheme:light dark;font:18px system-ui}body{max-width:40rem;margin:10vh auto;padding:2rem}button{padding:1rem;font:inherit}strong{display:block;margin:1rem 0}</style><h1>MCP checkout test</h1><p>Synthetic developer fixture. No real payment, card information, account or subscription.</p><strong>1,000 simulated credits · $0 charged</strong><p id="status" role="status">Checking test link…</p><button id="approve" disabled>Simulate approval</button><script>
const capability=location.hash.slice(1);history.replaceState(null,'','/checkout');const status=document.getElementById('status'),button=document.getElementById('approve');
async function update(action){button.disabled=true;try{const r=await fetch('/state',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability,action})});if(!r.ok)throw Error('This test link is invalid or expired.');const value=await r.json();status.textContent=value.approved?'Approved — 1,000 simulated credits. Return to your assistant and check purchase status.':'Ready. Opening this page has not approved anything.';button.hidden=value.approved;button.disabled=value.approved;}catch(e){status.textContent=e.message;}}
button.addEventListener('click',()=>update('approve'));update('read');</script></html>`;
  return {
    mcp: handler,
    checkout: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname === "/checkout" && request.method === "GET")
        return new Response(page, { headers });
      if (url.pathname !== "/state" || request.method !== "POST")
        return new Response("Not found", { status: 404 });
      if (
        request.headers.get("origin") !== origin ||
        !request.headers.get("content-type")?.startsWith("application/json")
      )
        return new Response("Forbidden", { status: 403 });
      const raw = await request.text();
      if (raw.length > 1024) return new Response("Too large", { status: 413 });
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      if (
        !input ||
        typeof input.capability !== "string" ||
        !["read", "approve"].includes(input.action)
      )
        return new Response("Invalid request", { status: 400 });
      const [id, token, extra] = input.capability.split("/");
      const purchase = purchases.get(id);
      if (
        extra !== undefined ||
        !purchase ||
        purchase.token !== token ||
        purchase.expires <= now()
      )
        return new Response("Invalid or expired test link", { status: 404 });
      if (input.action === "approve") purchase.approved = true;
      return Response.json(
        { approved: purchase.approved },
        { headers: { "cache-control": "no-store" } },
      );
    },
  };
}

if (import.meta.main) {
  const fixture = createCheckoutCanary(
    process.env.CANARY_CHECKOUT_ORIGIN ?? "",
  );
  Bun.serve({
    hostname: "127.0.0.1",
    port: 4438,
    fetch: async (request) => {
      const response = await fixture.checkout(request);
      const path = new URL(request.url).pathname;
      console.log(
        JSON.stringify({
          surface: "checkout",
          method: request.method,
          route: path === "/checkout" || path === "/state" ? path : "unknown",
          status: response.status,
        }),
      );
      return response;
    },
  });
  Bun.serve({
    hostname: "127.0.0.1",
    port: 4428,
    fetch: async (request) => {
      let rpc;
      try {
        if (request.method === "POST") rpc = await request.clone().json();
      } catch {
        /* handler validates */
      }
      const response =
        (await fixture.mcp(request)) ??
        new Response("Not found", { status: 404 });
      // Never log checkout capabilities, arguments, transcripts or auth headers.
      console.log(
        JSON.stringify({
          method: rpc?.method ?? request.method,
          status: response.status,
          ...(rpc?.method === "initialize"
            ? {
                client: rpc.params?.clientInfo?.name,
                version: rpc.params?.clientInfo?.version,
              }
            : {}),
          ...(rpc?.method === "tools/call" ? { tool: rpc.params?.name } : {}),
        }),
      );
      return response;
    },
  });
  console.log(
    JSON.stringify({
      ready: true,
      mcp: "http://127.0.0.1:4428/mcp",
      checkoutPort: 4438,
      synthetic: true,
      payments: false,
    }),
  );
}

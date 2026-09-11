import { createMemoryMcpTaskStore } from "../src/tasks";
import { describe, expect, test } from "bun:test";
import {
  evaluateCommerce,
  type CommerceContext,
  type CommerceRequirement,
  type CommerceProfile,
} from "../src/commerce";
import { dispatchMcp } from "../src/dispatch";
import type { McpServerConfig } from "../src/types";
const now = new Date("2026-09-10T12:00:00Z");
const credits: CommerceRequirement = {
  action: "external_checkout",
  categories: ["usage_credits"],
};
const reviewed = (
  profile: CommerceProfile = "direct-mcp",
  requirement = credits,
): CommerceContext => ({
  profiles: [profile],
  capabilities: {
    externalLinks: true,
    interactiveUi: true,
    nativePaymentSheet: true,
  },
  reviews: [
    {
      id: "review-1",
      profile,
      actions: [requirement.action],
      categories: requirement.categories,
      reviewedAt: "2026-09-01T00:00:00Z",
      expiresAt: "2099-10-01T00:00:00Z",
      sourceUrls: ["https://merchant.example/policy-review"],
    },
  ],
});
describe("commerce eligibility", () => {
  test("unknown and empty profiles do not enable checkout", () => {
    expect(
      evaluateCommerce(credits, { profiles: ["unknown"] }, now).allowed,
    ).toBe(false);
    expect(evaluateCommerce(credits, { profiles: [] }, now).allowed).toBe(
      false,
    );
  });
  test("capability support alone does not permit commerce", () => {
    expect(
      evaluateCommerce(
        credits,
        { profiles: ["direct-mcp"], capabilities: { externalLinks: true } },
        now,
      ).reason,
    ).toBe("commerce_review_required");
  });
  test("reviewed direct deployment allows an external handoff", () => {
    expect(evaluateCommerce(credits, reviewed(), now)).toMatchObject({
      allowed: true,
      reviewIds: ["review-1"],
    });
  });
  test("published digital restriction defeats reviews and mixed carts", () => {
    for (const categories of [
      ["usage_credits"],
      ["physical_goods", "digital_service"],
    ] as const) {
      const req = { ...credits, categories };
      expect(
        evaluateCommerce(req, reviewed("chatgpt-plugin", req), now),
      ).toMatchObject({
        status: "restricted",
        reason: "chatgpt_digital_commerce",
      });
    }
  });
  test("all digital sales actions are restricted", () => {
    for (const action of [
      "pricing",
      "external_checkout",
      "saved_method_purchase",
      "new_method_collection",
      "subscription",
      "automatic_refill",
    ] as const) {
      const req = { ...credits, action };
      expect(
        evaluateCommerce(req, reviewed("chatgpt-plugin", req), now).status,
      ).toBe("restricted");
    }
  });
  test("Claude cannot execute purchases even with a review", () => {
    const req = { ...credits, action: "saved_method_purchase" as const };
    expect(
      evaluateCommerce(req, reviewed("claude-interactive", req), now).reason,
    ).toBe("claude_interactive_purchases");
  });
  test("marketplace paid access is distinct from direct configuration", () => {
    const req = { ...credits, action: "paid_access" as const };
    expect(
      evaluateCommerce(req, reviewed("cursor-marketplace", req), now).status,
    ).toBe("restricted");
    expect(
      evaluateCommerce(req, reviewed("direct-mcp", req), now).allowed,
    ).toBe(true);
  });
  test("ambiguous channels intersect instead of choosing a permissive host", () => {
    const ctx = reviewed();
    ctx.profiles = ["direct-mcp", "chatgpt-plugin"];
    expect(evaluateCommerce(credits, ctx, now).status).toBe("restricted");
  });
  test("expired, future, category-mismatched and invalid-source reviews fail closed", () => {
    for (const change of [
      { expiresAt: now.toISOString() },
      { reviewedAt: "2099-01-01" },
      { sourceUrls: [] },
      { sourceUrls: ["javascript:alert(1)"] },
      { categories: ["physical_goods"] },
    ]) {
      const ctx = reviewed();
      Object.assign(ctx.reviews![0]!, change);
      expect(evaluateCommerce(credits, ctx, now).allowed).toBe(false);
    }
  });
  test("missing capabilities cannot be papered over by review", () => {
    const ctx = reviewed();
    ctx.capabilities = {};
    expect(evaluateCommerce(credits, ctx, now).reason).toBe(
      "external_links_unavailable",
    );
  });
  test("ChatGPT physical new-method collection requires native payment sheet", () => {
    const req: CommerceRequirement = {
      action: "new_method_collection",
      categories: ["physical_goods"],
    };
    const ctx = reviewed("chatgpt-plugin", req);
    ctx.capabilities!.nativePaymentSheet = false;
    expect(evaluateCommerce(req, ctx, now).reason).toBe(
      "chatgpt_native_payment_sheet_required",
    );
  });
  test("informational and balance recovery stay separate from purchases", () => {
    expect(
      evaluateCommerce(
        { ...credits, action: "entitlement_status" },
        { profiles: ["unknown"] },
        now,
      ).allowed,
    ).toBe(true);
    expect(
      evaluateCommerce(
        { ...credits, action: "informational_link" },
        { profiles: ["chatgpt-plugin"], capabilities: { externalLinks: true } },
        now,
      ).allowed,
    ).toBe(true);
  });
});
describe("MCP commerce enforcement", () => {
  const config = (
    onExecute: () => void,
    context?: McpServerConfig<string>["commerce"],
  ): McpServerConfig<string> => ({
    authorize: async () => ({ ok: true, caller: "user" }),
    issuer: "https://merchant.example",
    path: "/mcp",
    serverInfo: { name: "merchant", version: "1" },
    commerce: context,
    tools: () => ({
      buy: {
        commerce: credits,
        description: "Open checkout",
        inputSchema: { type: "object" },
        handler: () => {
          onExecute();
          return "checkout";
        },
      },
      balance: {
        description: "Read balance",
        inputSchema: { type: "object" },
        handler: () => "0",
      },
    }),
  });
  const rpc = async (
    cfg: McpServerConfig<string>,
    method: string,
    params = {},
  ) =>
    (
      await dispatchMcp(cfg, "user", [], {
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      })
    ).json();
  test("missing policy hides commerce tools and blocks direct calls without affecting balance", async () => {
    let executed = 0;
    const cfg = config(() => executed++);
    expect(
      (await rpc(cfg, "tools/list")).result.tools.map(
        (t: { name: string }) => t.name,
      ),
    ).toEqual(["balance"]);
    expect((await rpc(cfg, "tools/call", { name: "buy" })).result.isError).toBe(
      true,
    );
    expect(
      (await rpc(cfg, "tools/call", { name: "balance" })).result.content[0]
        .text,
    ).toBe("0");
    expect(executed).toBe(0);
  });
  test("policy is resolved again after discovery; spoofed call metadata cannot override it", async () => {
    let executed = 0;
    let ctx = reviewed();
    const cfg = config(
      () => executed++,
      () => ctx,
    );
    expect((await rpc(cfg, "tools/list")).result.tools).toHaveLength(2);
    ctx = { profiles: ["chatgpt-plugin"] };
    const result = await rpc(cfg, "tools/call", {
      name: "buy",
      arguments: { host: "direct-mcp" },
      _meta: { clientInfo: { name: "direct-mcp" } },
    });
    expect(result.result.structuredContent.reason).toBe(
      "chatgpt_digital_commerce",
    );
    expect(executed).toBe(0);
  });
  test("resolver failure blocks execution without leaking its error", async () => {
    let executed = 0;
    const cfg = config(
      () => executed++,
      () => {
        throw new Error("secret");
      },
    );
    const result = await rpc(cfg, "tools/call", { name: "buy" });
    expect(result.result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(executed).toBe(0);
  });
  test("delayed tasks recheck policy before executing", async () => {
    let executed = 0;
    let ctx = reviewed();
    const cfg = config(
      () => executed++,
      () => ctx,
    );
    const registry = cfg.tools;
    cfg.tools = async (input) => {
      const tools = await registry(input);
      tools.buy!.taskSupport = "optional";
      return tools;
    };
    cfg.tasks = {
      store: createMemoryMcpTaskStore(),
      authorizationKey: () => "user",
      shouldCreate: () => true,
    };
    const response = await dispatchMcp(
      cfg,
      "user",
      [],
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "buy", task: {} },
      },
      { protocolVersion: "2025-11-25" },
    );
    const payload = await response.json();
    expect(payload.result.task.taskId).toBeString();
    ctx = { profiles: ["chatgpt-plugin"] };
    for (let i = 0; i < 30; i++) {
      const task = await cfg.tasks.store.get(payload.result.task.taskId);
      if (task?.status === "failed") break;
      await Bun.sleep(5);
    }
    expect(
      (await cfg.tasks.store.get(payload.result.task.taskId))?.status,
    ).toBe("failed");
    expect(executed).toBe(0);
  });
  test("invalid categories cannot default to physical goods", () => {
    expect(
      evaluateCommerce({ ...credits, categories: [] }, reviewed(), now).allowed,
    ).toBe(false);
    expect(
      evaluateCommerce(
        { ...credits, categories: ["unknown" as never] },
        reviewed(),
        now,
      ).allowed,
    ).toBe(false);
  });
  test("allowed calls retain audit evidence and execute once", async () => {
    let executed = 0;
    let meta: unknown;
    const cfg = config(
      () => executed++,
      () => reviewed(),
    );
    cfg.onCall = (r) => {
      meta = r.meta;
    };
    expect(
      (await rpc(cfg, "tools/call", { name: "buy" })).result.content[0].text,
    ).toBe("checkout");
    expect(executed).toBe(1);
    expect(meta).toMatchObject({
      commerceDecision: { allowed: true, reviewIds: ["review-1"] },
    });
  });
});

import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import type { McpServerConfig } from "./types";

/* Serializable subset of McpServerConfig: endpoint identity and discovery
 * metadata only. authorize / tools / prompts / resources / beforeCall /
 * onCall / elicitation are function-or-instance-valued → wiring concerns.
 * This package has no AI tools of its own on purpose: it is the transport
 * that serves OTHER packages' manifest tools over MCP. */
export const manifest = defineManifest<McpServerConfig<unknown>>()({
  contract: 1,
  identity: {
    accent: "#0ea5e9",
    category: "ai",
    description:
      "Serve a remote Model Context Protocol endpoint (streamable HTTP, stateless) from your Elysia app. Bridge installed AbsoluteJS packages' manifests with `toMcpToolRegistry` and their tools become callable by any connected MCP client; OAuth bearer auth, RFC 9728 discovery, and per-call guards are yours to wire.",
    docsUrl: "https://github.com/absolutejs/mcp",
    name: "@absolutejs/mcp",
    tagline: "Let AI assistants connect to your site and use its tools.",
  },
  requires: {
    peers: [{ name: "elysia", range: ">=1.1.0", reason: "plugin host" }],
  },
  settings: Type.Object({
    instructions: Type.Optional(
      Type.String({
        description:
          "A short note shown to the AI about what this server does and how to use it.",
        title: "Instructions for the AI",
      }),
    ),
    issuer: Type.String({
      description:
        "The web address of the sign-in server that issues access tokens for this endpoint. Usually your site's own address.",
      examples: ["https://yoursite.com"],
      format: "uri",
      title: "Token issuer",
    }),
    path: Type.String({
      default: "/mcp",
      description: "Where on your site the AI endpoint lives.",
      title: "Endpoint path",
    }),
    scopesSupported: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "The permission scopes this endpoint advertises to connecting clients.",
        examples: [["openid", "mcp"]],
        title: "Advertised scopes",
        "x-group": "advanced",
      }),
    ),
    serveRootMetadata: Type.Optional(
      Type.Boolean({
        description:
          "Also answer discovery requests at the site root. Turn on for exactly one endpoint per site.",
        title: "Answer root discovery",
        "x-group": "advanced",
      }),
    ),
    serverInfo: Type.Optional(
      Type.Object(
        {
          name: Type.Optional(
            Type.String({ title: "Machine name", examples: ["your-site"] }),
          ),
          title: Type.Optional(
            Type.String({ title: "Display name", examples: ["Your Site"] }),
          ),
          version: Type.Optional(
            Type.String({ title: "Version", examples: ["1.0.0"] }),
          ),
        },
        {
          description: "How this server introduces itself to connecting AI clients.",
          title: "Server identity",
        },
      ),
    ),
  }),
  wiring: [
    {
      description:
        "Mount a remote MCP endpoint that serves the tools of installed AbsoluteJS packages — bridge each package's manifest and any MCP client (Claude, etc.) can call them.",
      id: "default",
      server: {
        code: [
          ".use(",
          "\tmcpServer({",
          "\t\t// TODO: decide who may call this endpoint — see verifyBearer for",
          "\t\t// the standard OAuth bearer-token checks. Denies everyone until",
          "\t\t// you wire it.",
          "\t\tauthorize: async () => ({",
          "\t\t\tok: false,",
          "\t\t\treason: 'authorization not configured'",
          "\t\t}),",
          "\t\tinstructions: ${settings.instructions},",
          "\t\tissuer: ${settings.issuer},",
          "\t\tpath: ${settings.path},",
          "\t\tscopesSupported: ${settings.scopesSupported},",
          "\t\tserveRootMetadata: ${settings.serveRootMetadata},",
          "\t\tserverInfo: ${settings.serverInfo} ?? { name: 'my-site', version: '0.1.0' },",
          "\t\ttools: async () => {",
          "\t\t\t// Every installed AbsoluteJS package ships a manifest; bridging",
          "\t\t\t// it exposes that package's tools here. Pass the live instance",
          "\t\t\t// you constructed for the package as `runtime` — tools without",
          "\t\t\t// their binding are omitted (fail closed).",
          "\t\t\t// TODO: list the packages this endpoint should expose.",
          "\t\t\tconst exposed: { name: string; runtime?: unknown }[] = [];",
          "\t\t\tconst registries = await Promise.all(",
          "\t\t\t\texposed.map(async ({ name, runtime }) => {",
          "\t\t\t\t\tconst loaded = await loadManifest(name);",
          "",
          "\t\t\t\t\treturn loaded.ok",
          "\t\t\t\t\t\t? toMcpToolRegistry(loaded.manifest, { runtime })",
          "\t\t\t\t\t\t: {};",
          "\t\t\t\t})",
          "\t\t\t);",
          "",
          "\t\t\treturn Object.assign({}, ...registries);",
          "\t\t}",
          "\t})",
          ")",
        ].join("\n"),
        imports: [
          { from: "@absolutejs/mcp", names: ["mcpServer"] },
          {
            from: "@absolutejs/manifest",
            names: ["loadManifest", "toMcpToolRegistry"],
          },
        ],
        placement: "server-plugin",
      },
      title: "Serve installed packages' tools over MCP",
    },
  ],
});

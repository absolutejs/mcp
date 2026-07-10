// The MCP method dispatcher. Pure and framework-free: given the server config,
// a resolved caller, and one decoded JSON-RPC message, it produces the Response.
// Capabilities advertised on `initialize` are derived from what the config
// actually provides (prompts/resources are optional).

import { isRecord } from "./guards";
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  notificationAck,
  rpcError,
  rpcResult,
  type JsonRpcId,
} from "./jsonrpc";
import type { McpCallMeta, McpServerConfig } from "./types";

const DEFAULT_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_RESOURCE_MIME = "text/markdown";

const idOf = (message: Record<string, unknown>): JsonRpcId =>
  typeof message.id === "string" || typeof message.id === "number"
    ? message.id
    : null;

const negotiateProtocol = (supported: string[], params: unknown) => {
  const preferred = supported[0] ?? DEFAULT_PROTOCOLS[0] ?? "";
  const requested =
    isRecord(params) && typeof params.protocolVersion === "string"
      ? params.protocolVersion
      : preferred;

  return supported.includes(requested) ? requested : preferred;
};

const initialize = <Caller>(
  config: McpServerConfig<Caller>,
  id: JsonRpcId,
  params: unknown,
) => {
  const supported = config.supportedProtocols ?? DEFAULT_PROTOCOLS;
  const capabilities: Record<string, unknown> = {
    tools: { listChanged: false },
  };
  if (config.prompts) capabilities.prompts = { listChanged: false };
  if (config.resources) {
    capabilities.resources = { listChanged: false, subscribe: false };
  }

  return rpcResult(id, {
    capabilities,
    ...(config.instructions === undefined
      ? {}
      : { instructions: config.instructions }),
    protocolVersion: negotiateProtocol(supported, params),
    serverInfo: config.serverInfo,
  });
};

const toolsList = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
) => {
  const tools = await config.tools({ caller, meta: {} });

  return rpcResult(id, {
    tools: Object.entries(tools).map(([name, tool]) => ({
      annotations: tool.annotations,
      description: tool.description,
      inputSchema: tool.inputSchema,
      name,
    })),
  });
};

const errorResult = (id: JsonRpcId, text: string) =>
  rpcResult(id, { content: [{ text, type: "text" }], isError: true });

const toolsCall = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
) => {
  if (!isRecord(params) || typeof params.name !== "string") {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "tools/call needs a name");
  }
  const name = params.name;
  const args = params.arguments ?? {};
  const meta: McpCallMeta = {};
  if (config.beforeCall) {
    const gate = await config.beforeCall({ args, caller, meta, name });
    if (gate) return errorResult(id, gate.block);
  }
  const tools = await config.tools({ caller, meta });
  const tool = tools[name];
  if (!tool)
    return rpcError(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
  let ok = false;
  let response: Response;
  try {
    const text = await tool.handler(args);
    ok = true;
    response = rpcResult(id, {
      content: [{ text, type: "text" }],
      isError: false,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    response = errorResult(id, `Tool failed: ${detail}`);
  }
  if (config.onCall) await config.onCall({ args, caller, meta, name, ok });

  return response;
};

const promptsList = <Caller>(
  config: McpServerConfig<Caller>,
  id: JsonRpcId,
) => {
  const definitions = config.prompts?.definitions ?? {};

  return rpcResult(id, {
    prompts: Object.entries(definitions).map(([name, def]) => ({
      arguments: def.arguments ?? [],
      description: def.description,
      name,
      title: def.title,
    })),
  });
};

const promptsGet = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
) => {
  const prompts = config.prompts;
  if (!prompts) return rpcError(id, JSONRPC_METHOD_NOT_FOUND, "No prompts");
  if (!isRecord(params) || typeof params.name !== "string") {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "prompts/get needs a name");
  }
  const def = prompts.definitions[params.name];
  if (!def) {
    return rpcError(
      id,
      JSONRPC_INVALID_PARAMS,
      `Unknown prompt: ${params.name}`,
    );
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  const text = await prompts.get({ args, caller, name: params.name });
  if (text === null) {
    return rpcError(id, JSONRPC_INTERNAL_ERROR, "Prompt failed to build");
  }

  return rpcResult(id, {
    description: def.description,
    messages: [{ content: { text, type: "text" }, role: "user" }],
  });
};

const resourcesList = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
) => {
  const resources = config.resources;
  if (!resources) return rpcResult(id, { resources: [] });

  return rpcResult(id, { resources: await resources.list({ caller }) });
};

const resourcesRead = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
) => {
  const resources = config.resources;
  if (!resources) return rpcError(id, JSONRPC_METHOD_NOT_FOUND, "No resources");
  if (!isRecord(params) || typeof params.uri !== "string") {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "resources/read needs a uri");
  }
  const uri = params.uri;
  const text = await resources.read({ caller, uri });
  if (text === null) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, `Unknown resource: ${uri}`);
  }

  return rpcResult(id, {
    contents: [
      { mimeType: resources.mimeType ?? DEFAULT_RESOURCE_MIME, text, uri },
    ],
  });
};

/** Route one decoded JSON-RPC message to its handler. Notifications (no `id`)
 *  get a bare 202. Unknown methods get JSON-RPC method-not-found. */
export const dispatchMcp = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  message: unknown,
): Promise<Response> => {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return rpcError(
      null,
      JSONRPC_INVALID_REQUEST,
      "Not a JSON-RPC 2.0 message",
    );
  }
  if (!("id" in message)) return notificationAck();
  const id = idOf(message);
  const method = typeof message.method === "string" ? message.method : "";
  const { params } = message;
  if (method === "initialize") return initialize(config, id, params);
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return toolsList(config, caller, id);
  if (method === "tools/call") return toolsCall(config, caller, id, params);
  if (method === "prompts/list") return promptsList(config, id);
  if (method === "prompts/get") return promptsGet(config, caller, id, params);
  if (method === "resources/list") return resourcesList(config, caller, id);
  if (method === "resources/read") {
    return resourcesRead(config, caller, id, params);
  }

  return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Unknown method: ${method}`);
};

// The MCP method dispatcher. Pure and framework-free: given the server config,
// a resolved caller, its scopes, and one decoded JSON-RPC message, it produces
// the Response. Capabilities advertised on `initialize` are derived from what
// the config actually provides (prompts/resources are optional).

import { createCoazActionInput } from "@absolutejs/agency/authzen";

import { isRecord } from "./guards";
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_MISSING_REQUIRED_CLIENT_CAPABILITY,
  notificationAck,
  rpcError,
  rpcResult,
  type JsonRpcId,
} from "./jsonrpc";
import type { SessionRegistry } from "./sessions";
import type {
  McpCallMeta,
  McpElicitResult,
  McpServerConfig,
  McpTool,
  McpToolCallContext,
  McpToolResult,
  McpToolReturn,
} from "./types";
import { publicMcpTask } from "./tasks";

/** Everything a dispatch needs to know about the HTTP request it came in on.
 *  Only elicitation uses it; without it the dispatcher is exactly as stateless
 *  as it was. */
export type McpDispatchContext = {
  protocolVersion?: string;
  requestSignal?: AbortSignal;
  sessionId?: string | null;
  sessions?: SessionRegistry;
};

export const MCP_LATEST_PROTOCOL_VERSION = "2025-11-25" as const;
const DEFAULT_PROTOCOLS = [
  MCP_LATEST_PROTOCOL_VERSION,
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
const DEFAULT_RESOURCE_MIME = "text/markdown";
const DEFAULT_LIST_PAGE_SIZE = 50;

/** Opaque list cursor (base64 offset). A malformed/foreign cursor reads as
 *  page zero rather than erroring — the spec treats cursors as opaque. */
const decodeCursor = (params: unknown) => {
  if (!isRecord(params) || typeof params.cursor !== "string") return 0;
  try {
    const parsed = Number.parseInt(atob(params.cursor), 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const encodeCursor = (offset: number) => btoa(String(offset));

/** One page of a list + the nextCursor when more remain. */
const paginate = <Item>(items: Item[], offset: number, pageSize: number) => {
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;

  return {
    items: page,
    ...(nextOffset < items.length
      ? { nextCursor: encodeCursor(nextOffset) }
      : {}),
  };
};

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

/** A tool with no `scope` is always available; a scoped tool needs the caller
 *  to hold that scope. Fails closed — unknown scopes hide a scoped tool. */
const scopeAllows = (tool: McpTool, scopes: string[]) =>
  tool.scope === undefined || scopes.includes(tool.scope);

const valueAtPath = (value: unknown, path: string) => {
  let current = value;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
};

const agencyAllows = <Caller>(
  config: McpServerConfig<Caller>,
  tool: McpTool,
  scopes: string[],
) =>
  tool.authorization === undefined ||
  (config.agency !== undefined &&
    (tool.authorization.requiredScopes ?? []).every((scope) =>
      scopes.includes(scope),
    ));

/** A handler may return a bare string, a content array, or a full result.
 *  Normalise to the wire shape so every path produces valid `tools/call` output. */
const normalizeResult = (value: McpToolReturn): McpToolResult => {
  if (typeof value === "string") {
    return { content: [{ text: value, type: "text" }], isError: false };
  }
  if (Array.isArray(value)) return { content: value, isError: false };

  return { isError: false, ...value };
};

/** Did the client declare `capabilities.elicitation`? Only then may we ask its
 *  user anything. */
const clientElicitation = (params: unknown) => {
  if (!isRecord(params) || !isRecord(params.capabilities)) {
    return { form: false, url: false };
  }
  const elicitation = params.capabilities.elicitation;
  if (!isRecord(elicitation)) return { form: false, url: false };
  // The empty legacy capability means form mode only.
  return {
    form: Object.keys(elicitation).length === 0 || isRecord(elicitation.form),
    url: isRecord(elicitation.url),
  };
};

const initialize = async <Caller>(
  config: McpServerConfig<Caller>,
  id: JsonRpcId,
  params: unknown,
  context: McpDispatchContext,
) => {
  const supported = config.supportedProtocols ?? DEFAULT_PROTOCOLS;
  const protocolVersion = negotiateProtocol(supported, params);
  const capabilities: Record<string, unknown> = {
    tools: { listChanged: false },
  };
  if (config.tasks !== undefined) {
    if (protocolVersion === MCP_LATEST_PROTOCOL_VERSION) {
      capabilities.tasks = {
        cancel: {},
        list: {},
        requests: { tools: { call: {} } },
      };
    } else {
      capabilities.extensions = { "io.modelcontextprotocol/tasks": {} };
    }
  }
  if (config.prompts) capabilities.prompts = { listChanged: false };
  if (config.resources) {
    capabilities.resources = { listChanged: false, subscribe: false };
  }

  const response = rpcResult(id, {
    capabilities,
    ...(config.instructions === undefined
      ? {}
      : { instructions: config.instructions }),
    protocolVersion,
    serverInfo: config.serverInfo,
  });

  // A session exists for ONE reason: to let the client's answer to an
  // elicitation find the call that is waiting for it. No elicitation, no
  // session, no state.
  if (!config.elicitation?.enabled || !context.sessions) return response;
  const elicitation = clientElicitation(params);
  const sessionId = await context.sessions.create(
    elicitation.form || elicitation.url,
    elicitation.url,
  );
  response.headers.set("Mcp-Session-Id", sessionId);

  return response;
};

const toolsList = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  scopes: string[],
  id: JsonRpcId,
  params: unknown,
  protocolVersion?: string,
) => {
  const tools = await config.tools({ caller, meta: {} });
  const visible = Object.entries(tools)
    .filter(
      ([, tool]) =>
        scopeAllows(tool, scopes) && agencyAllows(config, tool, scopes),
    )
    .map(([name, tool]) => ({
      annotations: tool.annotations,
      ...(tool.coaz === undefined ? {} : { coaz: tool.coaz }),
      description: tool.description,
      inputSchema: tool.inputSchema,
      name,
      ...(tool.outputSchema === undefined
        ? {}
        : { outputSchema: tool.outputSchema }),
      ...(protocolVersion === MCP_LATEST_PROTOCOL_VERSION &&
      tool.taskSupport !== undefined
        ? { execution: { taskSupport: tool.taskSupport } }
        : {}),
    }));
  const { items, nextCursor } = paginate(
    visible,
    decodeCursor(params),
    config.listPageSize ?? DEFAULT_LIST_PAGE_SIZE,
  );

  return rpcResult(id, {
    tools: items,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
};

const errorResult = (id: JsonRpcId, text: string) =>
  rpcResult(id, { content: [{ text, type: "text" }], isError: true });

/** The context every handler gets. When the tool can't (or the client won't)
 *  elicit, `elicit()` answers "unsupported" straight away — a tool never has to
 *  branch on transport. */
const noElicit: McpToolCallContext = {
  canElicit: false,
  canElicitUrl: false,
  elicit: () => Promise.resolve<McpElicitResult>({ action: "unsupported" }),
};

const SSE_HEADERS: Record<string, string> = {
  "cache-control": "no-cache",
  connection: "keep-alive",
  "content-type": "text/event-stream",
  "x-accel-buffering": "no",
};

const sseFrame = (message: unknown) => `data: ${JSON.stringify(message)}\n\n`;

/** Run the handler and produce the tools/call Response. */
const runTool = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  scopes: string[],
  id: JsonRpcId,
  name: string,
  args: unknown,
  meta: McpCallMeta,
  tool: McpTool,
  context: McpToolCallContext,
) => {
  let ok = false;
  let payload: unknown;
  try {
    const invoke = async () =>
      normalizeResult(await tool.handler(args, context));
    let result: McpToolResult;
    if (tool.authorization === undefined) {
      result = await invoke();
    } else {
      const agency = config.agency;
      if (agency === undefined)
        throw new Error("Agent action policy is not configured");
      const actor = await agency.resolveActor({ caller, scopes });
      const actionInput = createCoazActionInput({
        actor,
        call: {
          arguments: args,
          name,
          serverId: agency.serverId ?? config.serverInfo.name,
        },
        effects: tool.authorization.effects,
        requiredScopes: tool.authorization.requiredScopes,
      });
      const amount = tool.authorization.spend
        ? valueAtPath(args, tool.authorization.spend.amountMinorField)
        : undefined;
      const currency = tool.authorization.spend
        ? valueAtPath(args, tool.authorization.spend.currencyField)
        : undefined;
      const idempotencyBinding = tool.authorization.idempotency;
      const idempotencyKey =
        idempotencyBinding?.mode === "field"
          ? valueAtPath(args, idempotencyBinding.field)
          : undefined;
      const requested = await agency.enforcement.request({
        ...actionInput,
        context: {
          ...actionInput.context,
          manifest_authorization: tool.authorization,
        },
        idempotencyKey:
          typeof idempotencyKey === "string" ? idempotencyKey : undefined,
        spend:
          typeof amount === "number" && typeof currency === "string"
            ? { amountMinor: amount, currency }
            : undefined,
      });
      meta.agencyActionId = requested.action.actionId;
      meta.agencyDecisionId = requested.decision.decisionId;
      if (requested.decision.kind === "deny") {
        result = {
          content: [
            {
              text: requested.decision.requestable
                ? `Action requires approval (${requested.action.actionId})`
                : `Action denied: ${requested.decision.reason}`,
              type: "text",
            },
          ],
          isError: true,
          structuredContent: {
            actionId: requested.action.actionId,
            decision: requested.decision,
            type: "absolute.action_decision",
          },
        };
      } else {
        const lease = await agency.enforcement.issueLease(
          requested.action.actionId,
        );
        const executed = await agency.enforcement.execute({
          executor: `mcp:${config.serverInfo.name}/${name}`,
          leaseId: lease.leaseId,
          run: invoke,
        });
        meta.agencyLeaseId = lease.leaseId;
        meta.agencyReceiptId = executed.receipt.receiptId;
        result = executed.result;
      }
    }
    ok = result.isError !== true;
    payload = { id, jsonrpc: "2.0", result };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    payload = {
      id,
      jsonrpc: "2.0",
      result: {
        content: [{ text: `Tool failed: ${detail}`, type: "text" }],
        isError: true,
      },
    };
  }
  if (config.onCall) await config.onCall({ args, caller, meta, name, ok });

  return payload;
};

/** A tool that may ask the user something has to answer over SSE: the question
 *  travels down this stream while the call is still open, and the client's
 *  answer arrives on a SEPARATE POST that resolves the promise. The stream
 *  closes as soon as the tool result is sent. */
const toolsCallStreaming = <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  scopes: string[],
  id: JsonRpcId,
  name: string,
  args: unknown,
  meta: McpCallMeta,
  tool: McpTool,
  sessions: SessionRegistry,
  canElicit: boolean,
  canElicitUrl: boolean,
) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (message: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(message)));
        } catch {
          open = false;
        }
      };
      const context: McpToolCallContext = {
        canElicit,
        canElicitUrl,
        elicit: async (request) => {
          if (!canElicit) return { action: "unsupported" };
          if (request.mode === "url") {
            if (!canElicitUrl) return { action: "unsupported" };
            let url: URL;
            try {
              url = new URL(request.url);
            } catch {
              throw new Error("URL elicitation requires a valid URL");
            }
            const localDevelopment =
              url.protocol === "http:" &&
              (url.hostname === "localhost" || url.hostname === "127.0.0.1");
            if (
              (url.protocol !== "https:" && !localDevelopment) ||
              url.username !== "" ||
              url.password !== ""
            ) {
              throw new Error(
                "URL elicitation requires HTTPS without embedded credentials",
              );
            }
          }
          const pending = sessions.startElicit(request);
          send({
            id: pending.id,
            jsonrpc: "2.0",
            method: "elicitation/create",
            params: request,
          });

          return await pending.answer;
        },
      };
      const payload = await runTool(
        config,
        caller,
        scopes,
        id,
        name,
        args,
        meta,
        tool,
        context,
      );
      send(payload);
      if (open) {
        try {
          controller.close();
        } catch {
          open = false;
        }
      }
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
};

const toolsCall = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  scopes: string[],
  id: JsonRpcId,
  params: unknown,
  context: McpDispatchContext,
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
  // Scope-gated tools that the caller can't see are reported as unknown, so a
  // hidden tool is indistinguishable from one that doesn't exist.
  if (
    !tool ||
    !scopeAllows(tool, scopes) ||
    !agencyAllows(config, tool, scopes)
  ) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
  }

  const tasks = config.tasks;
  const nativeTasks = context.protocolVersion === MCP_LATEST_PROTOCOL_VERSION;
  const requestedTaskParams = isRecord(params.task) ? params.task : undefined;
  const requestedTask = requestedTaskParams !== undefined;
  const taskSupport = tool.taskSupport ?? "forbidden";
  if (nativeTasks && requestedTask && tasks === undefined) {
    return rpcError(id, JSONRPC_METHOD_NOT_FOUND, "Tasks are not configured");
  }
  if (nativeTasks && requestedTask && taskSupport === "forbidden") {
    return rpcError(
      id,
      JSONRPC_METHOD_NOT_FOUND,
      "Tool does not support task execution",
    );
  }
  if (nativeTasks && !requestedTask && taskSupport === "required") {
    return rpcError(
      id,
      JSONRPC_METHOD_NOT_FOUND,
      "Tool requires task execution",
    );
  }
  const shouldCreateTask =
    tasks !== undefined &&
    (nativeTasks
      ? requestedTask && taskSupport !== "forbidden"
      : await tasks.shouldCreate({ args, caller, name }));
  if (tasks !== undefined && shouldCreateTask) {
    if (!nativeTasks && !supportsTasks(params)) {
      return rpcError(
        id,
        JSONRPC_MISSING_REQUIRED_CLIENT_CAPABILITY,
        "Missing required client capability",
        {
          requiredCapabilities: {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      );
    }
    const createdAt = new Date().toISOString();
    const requestedTtl =
      requestedTaskParams !== undefined &&
      typeof requestedTaskParams.ttl === "number" &&
      requestedTaskParams.ttl >= 0
        ? requestedTaskParams.ttl
        : undefined;
    const task = {
      authorizationKey: await tasks.authorizationKey(caller),
      createdAt,
      lastUpdatedAt: createdAt,
      pollIntervalMs: tasks.pollIntervalMs,
      status: "working" as const,
      taskId: crypto.randomUUID(),
      ttlMs: tasks.ttlMs ?? requestedTtl ?? null,
    };
    await tasks.store.save(task);
    setTimeout(() => {
      void runTool(config, caller, scopes, id, name, args, meta, tool, noElicit)
        .then(async (payload) => {
          const result =
            isRecord(payload) && isRecord(payload.result)
              ? payload.result
              : { content: [], isError: true };
          await tasks.store.update(task.taskId, {
            result,
            status: result.isError === true ? "failed" : "completed",
          });
        })
        .catch(async (error) => {
          await tasks.store.update(task.taskId, {
            error: {
              code: JSONRPC_INTERNAL_ERROR,
              message: error instanceof Error ? error.message : "Task failed",
            },
            status: "failed",
          });
        });
    }, 0);

    return nativeTasks
      ? rpcResult(id, { task: publicMcpTask(task) })
      : rpcResult(id, { ...publicMcpTask(task), resultType: "task" });
  }

  // A tool that may ask the user something answers over SSE — but only when
  // there IS a session to hang the question on. Otherwise it runs normally with
  // canElicit false, which every eliciting tool has to handle anyway.
  const sessions = context.sessions;
  const session = sessions
    ? await sessions.get(context.sessionId ?? null)
    : null;
  if (
    tool.mayElicit === true &&
    config.elicitation?.enabled === true &&
    sessions &&
    session
  ) {
    return toolsCallStreaming(
      config,
      caller,
      scopes,
      id,
      name,
      args,
      meta,
      tool,
      sessions,
      session.canElicit,
      session.canElicitUrl ?? false,
    );
  }

  const payload = await runTool(
    config,
    caller,
    scopes,
    id,
    name,
    args,
    meta,
    tool,
    noElicit,
  );

  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
};

const supportsTasks = (params: unknown) => {
  if (!isRecord(params) || !isRecord(params._meta)) return false;
  const capabilities =
    params._meta["io.modelcontextprotocol/clientCapabilities"];
  if (!isRecord(capabilities) || !isRecord(capabilities.extensions))
    return false;

  return isRecord(capabilities.extensions["io.modelcontextprotocol/tasks"]);
};

const authorizedTask = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  params: unknown,
) => {
  if (
    config.tasks === undefined ||
    !isRecord(params) ||
    typeof params.taskId !== "string"
  ) {
    return null;
  }
  const task = await config.tasks.store.get(params.taskId);
  if (task === null) return null;
  const authorizationKey = await config.tasks.authorizationKey(caller);

  return task.authorizationKey === authorizationKey ? task : null;
};

const tasksGet = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
  native: boolean,
) => {
  const task = await authorizedTask(config, caller, params);
  if (task === null)
    return rpcError(id, JSONRPC_INVALID_PARAMS, "Unknown task");

  return rpcResult(
    id,
    native
      ? publicMcpTask(task)
      : { ...publicMcpTask(task), resultType: "complete" },
  );
};

const tasksResult = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
  signal?: AbortSignal,
) => {
  let task = await authorizedTask(config, caller, params);
  if (task === null)
    return rpcError(id, JSONRPC_INVALID_PARAMS, "Unknown task");
  while (task.status === "working" || task.status === "input_required") {
    if (signal?.aborted) {
      return rpcError(
        id,
        JSONRPC_INTERNAL_ERROR,
        "Task result request cancelled",
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, task?.pollIntervalMs ?? 100),
    );
    task = await authorizedTask(config, caller, params);
    if (task === null)
      return rpcError(id, JSONRPC_INVALID_PARAMS, "Unknown task");
  }
  if (task.error !== undefined) {
    return rpcError(
      id,
      typeof task.error.code === "number"
        ? task.error.code
        : JSONRPC_INTERNAL_ERROR,
      typeof task.error.message === "string"
        ? task.error.message
        : "Task failed",
    );
  }
  const result = task.result ?? {
    content: [],
    isError: task.status !== "completed",
  };
  return rpcResult(id, {
    ...result,
    _meta: {
      ...(isRecord(result._meta) ? result._meta : {}),
      "io.modelcontextprotocol/related-task": { taskId: task.taskId },
    },
  });
};

const tasksList = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
) => {
  if (config.tasks === undefined) {
    return rpcError(id, JSONRPC_METHOD_NOT_FOUND, "Tasks are not configured");
  }
  const authorizationKey = await config.tasks.authorizationKey(caller);
  let offset = 0;
  if (isRecord(params) && params.cursor !== undefined) {
    if (typeof params.cursor !== "string") {
      return rpcError(id, JSONRPC_INVALID_PARAMS, "Invalid task cursor");
    }
    try {
      offset = Number.parseInt(atob(params.cursor), 10);
    } catch {
      offset = -1;
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return rpcError(id, JSONRPC_INVALID_PARAMS, "Invalid task cursor");
    }
  }
  const pageSize = Math.min(100, Math.max(1, config.tasks.listPageSize ?? 50));
  const fetched = await config.tasks.store.list(authorizationKey, {
    limit: pageSize + 1,
    offset,
  });
  const items = fetched.slice(0, pageSize);
  const nextCursor =
    fetched.length > pageSize ? encodeCursor(offset + pageSize) : undefined;
  return rpcResult(id, {
    tasks: items.map(publicMcpTask),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
};

const tasksUpdate = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
) => {
  const task = await authorizedTask(config, caller, params);
  if (task === null || !isRecord(params) || !isRecord(params.inputResponses)) {
    return rpcError(
      id,
      JSONRPC_INVALID_PARAMS,
      "Unknown task or invalid inputResponses",
    );
  }
  await config.tasks?.onUpdate?.({
    caller,
    inputResponses: params.inputResponses,
    task,
  });

  return rpcResult(id, { resultType: "complete" });
};

const tasksCancel = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  id: JsonRpcId,
  params: unknown,
  native: boolean,
) => {
  const task = await authorizedTask(config, caller, params);
  if (task === null)
    return rpcError(id, JSONRPC_INVALID_PARAMS, "Unknown task");
  if (["cancelled", "completed", "failed"].includes(task.status)) {
    return rpcError(id, JSONRPC_INVALID_PARAMS, "Task is already terminal");
  }
  await config.tasks?.store.cancel(task.taskId);
  const cancelled = await config.tasks?.store.get(task.taskId);
  return rpcResult(
    id,
    native && cancelled !== null && cancelled !== undefined
      ? publicMcpTask(cancelled)
      : { resultType: "complete" },
  );
};

const promptsList = <Caller>(
  config: McpServerConfig<Caller>,
  id: JsonRpcId,
  params: unknown,
) => {
  const definitions = config.prompts?.definitions ?? {};
  const all = Object.entries(definitions).map(([name, def]) => ({
    arguments: def.arguments ?? [],
    description: def.description,
    name,
    title: def.title,
  }));
  const { items, nextCursor } = paginate(
    all,
    decodeCursor(params),
    config.listPageSize ?? DEFAULT_LIST_PAGE_SIZE,
  );

  return rpcResult(id, {
    prompts: items,
    ...(nextCursor === undefined ? {} : { nextCursor }),
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
  params: unknown,
) => {
  const resources = config.resources;
  if (!resources) return rpcResult(id, { resources: [] });
  const { items, nextCursor } = paginate(
    await resources.list({ caller }),
    decodeCursor(params),
    config.listPageSize ?? DEFAULT_LIST_PAGE_SIZE,
  );

  return rpcResult(id, {
    resources: items,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
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

/** Route one decoded JSON-RPC message to its handler. `scopes` are the caller's
 *  granted scopes (from `authorize`); they gate scope-restricted tools.
 *  Notifications (no `id`) get a bare 202; unknown methods get method-not-found. */
/** The client's answer to an `elicitation/create` we sent. It arrives as its
 *  own POST whose body is a JSON-RPC RESPONSE (an id, a result, no method) —
 *  hand it to the tool call that is blocked waiting for it. The transport says
 *  a response body gets 202 with no content, whether or not we recognised it. */
const elicitAnswer = async (
  message: Record<string, unknown>,
  context: McpDispatchContext,
) => {
  const requestId = typeof message.id === "string" ? message.id : null;
  if (!requestId || !context.sessions) return notificationAck();
  const result = isRecord(message.result) ? message.result : null;
  const action = result?.action;
  const answer: McpElicitResult =
    action === "accept"
      ? {
          action: "accept",
          content: isRecord(result?.content) ? result.content : {},
        }
      : action === "decline"
        ? { action: "decline" }
        : { action: "cancel" };
  // Resolves the waiting call if it's ours; otherwise the registry puts it on
  // the bus so the instance that ASKED can resolve it. Either way the client
  // gets its 202 — an answer we can't place is not the client's problem.
  await context.sessions.resolveElicit({
    requestId,
    result: answer,
    sessionId: context.sessionId ?? null,
  });

  return notificationAck();
};

export const dispatchMcp = async <Caller>(
  config: McpServerConfig<Caller>,
  caller: Caller,
  scopes: string[],
  message: unknown,
  context: McpDispatchContext = {},
): Promise<Response> => {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return rpcError(
      null,
      JSONRPC_INVALID_REQUEST,
      "Not a JSON-RPC 2.0 message",
    );
  }
  if (!("id" in message)) return notificationAck();
  // A body with an id but NO method is a RESPONSE to something we asked.
  if (!("method" in message)) return elicitAnswer(message, context);
  const id = idOf(message);
  // Direct dispatcher consumers predate transport-level version headers; keep
  // their legacy semantics unless they explicitly provide a negotiated version.
  const protocolVersion = context.protocolVersion ?? "2025-06-18";
  const method = typeof message.method === "string" ? message.method : "";
  const { params } = message;
  if (method === "initialize") {
    return await initialize(config, id, params, context);
  }
  if (method === "server/discover") {
    return rpcResult(id, {
      capabilities: {
        extensions:
          config.tasks === undefined
            ? {}
            : { "io.modelcontextprotocol/tasks": {} },
      },
      serverInfo: config.serverInfo,
    });
  }
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") {
    return toolsList(config, caller, scopes, id, params, protocolVersion);
  }
  if (method === "tools/call") {
    return toolsCall(config, caller, scopes, id, params, {
      ...context,
      protocolVersion,
    });
  }
  if (method === "tasks/get")
    return tasksGet(
      config,
      caller,
      id,
      params,
      protocolVersion === MCP_LATEST_PROTOCOL_VERSION,
    );
  if (
    method === "tasks/result" &&
    protocolVersion === MCP_LATEST_PROTOCOL_VERSION
  )
    return tasksResult(config, caller, id, params, context.requestSignal);
  if (
    method === "tasks/list" &&
    protocolVersion === MCP_LATEST_PROTOCOL_VERSION
  )
    return tasksList(config, caller, id, params);
  if (
    method === "tasks/update" &&
    protocolVersion !== MCP_LATEST_PROTOCOL_VERSION
  )
    return tasksUpdate(config, caller, id, params);
  if (method === "tasks/cancel")
    return tasksCancel(
      config,
      caller,
      id,
      params,
      protocolVersion === MCP_LATEST_PROTOCOL_VERSION,
    );
  if (method === "prompts/list") return promptsList(config, id, params);
  if (method === "prompts/get") return promptsGet(config, caller, id, params);
  if (method === "resources/list") {
    return resourcesList(config, caller, id, params);
  }
  if (method === "resources/read") {
    return resourcesRead(config, caller, id, params);
  }

  return rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Unknown method: ${method}`);
};

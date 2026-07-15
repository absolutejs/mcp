// JSON-RPC 2.0 framing for the MCP endpoint. Every reply is a complete HTTP
// Response; notifications (no id) get a bare 202 with no body.

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;
export const JSONRPC_MISSING_REQUIRED_CLIENT_CAPABILITY = -32003;

export const HTTP_ACCEPTED = 202;
export const HTTP_NO_CONTENT = 204;
export const HTTP_UNAUTHORIZED = 401;
export const HTTP_METHOD_NOT_ALLOWED = 405;

export type JsonRpcId = string | number | null;

const jsonHeaders: Record<string, string> = {
  "content-type": "application/json",
};

export const rpcResult = (id: JsonRpcId, result: unknown) =>
  new Response(JSON.stringify({ id, jsonrpc: "2.0", result }), {
    headers: jsonHeaders,
  });

export const rpcError = (
  id: JsonRpcId,
  code: number,
  message: string,
  data?: Record<string, unknown>,
) =>
  new Response(
    JSON.stringify({
      error: { code, message, ...(data === undefined ? {} : { data }) },
      id,
      jsonrpc: "2.0",
    }),
    {
      headers: jsonHeaders,
    },
  );

export const notificationAck = () =>
  new Response(null, { status: HTTP_ACCEPTED });

/** 401 with the RFC 9728 `WWW-Authenticate` challenge pointing at the
 *  protected-resource metadata, so the client can discover the auth server. */
export const unauthorized = (metadataUrl: string, detail: string) =>
  new Response(
    JSON.stringify({
      error: { code: JSONRPC_INVALID_REQUEST, message: detail },
      id: null,
      jsonrpc: "2.0",
    }),
    {
      headers: {
        ...jsonHeaders,
        "www-authenticate": `Bearer resource_metadata="${metadataUrl}"`,
      },
      status: HTTP_UNAUTHORIZED,
    },
  );

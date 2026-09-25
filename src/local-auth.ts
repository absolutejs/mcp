import { mkdir, open, rename, rm, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
/** Local device-flow client. Token files are private to the OS user and never
 * returned by begin/poll/status. An exclusive directory lock serializes refresh
 * rotation across AI sessions; interrupted locks fail closed, never replay a
 * possibly consumed refresh token. No request/response bodies are logged.
 */
export function createLocalMcpAuthorization(options: {
  issuer: string;
  oauthPath: string;
  clientId: string;
  resource: string;
  scope: string;
  directory: string;
  fetch?: typeof fetch;
}) {
  if (
    new URL(options.issuer).origin !== options.issuer ||
    !options.issuer.startsWith("https://") ||
    !/^\/[a-z0-9/-]+$/.test(options.oauthPath)
  )
    throw Error("Invalid local OAuth configuration");
  const fetcher = options.fetch ?? fetch,
    file = join(options.directory, "tokens.json"),
    lock = join(options.directory, "refresh.lock");
  let pending:
    | { code: string; expiresAt: number; nextPollAt: number; interval: number }
    | undefined;
  async function initialize() {
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(options.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      throw Error("Local OAuth directory must be private");
  }
  async function locked<T>(work: () => Promise<T>): Promise<T> {
    await initialize();
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST" || attempt >= 50)
          throw Error(
            "Local authentication busy; reconnect if a previous process was interrupted",
          );
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    try {
      return await work();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  async function load(): Promise<Tokens | undefined> {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return;
      throw Error("Local authentication storage unavailable");
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 32768 || (info.mode & 0o077) !== 0)
        throw Error();
      const value = JSON.parse(await handle.readFile("utf8"));
      if (
        typeof value.accessToken !== "string" ||
        typeof value.refreshToken !== "string" ||
        !Number.isFinite(value.expiresAt)
      )
        throw Error();
      return value;
    } catch {
      throw Error("Local authentication storage invalid");
    } finally {
      await handle.close();
    }
  }
  async function save(value: Tokens) {
    const temporary = file + "." + crypto.randomUUID();
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  }
  async function post(path: string, body: Record<string, string>) {
    const response = await fetcher(options.issuer + options.oauthPath + path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: options.issuer },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (text.length > 32768) throw Error("OAuth response unavailable");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Error("OAuth response unavailable");
    }
    return { ok: response.ok, data };
  }
  function tokens(data: Record<string, unknown>): Tokens {
    if (
      data.token_type !== "Bearer" ||
      typeof data.access_token !== "string" ||
      typeof data.refresh_token !== "string" ||
      typeof data.expires_in !== "number" ||
      data.expires_in <= 0 ||
      data.expires_in > 86400
    )
      throw Error("OAuth token response rejected");
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }
  return {
    async begin() {
      const { ok, data } = await post("/device_authorization", {
        client_id: options.clientId,
        scope: options.scope,
        resource: options.resource,
      });
      if (
        !ok ||
        typeof data.device_code !== "string" ||
        typeof data.user_code !== "string" ||
        typeof data.verification_uri_complete !== "string" ||
        new URL(data.verification_uri_complete).origin !== options.issuer ||
        typeof data.expires_in !== "number" ||
        data.expires_in > 1800
      )
        throw Error("Device authorization unavailable");
      pending = {
        code: data.device_code,
        expiresAt: Date.now() + data.expires_in * 1000,
        nextPollAt: 0,
        interval: Math.max(5, Number(data.interval) || 5) * 1000,
      };
      return {
        state: "approval-required" as const,
        userCode: data.user_code as string,
        verificationUrl: data.verification_uri_complete as string,
      };
    },
    async poll() {
      if (!pending || pending.expiresAt <= Date.now())
        return { state: "sign-in-required" as const };
      if (Date.now() < pending.nextPollAt)
        return { state: "approval-pending" as const };
      pending.nextPollAt = Date.now() + pending.interval;
      const { ok, data } = await post("/token", {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: options.clientId,
        device_code: pending.code,
      });
      if (!ok) {
        if (data.error === "authorization_pending")
          return { state: "approval-pending" as const };
        if (data.error === "slow_down") {
          pending.interval += 5000;
          return { state: "approval-pending" as const };
        }
        pending = undefined;
        return { state: "sign-in-required" as const };
      }
      const value = tokens(data);
      await locked(() => save(value));
      pending = undefined;
      return { state: "connected" as const };
    },
    async headers(): Promise<Record<string, string>> {
      return locked(async () => {
        let value = await load();
        if (!value) throw Error("Sign in to the local assistant first");
        if (value.expiresAt <= Date.now() + 30000) {
          // Erase the consumed refresh credential before network I/O. An
          // ambiguous refresh fails closed and requires sign-in, never replay.
          await rm(file, { force: true });
          const result = await post("/token", {
            grant_type: "refresh_token",
            client_id: options.clientId,
            refresh_token: value.refreshToken,
            resource: options.resource,
          });
          if (!result.ok) throw Error("Local sign-in expired; reconnect");
          value = tokens(result.data);
          await save(value);
        }
        return {
          authorization: "Bearer " + value.accessToken,
          origin: options.issuer,
        };
      });
    },
    async forget() {
      await locked(() => rm(file, { force: true }));
      pending = undefined;
    },
  };
}

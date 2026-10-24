import { mkdir, open, rename, rm, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
type Pending = {
  code: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  nextPollAt: number;
  interval: number;
};

/** What went wrong, for a caller deciding whether to retry or sign in again. */
export type LocalMcpAuthErrorCode =
  | "AUTH_BUSY"
  | "AUTH_REFRESH_UNCERTAIN"
  | "AUTH_REQUIRED"
  | "AUTH_STORAGE"
  | "AUTH_UNAVAILABLE";

export class LocalMcpAuthError extends Error {
  constructor(
    readonly code: LocalMcpAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalMcpAuthError";
  }
}

type SystemError = { code?: string; syscall?: string; cause?: unknown };
const UNRESOLVED = ["ENOTFOUND", "EAI_AGAIN", "ETIMEOUT", "ETIMEDOUT"];
const UNCONNECTED = ["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"];
/** True only when the request provably never reached the server, so the
 *  refresh token it carried was not consumed and may be kept. */
const notSent = (error: unknown): boolean => {
  const e = error as SystemError | undefined;
  if (!e) return false;
  if (e.syscall === "getaddrinfo" && UNRESOLVED.includes(e.code ?? ""))
    return true;
  if (UNCONNECTED.includes(e.code ?? "")) return true;
  return !!e.cause && e.cause !== e && notSent(e.cause);
};

/** Local device-flow client. Token files are private to the OS user and never
 * returned by begin/poll/status. An exclusive directory lock serializes refresh
 * rotation and device polling across AI sessions, and the pending device
 * sign-in is stored so any session can finish it. A refresh moves the token
 * file to a journal before network I/O: a refresh that provably never left the
 * machine restores it, any other ambiguous outcome fails closed and never
 * replays a possibly consumed refresh token. No request/response bodies are
 * logged.
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
    lock = join(options.directory, "refresh.lock"),
    journal = join(options.directory, "refresh-pending.json"),
    pendingFile = join(options.directory, "device-pending.json");
  let pending: Pending | undefined;
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
        if ((error as SystemError).code !== "EEXIST" || attempt >= 200)
          throw new LocalMcpAuthError(
            "AUTH_BUSY",
            "Local authentication is busy or its lock was interrupted; retry after the active request finishes. Reconnecting will not repair a stuck lock.",
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
      if ((e as SystemError).code !== "ENOENT")
        throw Error("Local authentication storage unavailable");
      // No tokens. A leftover journal means a refresh was interrupted after
      // its token may have been spent: say so rather than "not signed in".
      try {
        await lstat(journal);
      } catch (missing) {
        if ((missing as SystemError).code === "ENOENT") return;
        throw missing;
      }
      throw new LocalMcpAuthError(
        "AUTH_REFRESH_UNCERTAIN",
        "A previous refresh may have completed but its response was lost. Sign in again; the old refresh token will not be replayed.",
      );
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
  async function save(value: Tokens | Pending, destination = file) {
    const temporary = destination + "." + crypto.randomUUID();
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  }
  async function readPending() {
    let handle;
    try {
      handle = await open(
        pendingFile,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if ((error as SystemError).code === "ENOENT") {
        pending = undefined;
        return;
      }
      throw new LocalMcpAuthError(
        "AUTH_STORAGE",
        "Local pending sign-in is unavailable",
      );
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 32768 || (info.mode & 0o077) !== 0)
        throw Error();
      const value = JSON.parse(await handle.readFile("utf8")) as Pending;
      if (
        typeof value.code !== "string" ||
        typeof value.userCode !== "string" ||
        typeof value.verificationUrl !== "string" ||
        new URL(value.verificationUrl).origin !== options.issuer ||
        !Number.isFinite(value.expiresAt) ||
        !Number.isFinite(value.nextPollAt) ||
        !Number.isFinite(value.interval) ||
        value.interval < 5000
      )
        throw Error();
      pending = value.expiresAt > Date.now() ? value : undefined;
    } catch {
      throw new LocalMcpAuthError(
        "AUTH_STORAGE",
        "Local pending sign-in is invalid",
      );
    } finally {
      await handle.close();
    }
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
      return locked(async () => {
        // A sign-in another session already started is resumed, not
        // replaced, so its approval link stays valid.
        await readPending();
        if (pending)
          return {
            state: "approval-required" as const,
            userCode: pending.userCode,
            verificationUrl: pending.verificationUrl,
          };
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
          userCode: data.user_code,
          verificationUrl: data.verification_uri_complete,
          expiresAt: Date.now() + data.expires_in * 1000,
          nextPollAt: 0,
          interval: Math.max(5, Number(data.interval) || 5) * 1000,
        };
        await save(pending, pendingFile);
        return {
          state: "approval-required" as const,
          userCode: data.user_code as string,
          verificationUrl: data.verification_uri_complete as string,
        };
      });
    },
    async poll() {
      return locked(async () => {
        await readPending();
        if (!pending || pending.expiresAt <= Date.now())
          return { state: "sign-in-required" as const };
        if (Date.now() < pending.nextPollAt)
          return { state: "approval-pending" as const };
        pending.nextPollAt = Date.now() + pending.interval;
        await save(pending, pendingFile);
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
            await save(pending, pendingFile);
            return { state: "approval-pending" as const };
          }
          if (
            !["access_denied", "expired_token", "invalid_grant"].includes(
              data.error,
            )
          )
            throw new LocalMcpAuthError(
              "AUTH_UNAVAILABLE",
              "Device sign-in temporarily unavailable; retry status without starting another connection.",
            );
          pending = undefined;
          await rm(pendingFile, { force: true });
          return { state: "sign-in-required" as const };
        }
        const value = tokens(data);
        await save(value);
        await rm(journal, { force: true });
        await rm(pendingFile, { force: true });
        pending = undefined;
        return { state: "connected" as const };
      });
    },
    async headers(): Promise<Record<string, string>> {
      return locked(async () => {
        let value = await load();
        if (!value)
          throw new LocalMcpAuthError(
            "AUTH_REQUIRED",
            "Sign in to the local assistant first",
          );
        if (value.expiresAt <= Date.now() + 30000) {
          // The refresh token is single-use: journal it before network I/O.
          await rename(file, journal);
          let result;
          try {
            result = await post("/token", {
              grant_type: "refresh_token",
              client_id: options.clientId,
              refresh_token: value.refreshToken,
              resource: options.resource,
            });
          } catch (error) {
            if (notSent(error)) {
              await rename(journal, file);
              throw new LocalMcpAuthError(
                "AUTH_UNAVAILABLE",
                "The server could not be reached. Your connection is preserved; retry when the network is available.",
              );
            }
            throw new LocalMcpAuthError(
              "AUTH_REFRESH_UNCERTAIN",
              "The refresh response was lost. Sign in again; the old refresh token will not be replayed.",
            );
          }
          if (!result.ok) {
            if (result.data?.error === "invalid_grant") {
              await rm(journal, { force: true });
              throw new LocalMcpAuthError(
                "AUTH_REQUIRED",
                "The connection was expired or revoked; sign in again.",
              );
            }
            throw new LocalMcpAuthError(
              "AUTH_REFRESH_UNCERTAIN",
              "The refresh outcome could not be confirmed. Sign in again; the old refresh token will not be replayed.",
            );
          }
          value = tokens(result.data);
          await save(value);
          await rm(journal, { force: true });
        }
        return {
          authorization: "Bearer " + value.accessToken,
          origin: options.issuer,
        };
      });
    },
    async forget() {
      await locked(async () => {
        await rm(file, { force: true });
        await rm(journal, { force: true });
        await rm(pendingFile, { force: true });
      });
      pending = undefined;
    },
  };
}

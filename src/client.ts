import { z } from "zod";
import { rpcSchemas } from "./protocol.ts";
import type {
  DpopKey,
  Session,
  RpcMethod,
  RpcResults,
  Read,
  SpaceReadMethod,
} from "./protocol.ts";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

export const failure = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
export function parseSpace(space: string, spaceType: string) {
  const match =
    /^at:\/\/(did:plc:[a-z2-7]{24})\/space\/([^/]+)\/([a-z0-9][a-z0-9-]{0,47})$/.exec(
      space,
    );
  if (!match || match[2] !== spaceType)
    throw failure(400, "Invalid space URI or namespace");
  return { did: match[1], name: match[3] };
}

// Standard ES256 DPoP proof; the PDS verifies the binding and replay protection.
// Keys and credentials never leave this backend. No credentials are cached.
export function proof(
  key: DpopKey,
  method: string,
  url: string | URL,
  credential?: string,
) {
  const target = new URL(url);
  target.search = "";
  target.hash = "";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload: {
    jti: string;
    htm: string;
    htu: string;
    iat: number;
    ath?: string;
  } = {
    jti: randomUUID(),
    htm: method,
    htu: target.href,
    iat: Math.floor(Date.now() / 1000),
  };
  if (credential)
    payload.ath = createHash("sha256").update(credential).digest("base64url");
  const input =
    encode({
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: key.publicKey.export({ format: "jwk" }),
    }) +
    "." +
    encode(payload);
  return (
    input +
    "." +
    sign("sha256", Buffer.from(input), {
      key: key.privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url")
  );
}

export function createAtprotoClient({
  url,
  publicOrigin,
  spaceType,
  fetchImpl = fetch,
}: {
  url: string;
  publicOrigin: string;
  spaceType: string;
  fetchImpl?: typeof fetch;
}) {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}$/i.test(spaceType))
    throw failure(400, "Invalid space namespace");
  const base = new URL(url);
  const canonical = new URL(publicOrigin);
  for (const endpoint of [base, canonical]) {
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/"
    )
      throw failure(
        400,
        "PDS URLs must be HTTP(S) origins without credentials",
      );
  }
  async function rpc<M extends RpcMethod>(
    method: M,
    data: Record<string, unknown> = {},
    session?: Session | null,
    write = false,
    headers: Record<string, string> = {},
  ): Promise<RpcResults[M]> {
    if (!Object.hasOwn(rpcSchemas, method))
      throw failure(400, "Unsupported RPC method");
    if (Object.hasOwn(data, "space")) {
      if (typeof data.space !== "string")
        throw failure(400, "Invalid space URI");
      parseSpace(data.space, spaceType);
    }
    const target = new URL("/xrpc/" + method, base);
    if (!write)
      target.search = new URLSearchParams(
        Object.entries(data).map(([name, value]) => [name, String(value)]),
      ).toString();
    const options: RequestInit = {
      method: write ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(session?.accessJwt && {
          authorization: "Bearer " + session.accessJwt,
        }),
        ...(write && { "content-type": "application/json" }),
        ...headers,
      },
      ...(write && { body: JSON.stringify(data) }),
    };
    // OAuth signs with its own DPoP key against the canonical PDS URL. Space
    // credential exchanges below remain separately bound to the viewing DID.
    const response = session?.fetchHandler
      ? await session.fetchHandler(target.pathname + target.search, options)
      : await fetchImpl(target, options);
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (response.body)
      for await (const part of response.body) {
        size += part.length;
        if (size > 1024 * 1024) throw failure(502, "PDS response too large");
        chunks.push(part);
      }
    let result: Record<string, unknown>;
    try {
      result = z
        .record(z.string(), z.unknown())
        .parse(size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
    } catch {
      throw failure(502, "Invalid PDS response");
    }
    if (!response.ok) {
      // Do not echo upstream request details or credentials into browser errors.
      const status = [
        "UserNotAuthorized",
        "NotAuthorized",
        "SpaceDeleted",
        "SpaceNotFound",
      ].includes(String(result.error))
        ? 403
        : response.status === 401 ||
            ["ExpiredToken", "InvalidToken"].includes(String(result.error))
          ? 401
          : response.status === 403
            ? 403
            : response.status === 429
              ? 429
              : 400;
      throw Object.assign(
        failure(
          status,
          status === 401 ? "Sign in again" : "PDS refused the request",
        ),
        {
          code:
            typeof result.error === "string" &&
            /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(result.error)
              ? result.error
              : "UpstreamError",
        },
      );
    }
    // The indexed schema checks the external response before it gains a type.
    const parsed = rpcSchemas[method].safeParse(result);
    if (!parsed.success) throw failure(502, "Invalid PDS response");
    return parsed.data as RpcResults[M];
  }
  async function credential(session: Session, space: string): Promise<Read> {
    parseSpace(space, spaceType);
    const { token } = await rpc(
      "com.atproto.space.getDelegationToken",
      { space },
      session,
    );
    const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const endpoint = "/xrpc/com.atproto.space.getSpaceCredential";
    const result = await rpc(
      "com.atproto.space.getSpaceCredential",
      { space },
      null,
      true,
      {
        authorization: "Bearer " + token,
        dpop: proof(key, "POST", new URL(endpoint, publicOrigin)),
      },
    );
    return async <M extends SpaceReadMethod>(
      method: M,
      data: Record<string, unknown> = {},
    ) => {
      if (
        method !== "com.atproto.space.listRecords" &&
        method !== "com.atproto.space.listRepos"
      )
        throw failure(400, "Unsupported space read method");
      if (data.space !== undefined && data.space !== space)
        throw failure(400, "Credential belongs to a different space");
      return rpc(method, { ...data, space }, null, false, {
        authorization: "DPoP " + result.credential,
        dpop: proof(
          key,
          "GET",
          new URL("/xrpc/" + method, publicOrigin),
          result.credential,
        ),
      });
    };
  }
  return { rpc, credential };
}

export type AtprotoClient = ReturnType<typeof createAtprotoClient>;

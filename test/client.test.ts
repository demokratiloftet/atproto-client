import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { createAtprotoClient, parseSpace } from "../src/index.ts";
import type { RpcMethod, Session } from "../src/index.ts";
import { proof } from "../src/client.ts";

const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const spaceType = "org.example.community";
const space = `at://${owner}/space/${spaceType}/volunteers`;
const session: Session = { did: owner, accessJwt: "synthetic-session" };
const options = {
  url: "http://pds.internal",
  publicOrigin: "https://pds.example",
  spaceType,
};

test("namespace is configurable but rejects foreign and malformed spaces before network access", async () => {
  assert.equal(parseSpace(space, spaceType).name, "volunteers");
  assert.throws(() => parseSpace(space, "other.example.community"));
  assert.throws(() => parseSpace("https://untrusted.example", spaceType));
  let calls = 0;
  const client = createAtprotoClient({
    ...options,
    fetchImpl: async () => {
      calls++;
      return Response.json({});
    },
  });
  await assert.rejects(
    client.credential(
      session,
      space.replace(spaceType, "other.example.community"),
    ),
    { status: 400 },
  );
  await assert.rejects(
    client.rpc("com.atproto.space.putRecord", { space: "bad" }, session, true),
    { status: 400 },
  );
  assert.equal(calls, 0);
});

test("write and delete use the caller's session and retain caller-defined record types", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createAtprotoClient({
    ...options,
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init: init! });
      return Response.json(
        String(input).endsWith("putRecord")
          ? { cid: "test-cid", uri: "at://test/record" }
          : {},
      );
    },
  });
  const data = {
    space,
    repo: owner,
    collection: "org.example.notice",
    rkey: "welcome",
    record: { $type: "org.example.notice", text: "Hello" },
  };
  await client.rpc("com.atproto.space.putRecord", data, session, true);
  await client.rpc(
    "com.atproto.space.putRecord",
    { ...data, record: { ...data.record, text: "Updated" } },
    session,
    true,
  );
  await client.rpc(
    "com.atproto.space.deleteRecord",
    { space, repo: owner, collection: data.collection, rkey: data.rkey },
    session,
    true,
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    new Headers(calls[0].init.headers).get("authorization"),
    "Bearer synthetic-session",
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), data);
  assert.equal(calls[0].init.redirect, "error");
});

test("identity fetch handler is used without forwarding an app's bearer token", async () => {
  const client = createAtprotoClient({
    ...options,
    fetchImpl: async () => {
      throw Error("Unexpected raw request");
    },
  });
  const oauth: Session = {
    did: owner,
    fetchHandler: async (path, init) => {
      assert.equal(path, "/xrpc/com.atproto.server.getSession");
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      return Response.json({ did: owner, handle: "demo.example" });
    },
  };
  assert.equal(
    (await client.rpc("com.atproto.server.getSession", {}, oauth)).did,
    owner,
  );
});

test("fresh credentials on each request; revoked access never returns previous records", async () => {
  let revoked = false;
  let delegations = 0;
  const client = createAtprotoClient({
    ...options,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("getDelegationToken")) {
        delegations++;
        return revoked
          ? Response.json(
              { error: "UserNotAuthorized", message: "private details" },
              { status: 403 },
            )
          : Response.json({ token: "delegation" });
      }
      if (url.pathname.endsWith("getSpaceCredential")) {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer delegation",
        );
        return Response.json({ credential: "space-credential" });
      }
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "DPoP space-credential",
      );
      const jwt = new Headers(init?.headers).get("dpop")!;
      const claims = JSON.parse(
        Buffer.from(jwt.split(".")[1], "base64url").toString(),
      );
      assert.equal(
        claims.htu,
        "https://pds.example/xrpc/com.atproto.space.listRecords",
      );
      assert.equal(url.searchParams.get("space"), space);
      return Response.json({
        records: [{ rkey: "welcome", cid: "cid", value: { text: "Hello" } }],
      });
    },
  });
  const read = await client.credential(session, space);
  assert.equal(
    (
      await read("com.atproto.space.listRecords", {
        repo: owner,
        collection: "org.example.notice",
      })
    ).records.length,
    1,
  );
  await assert.rejects(
    read("com.atproto.space.listRepos", {
      space: space.replace("volunteers", "elsewhere"),
    }),
    { status: 400 },
  );
  revoked = true;
  await assert.rejects(client.credential(session, space), {
    status: 403,
    message: "PDS refused the request",
  });
  assert.equal(delegations, 2);
});

test("an outsider denied during credential exchange cannot read data", async () => {
  let calls = 0;
  const client = createAtprotoClient({
    ...options,
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? Response.json({ token: "delegation" })
        : Response.json({ error: "NotAuthorized" }, { status: 403 });
    },
  });
  await assert.rejects(
    client.credential(
      { did: "outsider", accessJwt: "synthetic-outsider" },
      space,
    ),
    { status: 403 },
  );
  assert.equal(calls, 2);
});

test("malformed, oversized, failed and offline responses are rejected", async () => {
  const cases: [RpcMethod, unknown][] = [
    ["com.atproto.server.createSession", { did: "reader" }],
    ["com.atproto.space.getDelegationToken", { token: null }],
    ["com.atproto.space.getSpaceCredential", { credential: 123 }],
    [
      "com.atproto.space.listRecords",
      { records: [{ rkey: "x", value: {}, cid: null }] },
    ],
    ["com.atproto.space.listRepos", { repos: [{}] }],
    ["com.atproto.simplespace.getSpace", { readPolicy: null }],
    ["com.atproto.space.putRecord", { cid: "cid" }],
  ];
  for (const [method, value] of cases) {
    const client = createAtprotoClient({
      ...options,
      fetchImpl: async () => Response.json(value),
    });
    await assert.rejects(client.rpc(method), { status: 502 });
  }
  for (const response of [
    new Response("not JSON"),
    new Response("x".repeat(1024 * 1024 + 1)),
  ]) {
    const client = createAtprotoClient({
      ...options,
      fetchImpl: async () => response,
    });
    await assert.rejects(client.rpc("com.atproto.server.getSession"), {
      status: 502,
    });
  }
  const expired = createAtprotoClient({
    ...options,
    fetchImpl: async () =>
      Response.json(
        { error: "ExpiredToken", message: "private detail" },
        { status: 401 },
      ),
  });
  await assert.rejects(expired.rpc("com.atproto.server.getSession"), {
    status: 401,
    message: "Sign in again",
  });
  const offline = createAtprotoClient({
    ...options,
    fetchImpl: async () => {
      throw new TypeError("Network unavailable");
    },
  });
  await assert.rejects(
    offline.credential(session, space),
    /Network unavailable/,
  );
});

test("DPoP binds the canonical URL, method, token and cryptographic signature", () => {
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwt = proof(
    key,
    "GET",
    "https://pds.example/xrpc/test?query=1#hash",
    "credential",
  );
  const [header, payload, signature] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.htu, "https://pds.example/xrpc/test");
  assert.equal(claims.htm, "GET");
  assert.equal(
    claims.ath,
    createHash("sha256").update("credential").digest("base64url"),
  );
  assert(
    verify(
      "sha256",
      Buffer.from(header + "." + payload),
      { key: key.publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
  );
  assert.notEqual(
    jwt,
    proof(key, "GET", "https://pds.example/xrpc/test", "credential"),
  );
});

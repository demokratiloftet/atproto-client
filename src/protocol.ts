import { z } from "zod";
import type { KeyObject } from "node:crypto";
const text = z.string().min(1);
export const sessionSchema = z.object({
  did: text,
  handle: text.optional(),
  accessJwt: text,
  refreshJwt: text.optional(),
});
const record = z.object({
  rkey: text,
  cid: text,
  value: z.record(z.string(), z.unknown()),
});
const repoRecord = z.object({
  uri: text,
  cid: text,
  value: z.record(z.string(), z.unknown()),
});
const empty = z.object({}).passthrough();
export const rpcSchemas = {
  "com.atproto.server.createSession": sessionSchema,
  "com.atproto.server.createAccount": sessionSchema,
  "com.atproto.server.getSession": z.object({ did: text, handle: text }),
  "com.atproto.space.getDelegationToken": z.object({ token: text }),
  "com.atproto.space.getSpaceCredential": z.object({ credential: text }),
  "com.atproto.space.listRecords": z.object({
    records: z.array(record),
    cursor: text.optional(),
  }),
  "com.atproto.space.listRepos": z.object({
    repos: z.array(z.object({ did: text })),
    cursor: text.optional(),
  }),
  "com.atproto.repo.listRecords": z.object({
    records: z.array(repoRecord),
    cursor: text.optional(),
  }),
  "com.atproto.simplespace.createSpace": z.object({ uri: text }),
  "com.atproto.simplespace.getSpace": z
    .object({ readPolicy: z.object({ $type: text }) })
    .passthrough(),
  "com.atproto.simplespace.listMembers": z.object({
    members: z.array(
      z
        .object({
          did: text,
          read: z.boolean().optional(),
          write: z.boolean().optional(),
        })
        .passthrough(),
    ),
    cursor: text.optional(),
  }),
  "com.atproto.simplespace.putMember": empty,
  "com.atproto.simplespace.removeMember": empty,
  "com.atproto.simplespace.deleteSpace": empty,
  "com.atproto.space.putRecord": z.object({ cid: text, uri: text }),
  "com.atproto.space.deleteRecord": empty,
} as const;
export type RpcMethod = keyof typeof rpcSchemas;
export type RpcResults = { [M in RpcMethod]: z.infer<(typeof rpcSchemas)[M]> };
export type Session = {
  did: string;
  accessJwt?: string;
  /** Authenticated fetch from the identity component, bound to this user's PDS. */
  fetchHandler?: (path: string, init?: RequestInit) => Promise<Response>;
};
export type DpopKey = { publicKey: KeyObject; privateKey: KeyObject };
export type SpaceReadMethod =
  "com.atproto.space.listRecords" | "com.atproto.space.listRepos";
export type Read = <M extends SpaceReadMethod>(
  method: M,
  data?: Record<string, unknown>,
) => Promise<RpcResults[M]>;

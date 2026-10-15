# AT Protocol client

A small server-side TypeScript package extracted from `loftet-social` for
volunteer applications using the project's pinned AT Protocol Spaces alpha.
Tracked by [LOFT-14](https://devotta.atlassian.net/browse/LOFT-14).

## Status

Initial extraction, version 0.1.0. Private repository and private package; nothing
is published to npm. Unit tests use simulated PDS responses. The independent
consumer checks the packed distribution. Live PDS verification and replacing
the implementation inside loftet-social remain follow-up work.

## Install and develop

Use Node 24.17.x and pnpm 11.8.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination artifacts
```

Install the resulting `artifacts/loftet-atproto-client-0.1.0.tgz` into another
project using its package manager. No sibling checkout is needed at runtime.

The independent example installs that tarball rather than importing source:

```sh
cd examples/consumer
npm install --ignore-scripts --no-package-lock ../../artifacts/loftet-atproto-client-0.1.0.tgz
npm start
```

## Read private records

```ts
import { createAtprotoClient, type Session } from "@loftet/atproto-client";

const client = createAtprotoClient({
  url: "https://pds.example",
  publicOrigin: "https://pds.example",
  spaceType: "org.example.community",
});

// Supplied by your server's identity component for the current user.
const session: Session = {
  did: authenticatedSession.did,
  fetchHandler: authenticatedSession.fetchHandler,
};
const space = `at://${ownerDid}/space/org.example.community/volunteers`;

// Obtain fresh credentials on EVERY incoming request before serving private data.
const read = await client.credential(session, space);
const page = await read("com.atproto.space.listRecords", {
  repo: authorDid,
  collection: "org.example.notice",
  limit: 100,
});
```

`authenticatedSession`, `ownerDid` and `authorDid` are values supplied by your
app. The package does not log users in or provision accounts. For a controlled
demo, `Session` can instead hold a server-side `accessJwt`.

## API

- `createAtprotoClient({ url, publicOrigin, spaceType, fetchImpl? })` creates a
  client for one trusted PDS. `publicOrigin` is the canonical origin used for
  DPoP signatures when the internal transport URL differs.
- `client.rpc(method, data?, session?, write?, headers?)` calls one of the
  supported methods with response validation. Set `write: true` for POST.
  This is a low-level transport API; it does not replace application permissions.
- `client.credential(session, space)` exchanges a fresh delegation for a
  per-user, DPoP-bound reader. It allows `space.listRepos` and `space.listRecords`
  for that space only. Do not cache or reuse this reader between requests.
- `parseSpace(uri, spaceType)` checks the expected namespace and returns
  `{ did, name }`. The initial implementation supports `did:plc` space owners.

Supported RPCs (full names start with `com.atproto.`):

| Area                | Methods                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account/session     | `server.createAccount`, `server.createSession`, `server.getSession`                                                                                          |
| Standard repository | `repo.listRecords`                                                                                                                                           |
| Spaces records      | `space.listRecords`, `space.putRecord`, `space.deleteRecord`, `space.listRepos`                                                                              |
| Spaces credentials  | `space.getDelegationToken`, `space.getSpaceCredential`                                                                                                       |
| Spaces management   | `simplespace.createSpace`, `simplespace.getSpace`, `simplespace.deleteSpace`, `simplespace.listMembers`, `simplespace.putMember`, `simplespace.removeMember` |

For example, create or update a record in the current author's repository:

```ts
await client.rpc(
  "com.atproto.space.putRecord",
  {
    space,
    repo: session.did,
    collection: "org.example.notice",
    rkey: "welcome",
    record: { $type: "org.example.notice", text: "Volunteer meeting" },
  },
  session,
  true,
);
```

The app owns record schemas, Lexicon publication/validation, membership policy,
pagination, writer discovery and database projections. The demo's local schemas
are experimental; using `validate: false` is an explicit app choice, not a
package default. A page's `cursor` must be passed to the next request to obtain
all results. Do not assume one page represents a complete group or membership list.

## Access and compatibility

- Keep this package, tokens and signing keys on the server. Use the requesting
  user's session, never an owner's session to read on someone else's behalf.
- Obtain a fresh reader before each private response, including responses based
  on a local cache. On authorization or network failure, do not serve old content.
- Revocation tests here simulate a PDS denying the next credential request.
  They do not prove real-PDS enforcement. Previously issued credentials may
  remain valid until expiry; this client cannot erase content already received.
- Transport responses are capped at 1 MiB, requests have a 10-second timeout,
  redirects are disabled, and malformed responses fail validation. No retries,
  credential persistence or content cache are provided.
- This is the Spaces alpha contract from the source demo, not a general client
  for every AT Protocol server. See [PROVENANCE.md](PROVENANCE.md) for exact pins.
  Federation, encryption, production hardening and social UI are outside this
  initial extraction.

## Next steps

- [LOFT-99](https://devotta.atlassian.net/browse/LOFT-99): review and finalize the extracted API.
- [LOFT-100](https://devotta.atlassian.net/browse/LOFT-100): integrate the package into loftet-social and run its existing checks.
- [LOFT-101](https://devotta.atlassian.net/browse/LOFT-101): complete live-PDS access/revocation checks and reuse documentation.

## License

Licensed under [MIT](LICENSE).

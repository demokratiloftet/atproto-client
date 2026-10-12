# Source and protocol baseline

Extracted from `demokratiloftet/loftet-social` commit
`2acc3004b5642de8718c3424254773286d4956be`:

- `server/pds.ts`: RPC transport, response validation, credential exchange and DPoP.
- `server/protocol.ts`: supported response schemas and session/reader types.
- `test/schema.test.ts` and `test/protocol.test.ts`: cryptographic and malformed-response test patterns.

Changes during extraction: configurable namespace, no dependency on
`@loftet/auth` or the app's database/content schema, namespace validation before
space RPCs, space-bound read methods, and an exported package API.

The source project's architecture documents Spaces upstream revision
`158c439bdb7f3890e7cf8200ed3c291823fec336`, image digest
`sha256:4b19b376aa6164b62ede70bb35db79096c6dac9985cecb175e82022860a3d796`.
This is the intended initial compatibility target. No live-PDS compatibility
claim is made by this extraction; local mock tests do not substitute for it.

No source deployment configuration, credentials, fixtures, generated data or
Git history were copied. Existing source ownership is preserved; this private
extraction does not introduce a new license or publish the code publicly.

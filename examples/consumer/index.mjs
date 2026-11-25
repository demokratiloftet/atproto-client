import assert from "node:assert/strict";
import { createAtprotoClient } from "atproto-client";

// Deterministic package smoke test, not a live PDS or security integration test.
const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const client = createAtprotoClient({
  url: "https://pds.example",
  publicOrigin: "https://pds.example",
  spaceType: "org.example.volunteers",
  fetchImpl: async (input) => {
    const method = new URL(input).pathname.split("/").at(-1);
    switch (method) {
      case "com.atproto.space.getDelegationToken":
        return Response.json({ token: "example-delegation" });
      case "com.atproto.space.getSpaceCredential":
        return Response.json({ credential: "example-credential" });
      case "com.atproto.space.listRecords":
        return Response.json({
          records: [
            {
              rkey: "welcome",
              cid: "example-cid",
              value: { $type: "org.example.notice", text: "Volunteer meeting" },
            },
          ],
        });
      default:
        throw new Error(`Unexpected method: ${method}`);
    }
  },
});
const read = await client.credential(
  { did, accessJwt: "example-session" },
  `at://${did}/space/org.example.volunteers/team`,
);
const { records } = await read("com.atproto.space.listRecords", {
  repo: did,
  collection: "org.example.notice",
});
assert.equal(records[0].value.text, "Volunteer meeting");
console.log(
  "Independent consumer passed using the installed package and a custom namespace.",
);

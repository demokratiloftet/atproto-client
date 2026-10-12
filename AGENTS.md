# Working on the AT Protocol client

- Keep this a small server-side package. Social records, UI, SQL projections,
  account provisioning and deployment infrastructure belong to consumers.
- Use the pinned Spaces contract documented in PROVENANCE.md. Document any
  compatibility change explicitly; never silently claim broad AT Protocol support.
- Preserve fresh per-user authorization. No owner fallback or stale private
  content on credential failure. Never copy runtime secrets or PDS credentials.
- Run `pnpm check` and the packed independent consumer after package changes.
  Label simulated tests clearly; real-PDS access checks are separate evidence.
- The repository/package is private. Do not publish to a registry or change
  visibility without an explicit user request.

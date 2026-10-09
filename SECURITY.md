# Security

## Design

- **No shared infrastructure.** Each user deploys their own copy with their own Google OAuth client. The project authors run no servers and receive no data.
- **Owner lock.** The remote server only completes sign-in for Google accounts listed in `ALLOWED_EMAILS`, and it re-checks this on every MCP request. Grants for any other account are refused and their Google token is revoked.
- **Token storage.**
  - Remote: Google tokens live in the grant `props` of [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider), which are encrypted at rest in your KV namespace with keys derived from the MCP client's token.
  - Local: tokens are stored in `~/.config/ghealth-mcp/tokens.json` with mode `0600`.
- **OAuth hardening.** PKCE (S256) on both the MCP and Google legs, a consent page that can't be framed, single-use `state` bound to the browser, and refresh-token revocation handling (`invalid_grant` drops the grant).
- **Least privilege.** `ENABLED_CATEGORIES` limits the Google scopes requested and the tools exposed.
- **Destructive operations.** Updates and deletes are annotated `destructiveHint`, so MCP clients ask for confirmation.
- **No telemetry.** The server makes no network calls except to Google's OAuth and Health APIs.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue. Do not include real health data in reports.

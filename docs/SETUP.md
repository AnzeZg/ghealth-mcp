# Setup

You need a Google account with Fitbit / Google Health data, and about 20 minutes.

## 1. Google Cloud project and API

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and create a project (e.g. `my-health-mcp`).
2. **APIs & Services → Library**: search for **Google Health API** and click **Enable**.
3. **Google Auth Platform → Branding / Audience** (the OAuth consent screen):
   - User type: **External**.
   - App name: anything, e.g. "My Health MCP". Support email: yours.
   - **Audience → Test users**: add your own Google account.
4. **Data access**: add the Google Health scopes you plan to use (all `.../auth/googlehealth.*` scopes, or only the ones matching your `ENABLED_CATEGORIES`).

### Avoiding the 7-day sign-out

Google expires sign-ins every **7 days** for apps whose publishing status is _Testing_. To avoid reconnecting weekly, go to **Audience → Publish app** and set the status to **In production** without submitting for verification. Since you are the only user, you'll see a "Google hasn't verified this app" warning when signing in: click **Advanced → Go to (app name)**. If Google won't let you publish with these scopes, leave the app in Testing and reconnect when asked.

## 2. OAuth clients

**Google Auth Platform → Clients → Create client**:

| Mode   | Application type    | Redirect URI                                                                                                                |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Local  | **Desktop app**     | none needed (uses `http://127.0.0.1:<random port>`)                                                                         |
| Remote | **Web application** | `https://ghealth-mcp.<your-subdomain>.workers.dev/callback` (add `http://localhost:8788/callback` for local Worker testing) |

Keep each client ID and secret handy. You can come back and add the Worker's redirect URI after the first deploy, once you know its URL.

## 3a. Remote mode (Claude web, desktop and mobile)

Requires a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and Node.js 20+.

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/ghealth-mcp && cd ghealth-mcp
npm install
npx wrangler login

npx wrangler secret put GOOGLE_CLIENT_ID       # Web application client ID
npx wrangler secret put GOOGLE_CLIENT_SECRET   # Web application client secret
npx wrangler secret put ALLOWED_EMAILS         # your Google account email (comma-separate several)

npm run deploy
```

The deploy prints your Worker URL, e.g. `https://ghealth-mcp.you.workers.dev`. The KV namespace is created automatically.

1. Add `https://ghealth-mcp.you.workers.dev/callback` as an authorized redirect URI on the Web application client (step 2).
2. Optional: edit `vars` in `wrangler.jsonc` (`ENABLED_CATEGORIES`, `DEFAULT_TIMEZONE`) and redeploy.
3. In Claude, go to **Settings → Connectors → Add custom connector**, name it "Google Health", and set the URL to `https://ghealth-mcp.you.workers.dev/mcp`.
4. Click **Connect**. You'll see this server's consent page and then Google's sign-in.

Connectors added on claude.ai are available in the Claude desktop and mobile apps automatically.

Using a custom domain? Set the `PUBLIC_URL` var to it (e.g. `https://health.example.com`) so tokens are bound to that URL.

## 3b. Local mode (Claude Desktop / Claude Code)

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/ghealth-mcp && cd ghealth-mcp
npm install && npm run build
```

Create `~/.config/ghealth-mcp/config.json` with the **Desktop app** client:

```json
{
  "clientId": "1234-abc.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-…",
  "enabledCategories": "",
  "defaultTimeZone": "Europe/Ljubljana"
}
```

Sign in (this opens your browser), then check it works:

```sh
node dist/local/cli.js auth
node dist/local/cli.js status
```

**Claude Code:**

```sh
claude mcp add google-health -- node /absolute/path/to/ghealth-mcp/dist/local/cli.js
```

**Claude Desktop:** edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "google-health": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/ghealth-mcp/dist/local/cli.js"]
    }
  }
}
```

Use the absolute path to `node` (`which node`), because Claude Desktop doesn't load your shell's PATH. Restart Claude Desktop afterwards.

## Troubleshooting

| Symptom                                                  | Fix                                                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google sign-in shows `invalid_scope` or "access blocked" | Some scopes (often `ecg`, `irn`) may not be available to your project. Remove them from `ENABLED_CATEGORIES`, e.g. `activity:rw,metrics:rw,nutrition:rw,sleep:rw,profile:rw,settings:rw`. |
| `ACCOUNT_NOT_LINKED`                                     | The Google account has no Fitbit / Google Health data. Sign in with the account used in the Google Health app.                                                                            |
| 403 errors on some types                                 | That category is disabled, or the sign-in predates enabling it. Sign in again (`auth`, or reconnect the connector).                                                                       |
| Connector asks to reconnect every week                   | Your consent screen is in Testing mode; see "Avoiding the 7-day sign-out" above.                                                                                                          |
| "Not allowed" after Google sign-in                       | The account isn't in `ALLOWED_EMAILS`.                                                                                                                                                    |
| Times are off by hours                                   | Set your time zone in the Google Health app settings, or set `DEFAULT_TIMEZONE`.                                                                                                          |

To revoke access at any time, go to https://myaccount.google.com/permissions. For local mode, also run `node dist/local/cli.js logout`.

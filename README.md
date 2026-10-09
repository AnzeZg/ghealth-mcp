# ghealth-mcp

An [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) **read and write your Google Health data**: Fitbit trackers like the Fitbit Air, Pixel Watch, and anything else syncing to the Google Health app.

Ask things like:

- "How did I sleep last night compared to my weekly average?"
- "Log 2 scrambled eggs and toast for breakfast." (Claude estimates the macros and logs them.)
- "I just did a 30 minute run, about 5 km."
- "Log 750 ml of water." / "I weigh 72.4 kg this morning."
- "Show my resting heart rate and HRV trend for the last 30 days."

> **Not affiliated with Google or Fitbit.** This is a community project built on the public [Google Health API](https://developers.google.com/health).

## Privacy model: bring your own credentials

There is **no central server**. Every user runs their own copy with their own Google Cloud OAuth client:

- **Local mode:** runs on your computer; tokens are stored in `~/.config/ghealth-mcp/` (readable only by you).
- **Remote mode:** runs on _your_ Cloudflare account (free tier). Tokens are encrypted in your own Workers KV, and an **owner lock** (`ALLOWED_EMAILS`) rejects every Google account except yours.

Your health data only travels between Google, your copy of the server, and your MCP client. The authors of this project never see it.

## What it can do

It covers the whole Google Health API v4: 40+ data types, reads and writes.

| Tool                                                             | What it does                                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `daily_summary`                                                  | Steps, distance, calories, active zone minutes, workouts, food and water totals, sleep, resting HR and HRV for a day |
| `log_meal` / `log_water`                                         | Log food (calories, protein, carbs, fat, fiber, sugar, sodium) and drinks                                            |
| `log_workout` / `log_weight`                                     | Log exercise sessions, and weight (+ body fat)                                                                       |
| `list_data_types` / `describe_data_type`                         | Discover data types, their operations and write schemas                                                              |
| `read_data` / `get_data_point`                                   | Raw data points in a time range (optionally deduplicated across devices)                                             |
| `aggregate_data`                                                 | Daily or windowed totals/averages (e.g. hourly heart rate, daily steps)                                              |
| `create_data_point` / `update_data_point` / `delete_data_points` | Generic writes for any writable type (sleep, height, moods, symptoms, …)                                             |
| `get_account` / `update_account`                                 | Identity, profile, settings (units, time zone), paired devices                                                       |
| `export_workout_tcx`                                             | Export a recorded workout (with GPS) as TCX                                                                          |

Updates and deletes are marked as destructive, so Claude asks before running them.

### Choosing what to expose

Set `ENABLED_CATEGORIES` to limit both the tools and the Google permissions requested, e.g.:

```
ENABLED_CATEGORIES=nutrition:rw,activity:rw,sleep:r,metrics:r
```

Categories: `activity`, `metrics`, `nutrition`, `sleep`, `profile`, `settings`, `location` (r), `ecg` (r), `irn` (r), `symptoms` (w), `mindfulness` (w), `reproductive` (w). Empty means everything. After changing it, sign in again so Google grants the new set of scopes.

## Setup

See **[docs/SETUP.md](docs/SETUP.md)**. In short:

1. Create a Google Cloud project, enable the Google Health API and create OAuth clients.
2. Pick a mode:
   - **Remote (works in Claude on web, desktop _and_ mobile):** deploy to Cloudflare and add `https://<your-worker>/mcp` as a custom connector in Claude.

     [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/AnzeZg/ghealth-mcp)

   - **Local (Claude Desktop / Claude Code only):** `npx ghealth-mcp auth`, then add the server to your MCP client config.

## Development

```sh
npm install
npm test            # unit + MCP tool tests (no network)
npm run typecheck   # Node and Worker targets
npm run generate    # refresh write schemas from Google's discovery document
npm run dev:local   # stdio server from source
npm run dev:remote  # Worker on http://localhost:8788 (needs .dev.vars)
npm run smoke       # live test against your account (local sign-in required)
```

Layout: `src/core` is runtime-agnostic (API client, catalog, tools), `src/local` is the Node stdio entry point and CLI, and `src/remote` is the Cloudflare Worker with the OAuth flow.

## License

MIT

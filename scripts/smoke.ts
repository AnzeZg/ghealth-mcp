/**
 * Live smoke test against YOUR Google Health account, using the local sign-in
 * (`npx ghealth-mcp auth` first). It writes one 1 ml water entry and deletes it again.
 *
 *   npm run smoke
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/local/cli.ts"],
  env: process.env as Record<string, string>,
  stderr: "inherit",
});
const client = new Client({ name: "ghealth-smoke", version: "0.0.0" });
await client.connect(transport);

let failures = 0;
async function step(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");
  const ok = !result.isError;
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${name} ${JSON.stringify(args)}\n  ${text.slice(0, 300).replace(/\n/g, "\n  ")}`);
  return text;
}

await step("get_account", { section: "identity" });
await step("get_account", { section: "devices" });
const created = await step("log_water", { amount: 1, unit: "ml" });
const name = /"name":"([^"]+hydration-log\/dataPoints\/[^"]+)"/.exec(created)?.[1];
await step("read_data", { type: "hydration-log", start: "today" });
if (name) await step("delete_data_points", { type: "hydration-log", ids: [name] });
else {
  failures++;
  console.log("✘ could not find the created water entry's name; delete it manually in the Google Health app");
}
await step("daily_summary", {});

await client.close();
console.log(failures ? `\n${failures} step(s) failed` : "\nAll smoke steps passed");
process.exit(failures ? 1 : 0);

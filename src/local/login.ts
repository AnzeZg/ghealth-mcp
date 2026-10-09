/** Browser sign-in for a Google "Desktop app" OAuth client using a loopback redirect + PKCE. */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildAuthorizeUrl, exchangeCode, fetchUserEmail, pkceChallenge, randomToken } from "../core/auth.js";
import type { StoredTokens } from "./store.js";

const TIMEOUT_MS = 5 * 60_000;

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {
    /* best effort; the URL is also printed */
  });
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;line-height:1.5"><h1>${title}</h1><p>${body}</p></body>`;

export async function browserLogin(opts: {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  log: (msg: string) => void;
}): Promise<StoredTokens> {
  const state = randomToken();
  const verifier = randomToken(48);
  const challenge = await pkceChallenge(verifier);

  return new Promise<StoredTokens>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const finish = (status: number, title: string, body: string) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(page(title, body));
        server.close();
      };
      try {
        if (url.searchParams.get("state") !== state) throw new Error("State mismatch; please retry.");
        const error = url.searchParams.get("error");
        if (error) throw new Error(`Google returned "${error}".`);
        const code = url.searchParams.get("code");
        if (!code) throw new Error("No authorization code received.");

        const tokens = await exchangeCode({
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          code,
          redirectUri,
          codeVerifier: verifier,
        });
        if (!tokens.refreshToken) throw new Error("Google did not return a refresh token.");
        const email = await fetchUserEmail(tokens.accessToken);
        finish(200, "Signed in", `Signed in as ${email}. You can close this tab.`);
        resolve({ ...tokens, email });
      } catch (err) {
        finish(400, "Sign-in failed", (err as Error).message);
        reject(err);
      }
    });

    let redirectUri = "";
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl = buildAuthorizeUrl({
        clientId: opts.clientId,
        redirectUri,
        scopes: opts.scopes,
        state,
        codeChallenge: challenge,
      });
      opts.log(`Opening your browser to sign in with Google. If it doesn't open, visit:\n\n${authUrl}\n`);
      openBrowser(authUrl);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google sign-in."));
    }, TIMEOUT_MS);
    server.on("close", () => clearTimeout(timer));
  });
}

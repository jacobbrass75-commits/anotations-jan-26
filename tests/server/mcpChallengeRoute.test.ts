import { spawn, type ChildProcess } from "child_process";
import { createServer as createNetServer, type AddressInfo } from "net";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../..");
const CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
// Synthetic value for the test only.
const TEST_TOKEN = "test-challenge-7f3a9c1e";

async function getFreePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });
}

async function startMcpServer(challengeToken: string | undefined) {
  const port = await getFreePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MCP_SERVER_PORT: String(port),
    SCHOLARMARK_BACKEND_URL: "http://127.0.0.1:9",
  };
  delete env.OPENAI_APPS_CHALLENGE_TOKEN;
  if (challengeToken !== undefined) env.OPENAI_APPS_CHALLENGE_TOKEN = challengeToken;

  const child = spawn(process.execPath, [join(repoRoot, "mcp-server/server.mjs")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return { child, baseUrl, output: () => output };
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  child.kill();
  throw new Error("MCP server did not start");
}

describe("OpenAI apps challenge route", () => {
  let child: ChildProcess | null = null;

  afterEach(() => {
    child?.kill();
    child = null;
  });

  it("is off by default", async () => {
    const server = await startMcpServer(undefined);
    child = server.child;

    const response = await fetch(`${server.baseUrl}${CHALLENGE_PATH}`);
    expect(response.status).toBe(404);
    expect(server.output()).toContain("OpenAI apps challenge route: disabled");
  });

  it("returns only the configured token as plain text", async () => {
    const server = await startMcpServer(`  ${TEST_TOKEN}\n`);
    child = server.child;

    const response = await fetch(`${server.baseUrl}${CHALLENGE_PATH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(TEST_TOKEN);

    const head = await fetch(`${server.baseUrl}${CHALLENGE_PATH}`, { method: "HEAD" });
    expect(head.status).toBe(200);

    expect(server.output()).toContain("OpenAI apps challenge route: enabled");
    expect(server.output()).not.toContain(TEST_TOKEN);
  });

  it("stays off when the token is not a single printable value", async () => {
    const server = await startMcpServer("two tokens");
    child = server.child;

    const response = await fetch(`${server.baseUrl}${CHALLENGE_PATH}`);
    expect(response.status).toBe(404);
    expect(server.output()).toContain("route disabled");
    expect(server.output()).not.toContain("two tokens");
  });
});

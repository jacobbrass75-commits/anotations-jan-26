import express from "express";
import { describe, expect, it } from "vitest";
import { sanitizeSseError, trackClientDisconnect } from "../../server/sseUtils";
import { startHttpServer } from "./helpers/http";

describe("sanitizeSseError", () => {
  it("replaces Anthropic model-not-found payloads with a user-safe message", () => {
    const message = sanitizeSseError(
      `404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-3-haiku-20241022"}}`,
      "Writing failed",
    );

    expect(message).toBe(
      "The configured writing model is unavailable. Please retry; the server will use the supported model fallback.",
    );
  });
});

describe("trackClientDisconnect", () => {
  // The handler subscribes after the JSON body was parsed and after an async gap,
  // which is where a req.on("close") listener never fires on Node 16 and later.
  async function startStreamingServer(finishAfterMs: number | null) {
    const outcome: { signal?: AbortSignal; requestCloseFired: boolean } = {
      requestCloseFired: false,
    };
    const app = express();
    app.use(express.json());
    app.post("/stream", async (req, res) => {
      await new Promise((done) => setTimeout(done, 20));
      outcome.signal = trackClientDisconnect(res);
      req.on("close", () => {
        outcome.requestCloseFired = true;
      });
      res.setHeader("Content-Type", "text/event-stream");
      res.write("data: started\n\n");
      if (finishAfterMs !== null) setTimeout(() => res.end("data: done\n\n"), finishAfterMs);
    });
    return { outcome, server: await startHttpServer(app) };
  }

  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
      await new Promise((done) => setTimeout(done, 10));
    }
  };

  it("does not abort when the response finishes normally", async () => {
    const { outcome, server } = await startStreamingServer(30);
    try {
      const response = await fetch(`${server.baseUrl}/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });
      expect(await response.text()).toContain("data: done");
      await new Promise((done) => setTimeout(done, 50));

      expect(outcome.signal?.aborted).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("aborts when the client disconnects after the request body completed", async () => {
    const { outcome, server } = await startStreamingServer(null);
    try {
      const controller = new AbortController();
      const response = await fetch(`${server.baseUrl}/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
        signal: controller.signal,
      });
      await response.body!.getReader().read();
      controller.abort();
      await waitFor(() => outcome.signal?.aborted === true);

      expect(outcome.signal?.aborted).toBe(true);
      // The listener the chat routes used to rely on stays silent on this disconnect.
      expect(outcome.requestCloseFired).toBe(false);
    } finally {
      await server.close();
    }
  });
});

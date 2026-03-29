import type { Express } from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

export interface JsonResponse<T = unknown> {
  status: number;
  body: T | null;
  text: string;
}

export async function startHttpServer(app: Express): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export async function requestJson<T = unknown>(
  baseUrl: string,
  path: string,
  init: Omit<RequestInit, "body"> & { body?: Record<string, unknown> | string } = {}
): Promise<JsonResponse<T>> {
  const headers = new Headers(init.headers);
  let body: string | undefined;

  if (typeof init.body === "string") {
    body = init.body;
  } else if (typeof init.body !== "undefined") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    body,
  });

  const text = await response.text();
  let parsedBody: T | null = null;

  if (text) {
    try {
      parsedBody = JSON.parse(text) as T;
    } catch {
      parsedBody = null;
    }
  }

  return {
    status: response.status,
    body: parsedBody,
    text,
  };
}

// Load environment variables first
import "dotenv/config";

import cors from "cors";
import express, { type Request, Response, NextFunction } from "express";
import multer from "multer";
import { registerRoutes } from "./routes";
import { registerAuthRoutes } from "./authRoutes";
import { registerOAuthRoutes } from "./oauthRoutes";
import { configureClerk } from "./auth";
import { serveStatic } from "./static";
import { initAnalytics } from "./analyticsLogger";
import { createServer } from "http";
import { assertProductionConfig } from "./productionConfig";
import { globalLimiter } from "./rateLimits";

assertProductionConfig(process.env, { phase: "runtime" });

const app = express();
const httpServer = createServer(app);
app.set("trust proxy", true);

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedOrigins = splitCsv(process.env.ALLOWED_ORIGINS);
const extraAllowedOrigins = splitCsv(process.env.EXTRA_ALLOWED_ORIGINS);
const allowedChromeExtensionIds = (process.env.CHROME_EXTENSION_IDS ?? "")
  .split(",")
  .map((extensionId) => extensionId.trim())
  .filter(Boolean);
const extensionCorsEnabled = process.env.EXTENSION_CORS_MODE !== "disabled";

const ALWAYS_ALLOWED_ORIGINS = new Set([
  "https://claude.ai",
  "https://claude.com",
]);
const DEFAULT_ALLOWED_ORIGINS = [
  "https://mcp.scholarmark.ai",
  "https://app.scholarmark.ai",
];
const ALLOWED_ORIGIN_SET = new Set(
  [...DEFAULT_ALLOWED_ORIGINS, ...allowedOrigins, ...extraAllowedOrigins].map((origin) =>
    normalizeOrigin(origin)
  ),
);
const EXTRA_ALLOWED_PROTOCOL_HOST_SET = new Set(
  extraAllowedOrigins
    .map((origin) => getProtocolHostForPortlessOrigin(origin))
    .filter((origin): origin is string => Boolean(origin)),
);
const ALLOWED_CHROME_EXTENSION_IDS = new Set(allowedChromeExtensionIds);

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function getProtocolHostForPortlessOrigin(origin: string): string | null {
  try {
    const url = new URL(normalizeOrigin(origin));
    if (url.port || !["http:", "https:"].includes(url.protocol)) return null;
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
}

function isExtraAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(normalizeOrigin(origin));
    return EXTRA_ALLOWED_PROTOCOL_HOST_SET.has(`${url.protocol}//${url.hostname}`);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  if (origin.startsWith("chrome-extension://")) {
    const extensionId = origin.slice("chrome-extension://".length).replace(/\/+$/, "");
    if (process.env.NODE_ENV === "production") {
      return extensionCorsEnabled && ALLOWED_CHROME_EXTENSION_IDS.has(extensionId);
    }
    return ALLOWED_CHROME_EXTENSION_IDS.size === 0 || ALLOWED_CHROME_EXTENSION_IDS.has(extensionId);
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  if (ALWAYS_ALLOWED_ORIGINS.has(normalizedOrigin)) return true;
  if (ALLOWED_ORIGIN_SET.has(normalizedOrigin)) return true;
  if (isExtraAllowedOrigin(normalizedOrigin)) return true;
  return false;
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use(globalLimiter);

// Reject malformed percent-encoding before Express route matching can throw.
app.use((req, res, next) => {
  try {
    decodeURIComponent(req.url);
    next();
  } catch {
    log(`Malformed URI sequence in request URL: ${req.url}`);
    res.status(400).json({ message: "Malformed URI sequence" });
  }
});

// Initialize Clerk authentication
configureClerk(app);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const userId = req.user?.userId ?? "anonymous";
      log(`${req.method} ${path} ${res.statusCode} durationMs=${duration} userId=${userId}`);
    }
  });

  next();
});

(async () => {
  registerOAuthRoutes(app);

  // Register auth routes before other routes
  registerAuthRoutes(app);

  await registerRoutes(httpServer, app);
  initAnalytics();

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    if (err instanceof multer.MulterError) {
      const status =
        err.code === "LIMIT_FILE_SIZE" || err.code === "LIMIT_FIELD_VALUE" ? 413 : 400;
      return res.status(status).json({ message: err.message, code: err.code });
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (err instanceof URIError || message.includes("Failed to decode param")) {
      log(`Malformed URI sequence in request URL: ${req.originalUrl}`);
      return res.status(400).json({ message: "Malformed URI sequence" });
    }

    if (status >= 500) {
      console.error(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Default to 5001 if not specified (different from ScholarMark's 5000).
  const port = parseInt(process.env.PORT || "5001", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`Open http://localhost:${port} in your browser`);
  });
})();

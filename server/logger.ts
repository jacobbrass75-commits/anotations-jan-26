import pino, { type LoggerOptions } from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = process.env.NODE_ENV === "development";

const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.secret",
      "password",
      "token",
      "apiKey",
      "secret",
    ],
    censor: "[redacted]",
  },
};

export const logger = pino(
  isDevelopment
    ? {
        ...loggerOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "SYS:standard",
          },
        },
      }
    : loggerOptions,
);

export function createLogger(module: string) {
  return logger.child({ module });
}

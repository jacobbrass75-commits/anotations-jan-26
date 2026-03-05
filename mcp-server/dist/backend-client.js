export class BackendHttpError extends Error {
    status;
    body;
    constructor(status, body, message) {
        super(message ?? `Backend request failed with status ${status}`);
        this.name = "BackendHttpError";
        this.status = status;
        this.body = body;
    }
}
async function parseResponseBody(response) {
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
        try {
            return await response.json();
        }
        catch {
            return null;
        }
    }
    try {
        return await response.text();
    }
    catch {
        return null;
    }
}
export class ScholarMarkBackendClient {
    baseUrl;
    requestTimeoutMs;
    constructor(baseUrl, requestTimeoutMs = 300_000) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.requestTimeoutMs = requestTimeoutMs;
    }
    async request(method, path, bearerToken, body, options) {
        const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const signal = options?.signal ?? controller.signal;
        const headers = {
            Authorization: `Bearer ${bearerToken}`,
        };
        if (!options?.acceptSse) {
            headers.Accept = "application/json";
        }
        else {
            headers.Accept = "text/event-stream";
        }
        if (typeof body !== "undefined") {
            headers["Content-Type"] = "application/json";
        }
        try {
            return await fetch(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: typeof body === "undefined" ? undefined : JSON.stringify(body),
                signal,
            });
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async requestJson(method, path, bearerToken, body) {
        const response = await this.request(method, path, bearerToken, body, { acceptSse: false });
        if (!response.ok) {
            throw new BackendHttpError(response.status, await parseResponseBody(response));
        }
        return await response.json();
    }
    async requestSSE(method, path, bearerToken, body, timeoutMs = this.requestTimeoutMs) {
        const response = await this.request(method, path, bearerToken, body, {
            acceptSse: true,
            timeoutMs,
        });
        if (!response.ok) {
            throw new BackendHttpError(response.status, await parseResponseBody(response));
        }
        return response;
    }
}

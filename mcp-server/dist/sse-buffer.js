function parseSseEvent(rawEvent) {
    const dataLines = rawEvent
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0)
        return null;
    const payloadText = dataLines.join("\n");
    if (payloadText === "[DONE]") {
        return { type: "done" };
    }
    try {
        const parsed = JSON.parse(payloadText);
        if (!parsed || typeof parsed !== "object")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function coerceString(value) {
    return typeof value === "string" ? value : "";
}
function coerceUsage(value) {
    if (!value || typeof value !== "object")
        return null;
    return {
        input_tokens: typeof value.input_tokens === "number" ? value.input_tokens : 0,
        output_tokens: typeof value.output_tokens === "number" ? value.output_tokens : 0,
    };
}
export async function consumeSSEStream(response, options) {
    if (!response.body) {
        throw new Error("SSE response body is empty");
    }
    const timeoutMs = options?.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let plainText = "";
    let usage = null;
    const documents = [];
    let activeDocument = null;
    while (true) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out while buffering SSE response after ${timeoutMs}ms`);
        }
        const { value, done } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
            if (!rawEvent.trim()) {
                continue;
            }
            const payload = parseSseEvent(rawEvent);
            if (!payload) {
                continue;
            }
            const eventType = coerceString(payload.type);
            if (eventType === "text") {
                plainText += coerceString(payload.text);
                continue;
            }
            if (eventType === "document_start") {
                if (activeDocument) {
                    documents.push(activeDocument);
                }
                activeDocument = {
                    title: coerceString(payload.title) || "Draft",
                    content: "",
                };
                continue;
            }
            if (eventType === "document_text") {
                if (!activeDocument) {
                    activeDocument = { title: "Draft", content: "" };
                }
                activeDocument.content += coerceString(payload.text);
                continue;
            }
            if (eventType === "document_end") {
                if (activeDocument) {
                    documents.push(activeDocument);
                    activeDocument = null;
                }
                continue;
            }
            if (eventType === "done") {
                usage = coerceUsage(payload.usage);
                if (activeDocument) {
                    documents.push(activeDocument);
                    activeDocument = null;
                }
                return { text: plainText, documents, usage };
            }
            if (eventType === "error") {
                throw new Error(coerceString(payload.error) || "Backend SSE stream returned an error");
            }
        }
    }
    if (activeDocument) {
        documents.push(activeDocument);
    }
    return { text: plainText, documents, usage };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { withAuthOperationDelayNotice } from "../../client/src/lib/authOperation";

afterEach(() => {
  vi.useRealTimers();
});

describe("embedded auth operation delay notice", () => {
  it("returns a completed Clerk operation without announcing a delay", async () => {
    const onDelayChange = vi.fn();

    await expect(
      withAuthOperationDelayNotice(Promise.resolve("complete"), "still working", onDelayChange, 25),
    ).resolves.toBe("complete");
    expect(onDelayChange).not.toHaveBeenCalled();
  });

  it("announces a delay without releasing the operation for a duplicate retry", async () => {
    vi.useFakeTimers();
    let resolveOperation: ((value: string) => void) | undefined;
    const operation = new Promise<string>((resolve) => {
      resolveOperation = resolve;
    });
    const onDelayChange = vi.fn();
    const result = withAuthOperationDelayNotice(
      operation,
      "Secure signup is still processing",
      onDelayChange,
      5,
    );
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(onDelayChange).toHaveBeenCalledWith("Secure signup is still processing");
    expect(settled).toBe(false);

    resolveOperation?.("complete");
    await expect(result).resolves.toBe("complete");
    expect(onDelayChange).toHaveBeenLastCalledWith(null);
  });
});

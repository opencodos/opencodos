import { describe, test, expect } from "bun:test";
import { withRetry } from "./retry";

describe("withRetry", () => {
  test("returns on first success", async () => {
    const result = await withRetry(() => Promise.resolve(42), {
      baseDelay: 10,
    });
    expect(result).toBe(42);
  });

  test("retries then succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      () => {
        attempts++;
        if (attempts < 3) throw new Error("fail");
        return Promise.resolve("ok");
      },
      { maxAttempts: 3, baseDelay: 10 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("throws after max attempts exhausted", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          return Promise.reject(new Error("always fails"));
        },
        { maxAttempts: 2, baseDelay: 10 },
      ),
    ).rejects.toThrow("always fails");
    expect(attempts).toBe(2);
  });

  test("onRetry callback fires on each attempt", async () => {
    const retryLog: Array<{ attempt: number; error: unknown }> = [];
    let attempts = 0;

    await withRetry(
      () => {
        attempts++;
        if (attempts < 3) throw new Error(`fail-${attempts}`);
        return Promise.resolve("done");
      },
      {
        maxAttempts: 3,
        baseDelay: 10,
        onRetry: (attempt, error) => {
          retryLog.push({ attempt, error });
        },
      },
    );

    // onRetry fires for failed attempts (1 and 2), not on success
    expect(retryLog.length).toBe(2);
    expect(retryLog[0].attempt).toBe(1);
    expect(retryLog[1].attempt).toBe(2);
  });

  test("preserves return type", async () => {
    const result = await withRetry(
      () => Promise.resolve({ name: "test", count: 5 }),
      { baseDelay: 10 },
    );
    expect(result).toEqual({ name: "test", count: 5 });
  });

  test("passes through non-Error throwables", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts++;
          throw "string-error";
        },
        { maxAttempts: 2, baseDelay: 10 },
      ),
    ).rejects.toBe("string-error");
  });
});

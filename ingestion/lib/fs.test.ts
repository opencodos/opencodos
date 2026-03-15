import { describe, test, expect, afterEach } from "bun:test";
import { atomicWriteFileSync, ensureDir, writeIfChanged } from "./fs";
import { readFileSync, existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

describe("fs", () => {
  const testDirs: string[] = [];

  function makeTempDir(): string {
    const dir = join(tmpdir(), `codos-fs-test-${randomUUID()}`);
    ensureDir(dir);
    testDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of testDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // cleanup best effort
      }
    }
    testDirs.length = 0;
  });

  describe("atomicWriteFileSync", () => {
    test("writes content to file", () => {
      const dir = makeTempDir();
      const filePath = join(dir, "test.txt");
      atomicWriteFileSync(filePath, "hello world");
      expect(readFileSync(filePath, "utf-8")).toBe("hello world");
    });

    test("creates parent directories when ensureDir is used first", () => {
      const dir = makeTempDir();
      const nested = join(dir, "a", "b", "c");
      ensureDir(nested);
      const filePath = join(nested, "deep.txt");
      atomicWriteFileSync(filePath, "deep content");
      expect(readFileSync(filePath, "utf-8")).toBe("deep content");
    });

    test("overwrites existing file atomically", () => {
      const dir = makeTempDir();
      const filePath = join(dir, "overwrite.txt");
      atomicWriteFileSync(filePath, "first");
      atomicWriteFileSync(filePath, "second");
      expect(readFileSync(filePath, "utf-8")).toBe("second");
    });

    test("no .tmp files left behind after write", () => {
      const dir = makeTempDir();
      const filePath = join(dir, "clean.txt");
      atomicWriteFileSync(filePath, "content");
      const files = readdirSync(dir);
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });

    test("no .tmp files left behind after failed write", () => {
      const dir = makeTempDir();
      // Try to write to a path where the parent doesn't exist (should throw)
      const badPath = join(dir, "nonexistent", "file.txt");
      try {
        atomicWriteFileSync(badPath, "content");
      } catch {
        // expected
      }
      // The parent dir doesn't exist, but the temp file was in the nonexistent dir,
      // so nothing should leak into the parent
      const files = readdirSync(dir);
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe("ensureDir", () => {
    test("creates directory", () => {
      const dir = join(tmpdir(), `codos-fs-test-${randomUUID()}`);
      testDirs.push(dir);
      ensureDir(dir);
      expect(existsSync(dir)).toBe(true);
    });

    test("is idempotent", () => {
      const dir = makeTempDir();
      // Call again - should not throw
      ensureDir(dir);
      expect(existsSync(dir)).toBe(true);
    });

    test("creates nested directories", () => {
      const base = join(tmpdir(), `codos-fs-test-${randomUUID()}`);
      testDirs.push(base);
      const nested = join(base, "x", "y", "z");
      ensureDir(nested);
      expect(existsSync(nested)).toBe(true);
    });

    test("returns the path for chaining", () => {
      const dir = join(tmpdir(), `codos-fs-test-${randomUUID()}`);
      testDirs.push(dir);
      const result = ensureDir(dir);
      expect(result).toBe(dir);
    });
  });

  describe("writeIfChanged", () => {
    test("writes new file when it doesn't exist", () => {
      const dir = makeTempDir();
      const file = join(dir, "new.md");

      const result = writeIfChanged(file, "hello world");

      expect(result).toBe(true);
      expect(readFileSync(file, "utf-8")).toBe("hello world");
    });

    test("skips write when content is identical", () => {
      const dir = makeTempDir();
      const file = join(dir, "same.md");

      writeIfChanged(file, "identical content");
      const result = writeIfChanged(file, "identical content");

      expect(result).toBe(false);
    });

    test("writes when content changes", () => {
      const dir = makeTempDir();
      const file = join(dir, "changed.md");

      writeIfChanged(file, "version 1");
      const result = writeIfChanged(file, "version 2");

      expect(result).toBe(true);
      expect(readFileSync(file, "utf-8")).toBe("version 2");
    });
  });
});

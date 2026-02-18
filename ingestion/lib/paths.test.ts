import { describe, test, expect } from "bun:test";
import { loadPaths, getInboxDir, getDynamicPath } from "./paths";
import { homedir } from "os";

describe("paths", () => {
  describe("loadPaths", () => {
    test("returns object with codosPath and vaultPath", () => {
      const paths = loadPaths();
      expect(paths).toHaveProperty("codosPath");
      expect(paths).toHaveProperty("vaultPath");
      expect(typeof paths.codosPath).toBe("string");
      expect(typeof paths.vaultPath).toBe("string");
    });

    test("codosPath is a non-empty string", () => {
      const { codosPath } = loadPaths();
      expect(codosPath.length).toBeGreaterThan(0);
    });

    test("vaultPath is a non-empty string", () => {
      const { vaultPath } = loadPaths();
      expect(vaultPath.length).toBeGreaterThan(0);
    });
  });

  describe("getInboxDir", () => {
    test("includes connector name in path", () => {
      const dir = getInboxDir("Slack");
      expect(dir).toContain("Slack");
    });

    test("includes inbox folder in path", () => {
      const dir = getInboxDir("Gmail");
      expect(dir).toContain("1 - Inbox");
    });

    test("different connectors produce different paths", () => {
      const slack = getInboxDir("Slack");
      const gmail = getInboxDir("Gmail");
      expect(slack).not.toBe(gmail);
    });
  });

  describe("getDynamicPath", () => {
    test("includes .bun/bin", () => {
      const path = getDynamicPath();
      expect(path).toContain(".bun/bin");
    });

    test("includes /usr/bin", () => {
      const path = getDynamicPath();
      expect(path).toContain("/usr/bin");
    });

    test("includes homebrew path", () => {
      const path = getDynamicPath();
      expect(path).toContain("/opt/homebrew/bin");
    });

    test("returns colon-separated string", () => {
      const path = getDynamicPath();
      expect(path.split(":").length).toBeGreaterThan(1);
    });
  });
});

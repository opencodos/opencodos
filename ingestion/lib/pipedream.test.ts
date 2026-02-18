import { describe, test, expect } from "bun:test";
import {
  getPipedreamCredentials,
  isPipedreamReady,
  getPipedreamAccountId,
} from "./pipedream";

describe("pipedream", () => {
  describe("getPipedreamCredentials", () => {
    test("returns null or valid credentials object", () => {
      const creds = getPipedreamCredentials();
      if (creds === null) {
        expect(creds).toBeNull();
      } else {
        expect(creds).toHaveProperty("projectId");
        expect(creds).toHaveProperty("clientId");
        expect(creds).toHaveProperty("clientSecret");
        expect(creds).toHaveProperty("environment");
        expect(creds).toHaveProperty("externalUserId");
        expect(typeof creds.projectId).toBe("string");
        expect(typeof creds.clientId).toBe("string");
        expect(typeof creds.clientSecret).toBe("string");
        expect(typeof creds.environment).toBe("string");
        expect(typeof creds.externalUserId).toBe("string");
      }
    });
  });

  describe("getPipedreamAccountId", () => {
    test("returns null or string for each service", () => {
      const services = [
        "slack",
        "gmail",
        "googlecalendar",
        "github",
        "linear",
        "notion",
      ] as const;
      for (const service of services) {
        const accountId = getPipedreamAccountId(service);
        if (accountId !== null) {
          expect(typeof accountId).toBe("string");
          expect(accountId.length).toBeGreaterThan(0);
        } else {
          expect(accountId).toBeNull();
        }
      }
    });
  });

  describe("isPipedreamReady", () => {
    test("returns boolean for slack", () => {
      const result = isPipedreamReady("slack");
      expect(typeof result).toBe("boolean");
    });

    test("returns boolean for gmail", () => {
      const result = isPipedreamReady("gmail");
      expect(typeof result).toBe("boolean");
    });

    test("returns boolean for all services", () => {
      const services = [
        "slack",
        "gmail",
        "googlecalendar",
        "github",
        "linear",
        "notion",
      ] as const;
      for (const service of services) {
        expect(typeof isPipedreamReady(service)).toBe("boolean");
      }
    });
  });
});

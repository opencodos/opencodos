import { describe, test, expect, beforeEach } from "bun:test";
import {
  getFormattedDate,
  getCurrentTime,
  getTimezone,
  getTimezoneLabel,
  _resetTimezoneCache,
} from "./date";

describe("date", () => {
  beforeEach(() => {
    _resetTimezoneCache();
    delete process.env.ATLAS_TIMEZONE;
  });

  describe("getFormattedDate", () => {
    test("returns YYYY-MM-DD format", () => {
      const result = getFormattedDate(0, new Date("2026-03-15T12:00:00Z"));
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("positive offset adds days", () => {
      process.env.ATLAS_TIMEZONE = "UTC";
      const base = new Date("2026-01-10T12:00:00Z");
      const result = getFormattedDate(3, base);
      expect(result).toBe("2026-01-13");
    });

    test("negative offset subtracts days", () => {
      process.env.ATLAS_TIMEZONE = "UTC";
      const base = new Date("2026-01-10T12:00:00Z");
      const result = getFormattedDate(-2, base);
      expect(result).toBe("2026-01-08");
    });

    test("zero offset returns same day", () => {
      process.env.ATLAS_TIMEZONE = "UTC";
      const base = new Date("2026-06-20T12:00:00Z");
      const result = getFormattedDate(0, base);
      expect(result).toBe("2026-06-20");
    });

    test("no offset defaults to today", () => {
      const result = getFormattedDate();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("getCurrentTime", () => {
    test("returns HH:MM format", () => {
      const result = getCurrentTime(new Date("2026-01-15T14:30:00Z"));
      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });

    test("respects timezone", () => {
      process.env.ATLAS_TIMEZONE = "UTC";
      const result = getCurrentTime(new Date("2026-01-15T14:30:00Z"));
      expect(result).toBe("14:30");
    });
  });

  describe("getTimezone", () => {
    test("respects ATLAS_TIMEZONE env var", () => {
      process.env.ATLAS_TIMEZONE = "America/New_York";
      const result = getTimezone();
      expect(result).toBe("America/New_York");
    });

    test("falls back to system timezone when env not set", () => {
      const result = getTimezone();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("getTimezoneLabel", () => {
    test("returns non-empty string", () => {
      const result = getTimezoneLabel();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    test("returns short label for known timezone", () => {
      process.env.ATLAS_TIMEZONE = "America/New_York";
      const label = getTimezoneLabel();
      // Should be EST or EDT depending on time of year
      expect(label).toMatch(/^[A-Z]{2,5}$/);
    });
  });

  describe("_resetTimezoneCache", () => {
    test("allows timezone to change after reset", () => {
      process.env.ATLAS_TIMEZONE = "America/New_York";
      const first = getTimezone();
      expect(first).toBe("America/New_York");

      _resetTimezoneCache();
      process.env.ATLAS_TIMEZONE = "Europe/London";
      const second = getTimezone();
      expect(second).toBe("Europe/London");
    });

    test("without reset, timezone is cached", () => {
      process.env.ATLAS_TIMEZONE = "America/New_York";
      const first = getTimezone();
      expect(first).toBe("America/New_York");

      // Change env without resetting cache
      process.env.ATLAS_TIMEZONE = "Europe/London";
      const second = getTimezone();
      // Should still be cached as New York
      expect(second).toBe("America/New_York");
    });
  });
});

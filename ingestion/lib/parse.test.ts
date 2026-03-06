import { describe, test, expect } from "bun:test";
import { parseJSON } from "./parse";

describe("parseJSON", () => {
  test("extracts JSON from code block", () => {
    const input = 'Here is the result:\n```json\n{"name": "test"}\n```';
    expect(parseJSON(input)).toEqual({ name: "test" });
  });

  test("extracts JSON from code block without json tag", () => {
    const input = "```\n[1, 2, 3]\n```";
    expect(parseJSON(input)).toEqual([1, 2, 3]);
  });

  test("extracts JSON array", () => {
    const input = 'Some text [{"id": 1}, {"id": 2}] more text';
    const result = parseJSON(input);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("extracts nested arrays", () => {
    const input = '[[1, 2], [3, 4]]';
    expect(parseJSON(input)).toEqual([[1, 2], [3, 4]]);
  });

  test("extracts JSON object", () => {
    const input = 'Result: {"key": "value", "num": 42}';
    expect(parseJSON(input)).toEqual({ key: "value", num: 42 });
  });

  test("returns null for non-JSON text", () => {
    expect(parseJSON("just some plain text")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseJSON("")).toBeNull();
  });

  test("handles brackets inside JSON strings correctly", () => {
    const input = '[{"text": "array [1,2] and object {a:b}"}]';
    const result = parseJSON(input);
    expect(result).toEqual([{ text: "array [1,2] and object {a:b}" }]);
  });

  test("handles escaped quotes inside strings", () => {
    const input = '[{"text": "he said \\"hello\\""}]';
    const result = parseJSON(input);
    expect(result).toEqual([{ text: 'he said "hello"' }]);
  });

  test("code block takes priority over raw JSON", () => {
    const input =
      '{"ignored": true}\n```json\n{"selected": true}\n```';
    expect(parseJSON(input)).toEqual({ selected: true });
  });

  test("handles multiline JSON in code block", () => {
    const input = '```json\n{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n```';
    expect(parseJSON(input)).toEqual({ a: 1, b: [2, 3] });
  });
});

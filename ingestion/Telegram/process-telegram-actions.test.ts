import { describe, test, expect } from "bun:test";
import {
  findBestMatch,
  parseHighPrioritySection,
  parseMediumPrioritySection,
  type Contact,
} from "./process-telegram-actions";

// Mock contacts matching the shape used in the source
const MOCK_CONTACTS: Contact[] = [
  {
    name: "John Smith",
    filePath: "/fake/profiles/John Smith.md",
    aliases: ["john smith", "john", "smith"],
  },
  {
    name: "Maria Garcia",
    filePath: "/fake/profiles/Maria Garcia.md",
    aliases: ["maria garcia", "maria", "garcia"],
  },
  {
    name: "Alex Chen",
    filePath: "/fake/profiles/Alex Chen.md",
    aliases: ["alex chen", "alex", "chen"],
  },
];

describe("findBestMatch", () => {
  test("exact full name match returns confidence 1.0", () => {
    const result = findBestMatch("John Smith", MOCK_CONTACTS);
    expect(result.contact).not.toBeNull();
    expect(result.contact!.name).toBe("John Smith");
    expect(result.confidence).toBe(1.0);
  });

  test("first-name-only match returns high confidence via alias", () => {
    // "Maria" matches the alias "maria" exactly -> 0.95 confidence
    const result = findBestMatch("Maria", MOCK_CONTACTS);
    expect(result.contact).not.toBeNull();
    expect(result.contact!.name).toBe("Maria Garcia");
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  test("partial name match returns intermediate confidence", () => {
    // "Roberto" matches alias "roberto firmino" via alias.includes(name) -> 0.8
    // and first name match -> 0.7, so max is 0.8
    const contacts: Contact[] = [
      {
        name: "Roberto Firmino",
        filePath: "/fake/profiles/Roberto Firmino.md",
        aliases: ["roberto firmino"],
      },
    ];
    const result = findBestMatch("Roberto", contacts);
    expect(result.contact).not.toBeNull();
    expect(result.contact!.name).toBe("Roberto Firmino");
    // Should be between the first-name (0.7) and exact-alias (0.95) thresholds
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.confidence).toBeLessThan(0.95);
  });

  test("no match returns confidence below threshold", () => {
    const result = findBestMatch("Completely Unknown Person", MOCK_CONTACTS);
    // Either null contact or confidence below 0.6 (the threshold used in main)
    if (result.contact !== null) {
      expect(result.confidence).toBeLessThan(0.6);
    } else {
      expect(result.confidence).toBe(0);
    }
  });

  test("self-reference names are filtered by parsers, not findBestMatch", () => {
    // findBestMatch doesn't filter self-references — the parsing functions skip
    // names listed in SKIP_NAMES before ever calling findBestMatch.
    // Verify that parseHighPrioritySection skips "me" and "i".
    const markdown = `## Priority DMs

### me | Personal
- **Context**: Self-reference
- **Action needed**: None

### i | Personal
- **Context**: Another self-reference
- **Action needed**: None

### John Smith | Acme
- **Context**: Real person
- **Action needed**: Send proposal
`;
    const mentions = parseHighPrioritySection(markdown, "2025-01-15");
    // "me" and "i" should be filtered out, only "John Smith" remains
    expect(mentions).toHaveLength(1);
    expect(mentions[0].name).toBe("John Smith");
  });
});

describe("parseHighPrioritySection", () => {
  test("extracts names and action items from markdown format", () => {
    const markdown = `# Daily Summary 2025-01-15

## Priority DMs

### John Smith | Acme Corp
- **Context**: Discussed partnership terms
- **Key points**: pricing agreed; timeline set for Q2
- **Action needed**: Send contract draft by Friday

### Maria Garcia | StartupXYZ
- **Context**: Followed up on demo request
- **Key points**: wants enterprise plan
- **Action needed**: Schedule demo call

## Medium Priority
- **Alex Chen**: Shared article about AI trends
`;

    const mentions = parseHighPrioritySection(markdown, "2025-01-15");

    expect(mentions).toHaveLength(2);

    expect(mentions[0].name).toBe("John Smith");
    expect(mentions[0].organization).toBe("Acme Corp");
    expect(mentions[0].context).toBe("Discussed partnership terms");
    expect(mentions[0].keyPoints).toContain("pricing agreed");
    expect(mentions[0].actionNeeded).toBe("Send contract draft by Friday");
    expect(mentions[0].priority).toBe("high");
    expect(mentions[0].date).toBe("2025-01-15");

    expect(mentions[1].name).toBe("Maria Garcia");
    expect(mentions[1].organization).toBe("StartupXYZ");
    expect(mentions[1].actionNeeded).toBe("Schedule demo call");
  });
});

describe("parseMediumPrioritySection", () => {
  test("extracts names and detects action keywords", () => {
    const markdown = `# Daily Summary

## Priority DMs

### Someone | SomeCorp
- **Context**: Chat about stuff

## Medium Priority
- **Alex Chen**: Shared article about AI trends
- **Bob Lee**: Follow up on contract review
`;

    const mentions = parseMediumPrioritySection(markdown, "2025-01-15");

    expect(mentions).toHaveLength(2);

    expect(mentions[0].name).toBe("Alex Chen");
    expect(mentions[0].priority).toBe("medium");
    // "Shared article" has no action keywords
    expect(mentions[0].actionNeeded).toBeNull();

    expect(mentions[1].name).toBe("Bob Lee");
    // "Follow up" matches the action keyword regex
    expect(mentions[1].actionNeeded).not.toBeNull();
  });
});

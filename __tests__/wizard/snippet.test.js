import { describe, expect, test } from "@jest/globals";
import {
  buildSnippet,
  injectConfig,
  MODE_OPTIONS,
} from "../../wizard/snippet.js";

describe("buildSnippet", () => {
  test("emits CONFIG markers with JSON-encoded values", () => {
    const snippet = buildSnippet({
      name: "my-macro",
      webappUrl: "https://example.github.io/my-macro/webapp/",
      hasButton: true,
      defaultMode: "MTR Only",
      showCalendar: true,
      buttonName: "My Macro",
    });
    expect(snippet).toBe(
      [
        "// CONFIG:start",
        'const MACRO_NAME = "my-macro";',
        'const WEBAPP_URL = "https://example.github.io/my-macro/webapp/";',
        "const HAS_BUTTON = true;",
        'const DEFAULT_MODE = "MTR Only";',
        "const SHOW_CALENDAR = true;",
        'const BUTTON_NAME = "My Macro";',
        "// CONFIG:end",
      ].join("\n"),
    );
  });

  test("safely encodes quotes in values", () => {
    const snippet = buildSnippet({ name: 'a"b', webappUrl: "" });
    expect(snippet).toContain('const MACRO_NAME = "a\\"b";');
  });

  test("defaults missing values to empty strings", () => {
    const snippet = buildSnippet();
    expect(snippet).toContain('const MACRO_NAME = "";');
    expect(snippet).toContain('const BUTTON_NAME = "";');
  });

  test("defaults hasButton to true when omitted", () => {
    expect(buildSnippet()).toContain("const HAS_BUTTON = true;");
  });

  test("honours an explicit hasButton: false", () => {
    expect(buildSnippet({ hasButton: false })).toContain(
      "const HAS_BUTTON = false;",
    );
  });
});

describe("buildSnippet default mode", () => {
  test("offers Auto, RoomOS Only and MTR Only", () => {
    expect(MODE_OPTIONS).toEqual(["Auto", "RoomOS Only", "MTR Only"]);
  });

  test.each(MODE_OPTIONS)("emits %s", (mode) => {
    expect(buildSnippet({ defaultMode: mode })).toContain(
      `const DEFAULT_MODE = ${JSON.stringify(mode)};`,
    );
  });

  test("defaults to Auto when omitted", () => {
    expect(buildSnippet()).toContain('const DEFAULT_MODE = "Auto";');
  });

  test("falls back to Auto for an unknown mode", () => {
    expect(buildSnippet({ defaultMode: "Bogus" })).toContain(
      'const DEFAULT_MODE = "Auto";',
    );
  });
});

describe("buildSnippet show calendar", () => {
  test("is off unless asked for", () => {
    expect(buildSnippet()).toContain("const SHOW_CALENDAR = false;");
  });

  test("honours an explicit showCalendar", () => {
    expect(buildSnippet({ showCalendar: true })).toContain(
      "const SHOW_CALENDAR = true;",
    );
    expect(buildSnippet({ showCalendar: false })).toContain(
      "const SHOW_CALENDAR = false;",
    );
  });
});

describe("injectConfig", () => {
  const macro = [
    'import xapi from "xapi";',
    "// CONFIG:start",
    'const MACRO_NAME = "old";',
    'const WEBAPP_URL = "old";',
    "const HAS_BUTTON = true;",
    'const DEFAULT_MODE = "Auto";',
    "const SHOW_CALENDAR = false;",
    'const BUTTON_NAME = "old";',
    "// CONFIG:end",
    "init();",
    "",
  ].join("\n");

  test("replaces the block and preserves surrounding code", () => {
    const next = injectConfig(macro, {
      name: "new",
      webappUrl: "https://new/",
      hasButton: true,
      defaultMode: "RoomOS Only",
      showCalendar: true,
      buttonName: "New Macro",
    });
    expect(next).toContain("const SHOW_CALENDAR = true;");
    expect(next).toContain('const MACRO_NAME = "new";');
    expect(next).toContain('const DEFAULT_MODE = "RoomOS Only";');
    expect(next).toContain('const BUTTON_NAME = "New Macro";');
    expect(next.startsWith('import xapi from "xapi";')).toBe(true);
    expect(next.trimEnd().endsWith("init();")).toBe(true);
  });

  test("is idempotent", () => {
    const values = { name: "new", webappUrl: "https://new/" };
    const once = injectConfig(macro, values);
    const twice = injectConfig(once, values);
    expect(twice).toBe(once);
  });

  test("throws when the markers are missing", () => {
    expect(() => injectConfig("no markers here", { name: "x" })).toThrow();
  });
});

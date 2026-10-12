import { describe, expect, test } from "@jest/globals";
import { buildSnippet, injectConfig } from "../../wizard/snippet.js";

describe("buildSnippet", () => {
  test("emits CONFIG markers with JSON-encoded values", () => {
    const snippet = buildSnippet({
      name: "my-macro",
      webappUrl: "https://example.github.io/my-macro/webapp/",
      hasButton: true,
      buttonName: "My Macro",
    });
    expect(snippet).toBe(
      [
        "// CONFIG:start",
        'const MACRO_NAME = "my-macro";',
        'const WEBAPP_URL = "https://example.github.io/my-macro/webapp/";',
        "const HAS_BUTTON = true;",
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

describe("injectConfig", () => {
  const macro = [
    'import xapi from "xapi";',
    "// CONFIG:start",
    'const MACRO_NAME = "old";',
    'const WEBAPP_URL = "old";',
    "const HAS_BUTTON = true;",
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
      buttonName: "New Macro",
    });
    expect(next).toContain('const MACRO_NAME = "new";');
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

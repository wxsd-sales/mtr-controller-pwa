import { readFileSync, existsSync } from "node:fs";
import { describe, expect, test } from "@jest/globals";
import {
  BUNDLE_FAVICON,
  BUNDLE_FILES,
  bundleReadme,
  rewriteIndex,
} from "../../wizard/webapp-bundle.js";

const WEBAPP = new URL("../../webapp/", import.meta.url);
const html = readFileSync(new URL("index.html", WEBAPP), "utf8");

describe("BUNDLE_FILES", () => {
  test("all exist in webapp/", () => {
    for (const name of BUNDLE_FILES) {
      expect(existsSync(new URL(name, WEBAPP))).toBe(true);
    }
  });

  test("cover every file index.html loads from its own folder", () => {
    // <script src="x.js">, import ... from "./x.js", href="x"
    const local = new Set([
      ...[...html.matchAll(/(?:src|href)="([^":]+?)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/from "\.\/([^"]+)"/g)].map((m) => m[1]),
    ]);
    for (const name of local) {
      if (name.startsWith("../") || name.startsWith("#")) continue;
      expect(BUNDLE_FILES).toContain(name);
    }
  });

  test("the modules the web app imports import nothing else local", () => {
    for (const name of BUNDLE_FILES.filter((f) => f.endsWith(".js"))) {
      const source = readFileSync(new URL(name, WEBAPP), "utf8");
      for (const m of source.matchAll(/from "\.\/([^"]+)"/g)) {
        expect(BUNDLE_FILES).toContain(m[1]);
      }
    }
  });
});

describe("rewriteIndex", () => {
  test("the page's favicon points outside webapp/ before and at the bundled copy after", () => {
    expect(html).toContain(`href="${BUNDLE_FAVICON.from}"`);
    const rewritten = rewriteIndex(html);
    expect(rewritten).not.toContain(BUNDLE_FAVICON.from);
    expect(rewritten).toContain(`href="${BUNDLE_FAVICON.name}"`);
  });
});

describe("bundleReadme", () => {
  test("explains IIS hosting and mentions the entered URL", () => {
    const text = bundleReadme({ hostUrl: "https://pwa.example.com/app/" });
    expect(text).toContain("IIS");
    expect(text).toContain("https://pwa.example.com/app/");
  });

  test("falls back to an example URL", () => {
    expect(bundleReadme()).toContain("https://pwa.example.com/");
  });
});

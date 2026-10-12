import { readFile, writeFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * One-way cleanup for the one-time project setup pipeline. `npm run setup`
 * (backed by scripts/apply-config.mjs and project.config.json) exists only to
 * name a freshly-created project; once that's done it has no further job.
 *
 * This does NOT touch the macro/wizard's own CONFIG-block mechanism (the
 * `// CONFIG:start` / `// CONFIG:end` markers in macros/main.js) - that's a
 * separate, ongoing feature the deployed wizard keeps using client-side
 * (Copy config / Download macro) for as long as the project is deployed.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FILES_TO_REMOVE = [
  "scripts/setup.mjs",
  "scripts/apply-config.mjs",
  "project.config.json",
  "project.config.schema.json",
  "__tests__/scripts/apply-config.test.js",
];

/** Strip a marker pair, keeping the trimmed content between them. */
function unwrapMarkers(content, startMarker, endMarker) {
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return content;
  const inner = content.slice(startIdx + startMarker.length, endIdx).trim();
  const before = content.slice(0, startIdx).replace(/\n+$/, "");
  const after = content.slice(endIdx + endMarker.length).replace(/^\n+/, "");
  const middle = before ? `${before}\n\n${inner}` : inner;
  const result = after ? `${middle}\n\n${after}` : middle;
  return result.replace(/\n{3,}/g, "\n\n");
}

function replaceLiteral(content, search, replacement, label) {
  if (!content.includes(search)) {
    console.warn(
      `  warning: expected text for "${label}" not found - left README.md unchanged there.`,
    );
    return content;
  }
  return content.replace(search, replacement);
}

async function removeFiles() {
  for (const relPath of FILES_TO_REMOVE) {
    const filePath = join(ROOT, relPath);
    if (existsSync(filePath)) {
      await rm(filePath);
      console.log(`  removed ${relPath}`);
    }
  }

  const testsScriptsDir = join(ROOT, "__tests__", "scripts");
  if (existsSync(testsScriptsDir)) {
    const remaining = await readdir(testsScriptsDir);
    if (remaining.length === 0) {
      await rm(testsScriptsDir, { recursive: true });
      console.log("  removed __tests__/scripts/ (now empty)");
    }
  }
}

async function updatePackageJson() {
  const filePath = join(ROOT, "package.json");
  const pkg = JSON.parse(await readFile(filePath, "utf8"));
  let changed = false;
  for (const key of ["setup", "apply-config"]) {
    if (key in pkg.scripts) {
      delete pkg.scripts[key];
      changed = true;
    }
  }
  if (changed) {
    await writeFile(filePath, JSON.stringify(pkg, null, 2) + "\n");
    console.log("  updated package.json");
  }
}

async function updateGeneratedAppConfigs() {
  const OLD_JS_HEADER =
    "// Generated from project.config.json by scripts/apply-config.mjs - do not edit.";
  const NEW_JS_HEADER =
    "// Static app configuration for this project. Edit the values below directly if they need to change.";
  const OLD_HTML_COMMENT =
    "<!-- Generated from project.config.json by scripts/apply-config.mjs. -->";
  const NEW_HTML_COMMENT =
    "<!-- Static app configuration values for this project. -->";

  for (const dir of ["wizard", "webapp"]) {
    const jsPath = join(ROOT, dir, "app-config.js");
    if (existsSync(jsPath)) {
      const content = await readFile(jsPath, "utf8");
      const updated = content.replace(OLD_JS_HEADER, NEW_JS_HEADER);
      if (updated !== content) {
        await writeFile(jsPath, updated);
        console.log(`  updated ${dir}/app-config.js`);
      }
    }

    const htmlPath = join(ROOT, dir, "index.html");
    if (existsSync(htmlPath)) {
      const content = await readFile(htmlPath, "utf8");
      const updated = content.replace(OLD_HTML_COMMENT, NEW_HTML_COMMENT);
      if (updated !== content) {
        await writeFile(htmlPath, updated);
        console.log(`  updated ${dir}/index.html`);
      }
    }
  }
}

async function updateReadme() {
  const filePath = join(ROOT, "README.md");
  if (!existsSync(filePath)) return;
  let content = await readFile(filePath, "utf8");

  content = replaceLiteral(
    content,
    "\n> The title, description, and URLs above are generated from\n> `project.config.json`. Run `npm run setup` to customise them.\n",
    "\n",
    "setup note",
  );

  content = unwrapMarkers(
    content,
    "<!-- title:start -->",
    "<!-- title:end -->",
  );
  content = unwrapMarkers(
    content,
    "<!-- description:start -->",
    "<!-- description:end -->",
  );
  content = unwrapMarkers(content, "<!-- urls:start -->", "<!-- urls:end -->");

  content = replaceLiteral(
    content,
    [
      "```sh",
      "npm install",
      "npm run setup   # names the project and rewrites the derived values",
      "npm test",
      "```",
      "",
      "`npm run setup` prompts for the project name, title, description, author,",
      "GitHub org/repo (auto-detected from your git remote), and whether the macro",
      "should show a home-screen button (and its label, if so) - not every macro",
      "needs one. It writes `project.config.json`, then propagates those values into",
      "`package.json`, the macro, and both web apps. Re-run it any time; it is",
      "idempotent.",
    ].join("\n"),
    ["```sh", "npm install", "npm test", "```"].join("\n"),
    "quick start",
  );

  content = replaceLiteral(
    content,
    [
      "├── scripts/          # dev automation (setup, apply-config, serve, screenshots, deploy-macro)",
      "├── webapp/           # optional advanced-feature app (Pages: /webapp/)",
      "├── wizard/           # macro configuration app (Pages: /wizard/)",
      "│                     #   app-config.js is generated from project.config.json",
      "├── project.config.json         # single source of truth (see .schema.json)",
      "└── project.config.schema.json  # JSON Schema for project.config.json",
    ].join("\n"),
    [
      "├── scripts/          # dev automation (serve, screenshots, deploy-macro)",
      "├── webapp/           # optional advanced-feature app (Pages: /webapp/)",
      "└── wizard/           # macro configuration app (Pages: /wizard/)",
    ].join("\n"),
    "project structure",
  );

  content = replaceLiteral(
    content,
    [
      "The `CONFIG` block in the macro is managed by `npm run apply-config`; use the",
      "[wizard](#live-urls) to generate an updated block (**Copy config**) or download a",
      "ready-to-import macro file (**Download macro**) after changing settings.",
    ].join("\n"),
    [
      "The `CONFIG` block in the macro is managed by the [wizard](#live-urls) - use",
      "**Copy config** to grab an updated block, or **Download macro** for a",
      "ready-to-import macro file, after changing settings.",
    ].join("\n"),
    "installing the macro",
  );

  content = replaceLiteral(
    content,
    [
      "| `npm run setup`        | Interactive rename; writes `project.config.json` and applies it  |",
      "| `npm run apply-config` | Re-apply `project.config.json` to all files                      |",
      "| `npm run remove-setup` | Permanently delete the one-time setup tooling (see above)        |",
      "| `npm run serve`        | Serve the repo locally (wizard + webapp) with Node's http server |",
    ].join("\n"),
    [
      "| `npm run remove-setup` | Permanently delete the one-time setup tooling (see above)        |",
      "| `npm run serve`        | Serve the repo locally (wizard + webapp) with Node's http server |",
    ].join("\n"),
    "dev scripts table",
  );

  await writeFile(filePath, content);
  console.log("  updated README.md");
}

async function confirm() {
  if (process.argv.includes("--yes") || process.argv.includes("-y")) {
    return true;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    "This permanently deletes the one-time setup tooling (scripts/setup.mjs, " +
      "scripts/apply-config.mjs, project.config.json, project.config.schema.json) " +
      "and cannot be undone. The macro/wizard's own CONFIG-block feature is not " +
      "affected. Continue? (y/N): ",
  );
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const alreadyRemoved = FILES_TO_REMOVE.every(
    (relPath) => !existsSync(join(ROOT, relPath)),
  );
  if (alreadyRemoved) {
    console.log("Setup tooling already removed - nothing to do.");
    return;
  }

  if (!(await confirm())) {
    console.log("Aborted. No files were changed.");
    return;
  }

  await removeFiles();
  await updatePackageJson();
  await updateGeneratedAppConfigs();
  await updateReadme();

  console.log(
    "\nSetup tooling removed. Review the changes and commit when ready.",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyConfig } from "./apply-config.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, "project.config.json");

function detectOrgRepo() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim();
    const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
    if (match) return { org: match[1], repo: match[2] };
  } catch {
    // No git remote configured yet; fall back to existing config defaults.
  }
  return {};
}

function toKebabCase(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isKebabCase(value) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

const current = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
const detected = detectOrgRepo();

// Repos made from this template are typically created on GitHub first, then
// cloned locally, so the checkout directory is usually already the repo's
// final kebab-case name - prefer it over the template's placeholder default.
const dirName = basename(ROOT);
const suggestedName = isKebabCase(dirName) ? dirName : current.name;

const rl = createInterface({ input: stdin, output: stdout });

async function ask(label, fallback) {
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback || "";
}

console.log(
  "Configure this macro template. Press Enter to accept the default.\n",
);

const name = toKebabCase(await ask("Project name (kebab-case)", suggestedName));
const title = await ask("Display title", current.title);
const description = await ask("Description", current.description);
const author = await ask("Author", current.author);
const org = await ask("GitHub org/user", detected.org || current.org);
const repo = toKebabCase(
  await ask("GitHub repo", detected.repo || current.repo || name),
);
const webappAnswer = await ask(
  "Include advanced web app? (y/n)",
  current.webapp !== false ? "y" : "n",
);
const hasButtonAnswer = await ask(
  "Show a home-screen button that opens the web app? (y/n)",
  current.hasButton !== false ? "y" : "n",
);
const hasButton = /^y(es)?$/i.test(hasButtonAnswer);
// Only prompted when there's a button to name; otherwise keep whatever was
// last saved so re-enabling the button later doesn't lose a prior label.
const buttonName = hasButton
  ? await ask(
      "Button name (shown on the device home screen)",
      current.buttonName || title,
    )
  : current.buttonName || "";

rl.close();

const config = {
  $schema: current.$schema ?? "./project.config.schema.json",
  name,
  title,
  description,
  author,
  org,
  repo,
  webapp: /^y(es)?$/i.test(webappAnswer),
  hasButton,
  buttonName,
};

await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
console.log("\nSaved project.config.json.\n");

await applyConfig();

console.log("\nSetup complete. Review the changes and commit when ready.");

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";
import { startStaticServer } from "./server.mjs";
import { DEMO_ADDRESS, DEMO_SCENES } from "../webapp/demo.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// SCREENSHOT_OUT redirects the output, e.g. to try the script without touching assets/.
const OUT_DIR = process.env.SCREENSHOT_OUT
  ? resolve(process.env.SCREENSHOT_OUT)
  : join(ROOT, "assets");
const WIDTH = Number(process.env.SCREENSHOT_WIDTH) || 1280;
const HEIGHT = Number(process.env.SCREENSHOT_HEIGHT) || 800;

function isExecutable(candidate) {
  if (candidate.includes("/") || candidate.includes("\\")) {
    return existsSync(candidate);
  }
  const probe = spawnSync(platform() === "win32" ? "where" : "which", [
    candidate,
  ]);
  return probe.status === 0;
}

function resolveChrome() {
  if (process.env.CHROME_BIN) {
    if (isExecutable(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
    throw new Error(
      `CHROME_BIN is set but not executable: ${process.env.CHROME_BIN}`,
    );
  }

  const candidatesByPlatform = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    linux: [
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
      "chrome",
    ],
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
  };

  const candidates = candidatesByPlatform[platform()] ?? [];
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }

  throw new Error(
    "Could not find a headless Chrome/Chromium binary. Install Google Chrome or set CHROME_BIN to its path.",
  );
}

// Chrome writes a lot of harmless native-side noise to stderr in headless
// mode (e.g. macOS display-link warnings when there's no real display, or
// allocator-shim notices) even on a fully successful capture. These patterns
// are filtered out of successful runs so real problems aren't buried; a
// failed run still prints stderr in full, unfiltered.
const BENIGN_STDERR_PATTERNS = [
  /CVDisplayLinkCreateWithCGDisplay failed/,
  /Trying to load the allocator multiple times/,
  /task_policy_set TASK_(CATEGORY|SUPPRESSION)_POLICY/,
];

function capture(chromeBin, url, outPath, height = HEIGHT) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      `--window-size=${WIDTH},${height}`,
      "--virtual-time-budget=2500",
      `--screenshot=${outPath}`,
      url,
    ];
    const child = spawn(chromeBin, args, {
      stdio: ["ignore", "inherit", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        const relevant = stderr
          .split("\n")
          .filter(
            (line) =>
              line.trim() &&
              !BENIGN_STDERR_PATTERNS.some((pattern) => pattern.test(line)),
          );
        if (relevant.length) console.error(relevant.join("\n"));
        resolvePromise();
        return;
      }
      if (stderr.trim()) console.error(stderr);
      reject(
        new Error(`Chrome exited with code ${code} while capturing ${url}`),
      );
    });
  });
}

const chromeBin = resolveChrome();
mkdirSync(OUT_DIR, { recursive: true });

// The web app is captured once per demo scene (webapp/demo.js), in the order the
// README presents them: MTR out of call, MTR in call, RoomOS for comparison, then
// the connecting and error screens. Each URL carries { demo: "<scene>" } in the
// hash, so no device is needed. bad-hash is not a scene: it is a hash that is
// missing a parameter, which shows the web app's error view.
const encodeHash = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64");
const webappScenes = [
  ...Object.keys(DEMO_SCENES).map((name) => ({
    name,
    hash: encodeHash({ demo: name }),
  })),
  {
    name: "bad-hash",
    hash: encodeHash({ username: "pwa-controller", address: DEMO_ADDRESS }),
  },
];

// The wizard is captured on each of its three tabs, in both themes. The theme is
// forced via the "#theme=" hash so the result does not depend on the CI runner's
// OS colour-scheme preference, and "#tab=" opens the tab (see wizard.js). The
// window is tall enough to show the whole tab.
const themes = ["light", "dark"];
const wizardTabs = [
  { name: "configuration", tab: "general", height: 900 },
  { name: "export-macro", tab: "export", height: 650 },
  { name: "export-webapp", tab: "export-webapp", height: 1000 },
];

const { url, close } = await startStaticServer({ root: ROOT, port: 0 });
try {
  for (const { name, tab, height } of wizardTabs) {
    for (const theme of themes) {
      const outName = `wizard-${name}-${theme}.png`;
      await capture(
        chromeBin,
        `${url}/wizard/#theme=${theme}&tab=${tab}`,
        join(OUT_DIR, outName),
        height,
      );
      console.log(`Captured ${outName}`);
    }
  }
  if (existsSync(join(ROOT, "webapp", "index.html"))) {
    for (const { name, hash } of webappScenes) {
      const outName = `webapp-${name}.png`;
      await capture(
        chromeBin,
        `${url}/webapp/#${hash}`,
        join(OUT_DIR, outName),
      );
      console.log(`Captured ${outName}`);
    }
  }
} finally {
  await close();
}

#!/usr/bin/env node
/**
 * Render diagrams/*.mmd to <name>-light.svg and <name>-dark.svg.
 *
 * Where the files go:
 *   - locally (default): .preview/, which is git-ignored, plus .preview/index.html to view them.
 *   - --publish: assets/, the folder the README uses. Only allowed on GitHub Actions, so the
 *     committed images are always produced by CI and never by a local run.
 *
 * Every .mmd file in diagrams/ is rendered with mermaid-cli once per colour theme, for use as
 * <picture> sources keyed on prefers-color-scheme. Diagrams that carry animation comments are
 * post-processed into a looping, sequenced animation: each scenario lights up its path step by step
 * (nodes, subgraphs and edges stay highlighted until the scenario ends) while a title names it.
 *
 * Animation comments live inside the .mmd (Mermaid ignores %% lines):
 *
 *     %% @timing step=0.9 hold=2.2 gap=0.8 fade=0.2 delay=1.5      (optional, seconds)
 *     %% @scenario Title shown above the diagram
 *     %%   node USER                       highlight a node
 *     %%   edge USER -> SERVICE            highlight a link (Mermaid id L_USER_SERVICE_0)
 *     %%   edge USER -> SERVICE #1         ...the second link between the same pair
 *     %%   cluster SMSMMS                  highlight a subgraph
 *     %%   node SESSION | Line 1 | Line 2  also swap the node's label text while lit
 *     %%   edge SESSION -> END ended       "ended" uses the red palette instead of amber
 *     %%   node SESSION reset               roll back: return the element to its resting colours
 *                                         (and drop any swapped label). Nothing stays lit past the
 *                                         end of its scenario anyway; reset is for rolling back
 *                                         mid-scenario. Re-light it later with a plain step.
 *     %%   group                           steps up to "endgroup" share ONE step slot and change
 *     %%     node A ended                  instantly (no fade) at the same moment, so a branch and
 *     %%     edge A -> B ended             its end node switch together. Any style (active, ended,
 *     %%     node B ended                  reset) can be used inside a group.
 *     %%   endgroup
 *     %%   delay [seconds]                 pause before the next step, e.g. to let an ended group
 *                                         show before it is reset. Plain "delay" uses @timing delay.
 *     %% @arrow-start SERVICE -> WEBEX     arrowhead on the first node's end of a link. Mermaid can
 *                                         only draw that together with an arrowhead on the other
 *                                         end (<-->), so draw the link as --- and add the head here.
 *
 * An existing image is only overwritten when the newly rendered SVG differs from it, so edits that
 * do not change the output (comments, whitespace, reordered declarations) leave assets/ untouched.
 *
 * Setup (once, and in CI): npm ci
 * The Mermaid CLI is installed from package-lock.json so every machine renders with the same
 * Mermaid version and the same bundled font (Recursive Variable, SIL OFL 1.1, embedded in each SVG).
 *
 * Usage: npm run diagrams            (local preview)
 *        npm run diagrams:publish    (CI only)
 * Set PUPPETEER_EXECUTABLE_PATH to use an existing Chrome instead of a downloaded one.
 * When CI is set (as on GitHub Actions) Chrome is launched with --no-sandbox.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIAGRAMS = path.join(ROOT, "diagrams");
const PUBLISH_DIR = path.join(ROOT, "assets");
const PREVIEW_DIR = path.join(ROOT, ".preview");

// seconds; see @timing
// step: between consecutive steps | hold: finished path stays lit | gap: rest between scenarios
// fade: colour change duration | delay: default length of a bare "delay" step
const TIMING = { step: 0.9, hold: 2.2, gap: 0.8, fade: 0.2, delay: 1.5 };

const ACTIVE = "active";
const ENDED = "ended";
const RESET = "reset"; // back to the resting colours; not a palette entry
const INSTANT = 0.01; // seconds; fade used for grouped changes (0 would break the keyframe order)

// handDrawnSeed makes the neo look's slightly jittered shapes identical on every render.
// htmlLabels=false draws labels as SVG text instead of HTML in <foreignObject>. HTML labels are
// sized with the render machine's font, so when the viewer's font differs the text is clipped or
// drifts off its arrow; SVG text is positioned from the centre and stays put.
// Both themes use Mermaid's bundled "Recursive Variable" font (the light theme's default). The dark
// theme defaults to Trebuchet, which was measured with a fallback font and put edge labels off-centre.
// Viewers without the font fall back to Arial; that is fine because SVG text is centre-anchored.
const FONT = {
  fontFamily: '"Recursive Variable", arial, sans-serif',
  fontSize: "14px",
};
const MERMAID_COMMON = {
  handDrawnSeed: 1,
  flowchart: { htmlLabels: false },
  themeVariables: FONT,
};

// Per-theme settings. "base" colours are read from the rendered SVG, only highlights are set here.
const THEMES = {
  light: {
    mermaid: { ...MERMAID_COMMON },
    text: "#28253D",
    node: {
      [ACTIVE]: { fill: "#FFE082", stroke: "#E65100" },
      [ENDED]: { fill: "#EF9A9A", stroke: "#C62828" },
    },
    edge: {
      [ACTIVE]: { stroke: "#E65100", "stroke-width": "4px" },
      [ENDED]: { stroke: "#C62828", "stroke-width": "4px" },
    },
  },
  dark: {
    mermaid: { ...MERMAID_COMMON, theme: "dark", look: "neo" },
    text: "#E6EDF3",
    node: {
      [ACTIVE]: { fill: "#7A5A00", stroke: "#FFB74D" },
      [ENDED]: { fill: "#7F1D1D", stroke: "#FF6B6B" },
    },
    edge: {
      [ACTIVE]: { stroke: "#FFB74D", "stroke-width": "4px" },
      [ENDED]: { stroke: "#FF6B6B", "stroke-width": "4px" },
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Small helpers

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace the first occurrence only, treating the replacement literally (no `$&` patterns). */
const replaceFirst = (s, search, replacement) => {
  const i = s.indexOf(search);
  return i < 0 ? s : s.slice(0, i) + replacement + s.slice(i + search.length);
};

const escapeXml = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

/** Short decimal text without float noise (2.0999999999999996 -> 2.1). */
const num = (n, digits = 4) => String(Number(n.toFixed(digits)));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------------------------
// Parsing the animation comments

/** Edge ids named by '%% @arrow-start A -> B [#n]' comments. */
function parseArrowStarts(source) {
  const ids = [];
  const re = /^\s*%%\s*@arrow-start\s+(\w+)\s*->\s*(\w+)(?:\s*#(\d+))?\s*$/gm;
  for (const m of source.matchAll(re)) ids.push(`${m[1]}_${m[2]}_${m[3] ?? 0}`);
  return ids;
}

/** Returns { timing, scenarios } parsed from the %% comments of a .mmd file. */
function parseAnimation(source) {
  const timing = { ...TIMING };
  const scenarios = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("%%")) continue;
    const body = line.slice(2).trim();
    if (body.startsWith("@timing")) {
      for (const pair of body.split(/\s+/).slice(1)) {
        const [key, value] = pair.split("=");
        assert(key in timing, `unknown @timing key '${key}'`);
        timing[key] = Number(value);
      }
    } else if (body.startsWith("@scenario")) {
      scenarios.push({
        title: body.slice("@scenario".length).trim(),
        steps: [],
        open: false, // inside a group block
        groups: 0, // groups opened so far; the current one's number while open
      });
    } else if (body === "group" || body === "endgroup") {
      assert(scenarios.length > 0, `'${body}' before any @scenario`);
      const sc = scenarios[scenarios.length - 1];
      assert(
        (body === "group") !== sc.open,
        body === "group"
          ? `nested 'group' in scenario '${sc.title}'`
          : `'endgroup' without 'group' in scenario '${sc.title}'`,
      );
      sc.open = body === "group";
      if (sc.open) sc.groups += 1;
    } else if (/^delay(\s|$)/.test(body)) {
      assert(scenarios.length > 0, `'delay' before any @scenario`);
      const sc = scenarios[scenarios.length - 1];
      assert(!sc.open, `'delay' inside a group in scenario '${sc.title}'`);
      const arg = body.slice("delay".length).trim().replace(/s$/, "");
      const seconds = arg === "" ? null : Number(arg);
      assert(
        seconds === null || (Number.isFinite(seconds) && seconds >= 0),
        `bad delay '${raw.trim()}'`,
      );
      sc.steps.push({ kind: "delay", seconds });
    } else {
      const m = body.match(/^(node|edge|cluster)\s+(.+)$/);
      if (!m) continue;
      assert(scenarios.length > 0, `step before any @scenario: '${raw}'`);
      const kind = m[1];
      const [first, ...labels] = m[2].split("|").map((part) => part.trim());
      let target = first;
      let style = ACTIVE;
      const words = target.split(/\s+/);
      if ([ACTIVE, ENDED, RESET].includes(words[words.length - 1])) {
        style = words.pop();
        target = words.join(" ");
      }
      if (kind === "edge") {
        const e = target.match(/^(\w+)\s*->\s*(\w+)(?:\s*#(\d+))?$/);
        if (e) target = `${e[1]}_${e[2]}_${e[3] ?? 0}`;
      }
      assert(
        !(style === RESET && labels.length),
        `a reset step cannot carry label text: '${raw}'`,
      );
      const sc = scenarios[scenarios.length - 1];
      sc.steps.push({
        kind,
        target,
        style,
        labels,
        group: sc.open ? sc.groups : 0,
      });
    }
  }
  for (const sc of scenarios)
    assert(!sc.open, `'group' never closed in scenario '${sc.title}'`);
  return { timing, scenarios };
}

/**
 * Lay the scenarios out on one loop.
 * events: "kind:id" -> {kind, ident, events: [{time, style, fade}]} in time order, where style is
 *   a palette name or RESET. Anything still lit when its scenario ends gets a closing RESET.
 * labels: node id -> [{start, end, inFade, outFade, lines}].
 * A step takes one `step` slot; all steps of a group share a single slot and change instantly.
 */
function timeline(timing, scenarios) {
  const events = new Map();
  const labels = new Map();
  const titles = [];
  let t = 0;
  for (const sc of scenarios) {
    let lastGroup = 0;
    const lit = new Map(); // key -> true while the element is not at rest
    const openLabel = new Map(); // node id -> its label entry that has no end yet
    const closeLabel = (ident, end, outFade) => {
      const entry = openLabel.get(ident);
      if (!entry) return;
      entry.end = end;
      entry.outFade = outFade;
      openLabel.delete(ident);
    };
    let cursor = 0; // seconds into the scenario where the next slot starts
    for (const {
      kind,
      target,
      style,
      labels: lines,
      group,
      seconds,
    } of sc.steps) {
      if (kind === "delay") {
        cursor += seconds ?? timing.delay;
        lastGroup = 0;
        continue;
      }
      let start = t + cursor - timing.step;
      if (!group || group !== lastGroup) {
        start = t + cursor;
        cursor += timing.step;
      }
      lastGroup = group;
      const fade = group ? INSTANT : timing.fade;
      const key = `${kind}:${target}`;
      if (!events.has(key))
        events.set(key, { kind, ident: target, events: [] });
      events.get(key).events.push({ time: start, style, fade });
      lit.set(key, style !== RESET);
      if (kind === "node" && (style === RESET || lines.length))
        closeLabel(target, start, fade);
      if (lines.length) {
        if (!labels.has(target)) labels.set(target, []);
        const entry = {
          start,
          end: null,
          inFade: fade,
          outFade: timing.fade,
          lines,
        };
        labels.get(target).push(entry);
        openLabel.set(target, entry);
      }
    }
    const end = t + cursor + timing.hold;
    for (const [key, isLit] of lit)
      if (isLit)
        events
          .get(key)
          .events.push({ time: end, style: RESET, fade: timing.fade });
    for (const ident of [...openLabel.keys()])
      closeLabel(ident, end, timing.fade);
    titles.push({ start: t, end, text: sc.title });
    t = end + timing.gap;
  }
  return { cycle: t, events, labels, titles };
}

// ---------------------------------------------------------------------------------------------
// CSS generation

const css = (props) =>
  Object.entries(props)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

const pct = (seconds, cycle) => `${num((seconds / cycle) * 100, 3)}%`;

/** Colour keyframes that follow an element's events; RESET (or the end of the loop) is `base`. */
function keyframes(name, cycle, base, events, palette) {
  const frames = [`${pct(0, cycle)}{${css(base)}}`];
  let current = base;
  for (const { time, style, fade } of events) {
    const next = style === RESET ? base : palette[style];
    frames.push(
      `${pct(time, cycle)}{${css(current)}}`,
      `${pct(time + fade, cycle)}{${css(next)}}`,
    );
    current = next;
  }
  frames.push(`100%{${css(base)}}`);
  return `@keyframes ${name}{${frames.join("")}}`;
}

/** Opacity keyframes for windows {start, end, inFade, outFade}; overlapping/touching ones merge. */
function opacityKeyframes(name, cycle, windows, visibleInside) {
  const [on, off] = visibleInside ? [1, 0] : [0, 1];
  const merged = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end + last.outFade) {
      last.end = Math.max(last.end, w.end);
      last.outFade = w.outFade;
    } else merged.push({ ...w });
  }
  const frames = [`0%{opacity:${off}}`];
  for (const { start, end, inFade, outFade } of merged) {
    frames.push(
      `${pct(start, cycle)}{opacity:${off}}`,
      `${pct(start + inFade, cycle)}{opacity:${on}}`,
      `${pct(end, cycle)}{opacity:${on}}`,
      `${pct(end + outFade, cycle)}{opacity:${off}}`,
    );
  }
  frames.push(`100%{opacity:${off}}`);
  return `@keyframes ${name}{${frames.join("")}}`;
}

// ---------------------------------------------------------------------------------------------
// Reading the rendered SVG

/** Read the theme's resting colours from the rendered SVG's stylesheet. */
function bases(svg) {
  const node = svg.match(/\.node rect,[^{]*\{fill:([^;]+);stroke:([^;]+);/);
  const stroke = svg.match(/\.flowchart-link\{stroke:([^;]+);/);
  const width = svg.match(/\.edge-thickness-normal\{stroke-width:([^;]+);/);
  return {
    nodeBase: { fill: node[1], stroke: node[2] },
    edgeBase: { stroke: stroke[1], "stroke-width": width[1] },
  };
}

/** Resting background colour of edge labels, read from the stylesheet. */
function labelBase(svg) {
  const m = svg.match(/\.edgeLabel rect\{[^}]*?fill:([^;}]+)/);
  return { fill: m[1], stroke: "transparent", "stroke-width": "0" };
}

/** Resting colour of arrowheads, read from the stylesheet. */
function markerBase(svg) {
  const m = svg.match(/\.marker\{fill:([^;}]+);stroke:([^;}]+)/);
  return { fill: m[1], stroke: m[2] };
}

/** Cluster colours are assigned per subgraph in some looks, so prefer the per-cluster rule. */
function clusterBase(svg, ident) {
  const id = escapeRegExp(ident);
  const color = svg.match(
    new RegExp(`id="[^"]*-${id}"[^>]*data-color-id="(color-\\d+)"`),
  );
  if (color) {
    const m = svg.match(
      new RegExp(
        `data-color-id="${color[1]}"\\]\\.cluster:not\\(\\.swimlane\\) rect\\{stroke:(#\\w+);fill:(#\\w+);`,
      ),
    );
    return { fill: m[2], stroke: m[1] };
  }
  const m = svg.match(/\.cluster rect\{fill:([^;]+);stroke:([^;]+);/);
  return { fill: m[1], stroke: m[2] };
}

const edgePathTag = (svg, ident) =>
  svg.match(new RegExp(`<path[^>]*id="[^"]*-L_${escapeRegExp(ident)}"[^>]*>`));

// ---------------------------------------------------------------------------------------------
// Editing the rendered SVG

/** Put an arrowhead at the start of a link that Mermaid drew with no start marker. */
function addStartArrow(svg, ident) {
  const tag = edgePathTag(svg, ident);
  assert(tag, `edge ${ident} not found in rendered SVG`);
  const marker = svg.match(/id="([^"]*pointStart-margin)"/);
  assert(marker, "no start arrow marker in rendered SVG");
  let newTag = replaceFirst(
    tag[0],
    "<path ",
    `<path marker-start="url(#${marker[1]})" `,
  );
  // Mermaid pulls a path in by 4px where it draws an arrowhead; do the same at the start
  const d = newTag.match(/ d="M([-\d.]+),([-\d.]+)L([-\d.]+),([-\d.]+)/);
  if (d) {
    const [x1, y1, x2, y2] = d.slice(1).map(Number);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length > 8) {
      const nx = x1 + ((x2 - x1) * 4) / length;
      const ny = y1 + ((y2 - y1) * 4) / length;
      const g = (n) => String(Number(n.toPrecision(6)));
      newTag = replaceFirst(
        newTag,
        d[0],
        ` d="M${g(nx)},${g(ny)}L${g(x2)},${g(y2)}`,
      );
    }
  }
  return replaceFirst(svg, tag[0], newTag);
}

/**
 * Give an edge its own copies of its arrowhead markers so they can be coloured independently.
 * Mermaid shares one <marker> between every edge, so animating it would recolour all arrowheads.
 * Returns { svg, ids } where ids are the new markers.
 */
function cloneMarkers(svg, ident) {
  const tag = edgePathTag(svg, ident);
  assert(tag, `edge ${ident} not found in rendered SVG`);
  let newTag = tag[0];
  const ids = [];
  for (const attr of ["marker-start", "marker-end"]) {
    const ref = tag[0].match(new RegExp(`${attr}="url\\(#([^)]+)\\)"`));
    if (!ref) continue;
    const old = ref[1];
    const marker = svg.match(
      new RegExp(`<marker id="${escapeRegExp(old)}"[\\s\\S]*?</marker>`),
    );
    const fresh = `${old}-${ident}`;
    const clone = replaceFirst(marker[0], `id="${old}"`, `id="${fresh}"`);
    svg = replaceFirst(svg, marker[0], marker[0] + clone);
    newTag = replaceFirst(newTag, ref[0], `${attr}="url(#${fresh})"`);
    ids.push(fresh);
  }
  return { svg: replaceFirst(svg, tag[0], newTag), ids };
}

/** Mermaid draws edge label backgrounds at 50% opacity, which lets the line show through the text. */
function opaqueLabels(svg) {
  assert(svg.includes("</style>"), "no <style> block found in rendered SVG");
  return replaceFirst(
    svg,
    "</style>",
    "#my-svg .edgeLabel rect{opacity:1;}</style>",
  );
}

/**
 * Append makeFragment(cx, cy) as the last child of a node's <g> so it paints above the shape.
 * (cx, cy) is the centre of the node's own label, so replacement text lines up with it.
 */
function appendToNode(svg, ident, makeFragment) {
  const start = svg.match(
    new RegExp(
      `<g class="node[^"]*" id="[^"]*-flowchart-${escapeRegExp(ident)}-\\d+"`,
    ),
  );
  assert(start, `node ${ident} not found in rendered SVG`);
  const pos = start.index;
  const tags = /<g[\s>]|<\/g>/g;
  tags.lastIndex = pos;
  let depth = 0;
  for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) {
    depth += tag[0].startsWith("<g") ? 1 : -1;
    if (depth === 0) {
      const end = tag.index;
      const label = svg
        .slice(pos, end)
        .match(
          /<g class="label"[^>]*transform="translate\(([-\d.]+), ([-\d.]+)\)"[^>]*>\s*(?:<rect\/>)?<foreignObject width="([\d.]+)" height="([\d.]+)"/,
        );
      let cx = 0;
      let cy = 0;
      if (label) {
        const [x, y, w, h] = label.slice(1).map(Number);
        cx = x + w / 2;
        cy = y + h / 2;
      }
      return svg.slice(0, end) + makeFragment(cx, cy) + svg.slice(end);
    }
  }
  throw new Error(`unbalanced <g> for node ${ident}`);
}

// ---------------------------------------------------------------------------------------------
// Rendering

function render(src, theme) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mermaid-svg-"));
  try {
    const raw = path.join(tmp, "raw.svg");
    const conf = path.join(tmp, "mermaid.json");
    fs.writeFileSync(conf, JSON.stringify(theme.mermaid));
    const args = [
      MMDC_ENTRY,
      "-i",
      src,
      "-o",
      raw,
      "-c",
      conf,
      "-b",
      "transparent",
    ];

    const puppeteer = {};
    if (process.env.PUPPETEER_EXECUTABLE_PATH)
      puppeteer.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (process.env.CI) puppeteer.args = ["--no-sandbox"]; // hosted runners block Chrome's user-namespace sandbox
    if (Object.keys(puppeteer).length) {
      const cfg = path.join(tmp, "puppeteer.json");
      fs.writeFileSync(cfg, JSON.stringify(puppeteer));
      args.push("-p", cfg);
    }

    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    if (result.status !== 0) {
      // Mermaid's own message names the line; the JavaScript stack trace after it is just noise
      const message = (
        result.stderr ||
        result.stdout ||
        String(result.error ?? "")
      )
        .split("\n")
        .filter((l) => l.trim() && !/^\s*(at |Parser\.|Object\.)/.test(l));
      throw new Error(
        `Mermaid could not render ${path.basename(src)}:\n  ${message.slice(0, 8).join("\n  ")}`,
      );
    }
    return fs.readFileSync(raw, "utf8");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Inject the sequenced highlight animation described by the scenarios. */
function animate(svgIn, theme, timing, scenarios) {
  let svg = svgIn;
  const { nodeBase, edgeBase } = bases(svg);
  const labelBg = labelBase(svg);
  const arrowBase = markerBase(svg);
  const { cycle, events, labels, titles } = timeline(timing, scenarios);
  const run = `${cycle}s linear infinite`;
  const rules = [];
  const reduced = [];

  for (const { kind, ident, events: evs } of events.values()) {
    const name = `hl-${kind}-${ident.toLowerCase()}`;
    let sel;
    if (kind === "edge") {
      rules.push(keyframes(name, cycle, edgeBase, evs, theme.edge));
      sel = `path[id$="-L_${ident}"]`;

      // The label's background follows the line's colour so the change is visible under long text
      const labelPalette = {};
      const arrowPalette = {};
      for (const style of Object.keys(theme.edge)) {
        labelPalette[style] = {
          fill: theme.node[style].fill,
          stroke: theme.edge[style].stroke,
          "stroke-width": "2px",
        };
        arrowPalette[style] = {
          fill: theme.edge[style].stroke,
          stroke: theme.edge[style].stroke,
        };
      }
      rules.push(keyframes(`${name}-label`, cycle, labelBg, evs, labelPalette));
      const labelSel = `[data-id="L_${ident}"] rect.background`;
      rules.push(`${labelSel}{animation:${name}-label ${run};}`);
      reduced.push(labelSel);

      // Arrowheads (and circle / cross ends) follow the line colour too
      const cloned = cloneMarkers(svg, ident);
      svg = cloned.svg;
      rules.push(
        keyframes(`${name}-arrow`, cycle, arrowBase, evs, arrowPalette),
      );
      for (const markerId of cloned.ids) {
        const markerSel = `marker[id="${markerId}"] > *`;
        rules.push(`${markerSel}{animation:${name}-arrow ${run};}`);
        reduced.push(markerSel);
      }
    } else if (kind === "cluster") {
      rules.push(
        keyframes(name, cycle, clusterBase(svg, ident), evs, theme.node),
      );
      sel = `[id$="-${ident}"].cluster > rect`;
    } else {
      rules.push(keyframes(name, cycle, nodeBase, evs, theme.node));
      sel = `[id*="-flowchart-${ident}-"] .label-container, [id*="-flowchart-${ident}-"] .label-container > *`;
    }
    rules.push(`${sel}{animation:${name} ${run};}`);
    reduced.push(sel);
  }

  // Node labels that change text while lit: hide the original, fade replacement lines in
  for (const [ident, entries] of labels) {
    const key = ident.toLowerCase();
    rules.push(opacityKeyframes(`label-${key}`, cycle, entries, false));
    rules.push(
      `[id*="-flowchart-${ident}-"] > .label{animation:label-${key} ${run};}`,
    );
    reduced.push(`[id*="-flowchart-${ident}-"] > .label`);

    svg = appendToNode(svg, ident, (cx, cy) =>
      entries
        .map((entry, i) => {
          const { lines } = entry;
          rules.push(
            opacityKeyframes(`text-${key}-${i}`, cycle, [entry], true),
          );
          rules.push(
            `.text-${key}-${i}{opacity:0;animation:text-${key}-${i} ${run};}`,
          );
          const first = -(lines.length - 1) * 0.7; // em; lines are 1.4em apart, block centred on cy
          const spans = lines
            .map(
              (text, n) =>
                `<tspan x="${num(cx)}" dy="${num(n === 0 ? first : 1.4, 2)}em">${escapeXml(text)}</tspan>`,
            )
            .join("");
          return (
            `<text class="node-text text-${key}-${i}" y="${num(cy)}" text-anchor="middle" ` +
            `dominant-baseline="central" fill="${theme.text}" font-size="14">${spans}</text>`
          );
        })
        .join(""),
    );
  }

  // Titles: widen the viewBox upwards to make room
  const vb = svg.match(/viewBox="([\d.-]+) ([\d.-]+) ([\d.]+) ([\d.]+)"/);
  const [x, y, w, h] = vb.slice(1).map(Number);
  const pad = 44;
  svg = replaceFirst(
    svg,
    vb[0],
    `viewBox="${num(x)} ${num(y - pad)} ${num(w)} ${num(h + pad)}"`,
  );
  const titleEls = titles.map(({ start, end, text }, i) => {
    rules.push(
      opacityKeyframes(
        `title-${i}`,
        cycle,
        [{ start, end, inFade: timing.fade, outFade: timing.fade }],
        true,
      ),
    );
    rules.push(`.title-${i}{opacity:0;animation:title-${i} ${run};}`);
    return (
      `<text class="title title-${i}" x="${num(x + w / 2)}" y="${num(y - pad + 30)}" text-anchor="middle" ` +
      `fill="${theme.text}" font-size="20" font-weight="600">${escapeXml(text)}</text>`
    );
  });
  svg = replaceFirst(svg, "</svg>", `${titleEls.join("")}</svg>`);

  rules.push(
    `@media (prefers-reduced-motion:reduce){${[...reduced, ".node-text", ".title"].join(",")}{animation:none!important}` +
      `.node-text,.title{display:none}}`,
  );
  assert(svg.includes("</style>"), "no <style> block found in rendered SVG");
  svg = replaceFirst(svg, "</style>", `${rules.join("")}</style>`);
  return { svg, cycle };
}

function build(src, variant, theme, outDir) {
  const source = fs.readFileSync(src, "utf8");
  let svg = opaqueLabels(render(src, theme));
  for (const ident of parseArrowStarts(source)) svg = addStartArrow(svg, ident);
  const { timing, scenarios } = parseAnimation(source);
  let note = "static";
  if (scenarios.length) {
    const animated = animate(svg, theme, timing, scenarios);
    svg = animated.svg;
    note = `animated, cycle ${animated.cycle.toFixed(1)}s`;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${path.basename(src, ".mmd")}-${variant}.svg`);
  const name = path.relative(ROOT, out);
  if (fs.existsSync(out) && fs.readFileSync(out, "utf8") === svg) {
    console.log(`unchanged ${name} (${note})`);
    return;
  }
  fs.writeFileSync(out, svg);
  console.log(`wrote ${name} (${note})`);
}

/** A page that shows each diagram like the README does, so animations can be viewed locally. */
function writePreviewPage(outDir, stems) {
  const sections = stems
    .map(
      (stem) =>
        `<h2>${stem}</h2><picture>` +
        `<source media="(prefers-color-scheme: dark)" srcset="${stem}-dark.svg">` +
        `<img alt="${stem}" src="${stem}-light.svg" style="max-width:100%"></picture>`,
    )
    .join("");
  fs.writeFileSync(
    path.join(outDir, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>Diagram preview</title>' +
      "<style>:root{color-scheme:light dark}body{font-family:sans-serif;margin:2rem}</style>" +
      `<h1>Diagram preview (local, not committed)</h1>${sections}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Entry point

/** The mermaid-cli entry script, resolved from its package.json so this works on any platform. */
function findMermaidCli() {
  const pkgPath = path.join(
    ROOT,
    "node_modules",
    "@mermaid-js",
    "mermaid-cli",
    "package.json",
  );
  if (!fs.existsSync(pkgPath)) return null;
  const { bin } = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return path.join(
    path.dirname(pkgPath),
    typeof bin === "string" ? bin : bin.mmdc,
  );
}

const MMDC_ENTRY = findMermaidCli();

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--publish");
  if (unknown.length)
    fail(
      `unknown argument ${unknown.join(" ")}\nusage: npm run diagrams | npm run diagrams:publish`,
    );
  const publish = args.includes("--publish");

  if (publish && !process.env.GITHUB_ACTIONS) {
    fail(
      "--publish is only allowed on GitHub Actions; assets/ is generated by CI.\n" +
        "Run `npm run diagrams` to preview locally in .preview/",
    );
  }
  if (!MMDC_ENTRY) fail("mermaid-cli is not installed; run: npm ci");

  const outDir = publish ? PUBLISH_DIR : PREVIEW_DIR;
  const sources = fs
    .readdirSync(DIAGRAMS)
    .filter((f) => f.endsWith(".mmd"))
    .sort()
    .map((f) => path.join(DIAGRAMS, f));
  if (!sources.length) fail(`no .mmd files in ${DIAGRAMS}`);

  for (const src of sources) {
    for (const [variant, theme] of Object.entries(THEMES))
      build(src, variant, theme, outDir);
  }
  if (!publish) {
    writePreviewPage(
      outDir,
      sources.map((s) => path.basename(s, ".mmd")),
    );
    console.log(
      `open ${path.relative(ROOT, path.join(outDir, "index.html"))} to view the animations`,
    );
  }
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

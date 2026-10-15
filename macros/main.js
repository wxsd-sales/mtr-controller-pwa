import xapi from "xapi";

/*
 * MTR Controller PWA macro.
 *
 * Keeps a second Room Navigator, running the web app as a persistent web app
 * (PWA), connected to this device. The macro:
 *   - enables WebEngine and device-certificate support,
 *   - creates a local Integrator account for the web app to log in with,
 *   - watches the device's IPv4 / IPv6 address, and
 *   - writes { username, password, address } as a base64 encoded JSON hash on
 *     the end of the PWA URL (Config UserInterface HomeScreen Peripherals
 *     WebApp URL), re-checking it on start and whenever the address changes.
 *
 * Optionally also adds a home-screen button that opens the web app in a
 * WebView (HAS_BUTTON). Paste this file into the device Macro Editor, or
 * deploy it with your preferred tooling.
 *
 * The values between the CONFIG markers are managed by `npm run apply-config`
 * (driven by project.config.json) - do not edit them by hand. MACRO_NAME is
 * the project's identity (used for the panel id and log lines); BUTTON_NAME
 * is the human-facing label shown on the device.
 */

// CONFIG:start
const MACRO_NAME = "mtr-controller-pwa";
const WEBAPP_URL = "https://wxsd-sales.github.io/mtr-controller-pwa/webapp/";
const HAS_BUTTON = true;
const DEFAULT_MODE = "Auto";
const SHOW_CALENDAR = false;
const BUTTON_NAME = "MTR Controller PWA";
// CONFIG:end

const PANEL_ID = `${MACRO_NAME}`;
const ACCOUNT_USERNAME = "pwa-controller";
const ACCOUNT_ROLES = ["Integrator", "User"];
const SYNC_DEBOUNCE_MS = 1000;
const MODE_OPTIONS = ["Auto", "RoomOS Only", "MTR Only"];
const SELECT_WIDGET_ID = `${PANEL_ID}-select`;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Minimal ASCII base64, as btoa/atob are not guaranteed in the macro runtime.
function base64Encode(input) {
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b || 0) >> 4)];
    out += Number.isNaN(b) ? "=" : B64[((b & 15) << 2) | ((c || 0) >> 6)];
    out += Number.isNaN(c) ? "=" : B64[c & 63];
  }
  return out;
}

function base64Decode(input) {
  const clean = input.replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  let out = "";
  for (const ch of clean) {
    const index = B64.indexOf(ch);
    if (index < 0) throw new Error("invalid base64");
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 255);
    }
  }
  return out;
}

function generatePassword() {
  const sets = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
  ];
  const all = sets.join("");
  const pick = (chars) => chars[Math.floor(Math.random() * chars.length)];
  // One of each class guarantees the device's complexity rules are met.
  const chars = sets.map(pick);
  while (chars.length < 24) chars.push(pick(all));
  return chars.sort(() => Math.random() - 0.5).join("");
}

// The RoomOS WebEngine can get stuck on the old page when only the #hash of the
// URL changes. A changing search parameter makes it reload, so every URL we
// write carries "?timestamp=<epoch ms>" ahead of the hash. The web app ignores it.
function buildUrl(details, timestamp = Date.now()) {
  return `${WEBAPP_URL}?timestamp=${timestamp}#${base64Encode(JSON.stringify(details))}`;
}

// Returns { base, timestamp, details } from a configured PWA URL. base has no
// search or hash; timestamp is the epoch string from the search parameter ("" if
// absent); details is null when the hash is missing or malformed.
function parseUrl(url) {
  const text = String(url ?? "");
  const hashAt = text.indexOf("#");
  const beforeHash = hashAt < 0 ? text : text.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : text.slice(hashAt + 1);
  const [base, search = ""] = beforeHash.split("?");
  const timestamp = search.match(/(?:^|&)timestamp=([^&]*)/)?.[1] ?? "";
  let details = null;
  try {
    const parsed = JSON.parse(base64Decode(hash));
    if (parsed && typeof parsed === "object") details = parsed;
  } catch {
    // Missing or malformed hash - treated as out of date.
  }
  return { base, timestamp, details };
}

async function readStatus(read) {
  try {
    const value = await read();
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

// Prefers IPv4, falls back to IPv6; empty string when neither is present.
async function getAddress() {
  const ipv4 = await readStatus(() =>
    xapi.Status.Network[1].IPv4.Address.get(),
  );
  if (ipv4) return ipv4;
  return readStatus(() => xapi.Status.Network[1].IPv6.Address.get());
}

// Returns true if device in MTR mode. The command rejects with
// {"code":1,"message":"No platforms found"} when no MTR container is installed.
async function getMTRStatus() {
  try {
    await xapi.Command.MicrosoftTeams.List({ Show: "Installed" });
    return true;
  } catch {
    return false;
  }
}

// The button's current value, or undefined when it has none (or no panel exists yet).
async function readWidgetValue() {
  try {
    const widgets = await xapi.Status.UserInterface.Extensions.Widget.get();
    const list = Array.isArray(widgets) ? widgets : widgets ? [widgets] : [];
    return list.find(({ WidgetId }) => WidgetId === SELECT_WIDGET_ID)?.Value;
  } catch {
    return undefined;
  }
}

// The mode the web app should use: the button's selection when there is a
// button, otherwise (or if the button has no valid value yet) DEFAULT_MODE.
async function getSelectedMode() {
  if (!HAS_BUTTON) return DEFAULT_MODE;
  const value = await readWidgetValue();
  return MODE_OPTIONS.includes(value) ? value : DEFAULT_MODE;
}

async function enableWebEngine() {
  const settings = [
    [xapi.Config.WebEngine.Mode, "On"],
    [xapi.Config.WebEngine.Features.AllowDeviceCertificate, "True"],
  ];
  for (const [setting, wanted] of settings) {
    try {
      if ((await setting.get()) !== wanted) await setting.set(wanted);
    } catch (error) {
      console.error(`${MACRO_NAME}: failed to configure WebEngine`, error);
    }
  }
}

async function accountExists() {
  try {
    await xapi.Command.UserManagement.User.Get({ Username: ACCOUNT_USERNAME });
    return true;
  } catch {
    return false;
  }
}

// The roles the account currently has, or null when the device does not say.
// User Get reports them as Roles (array); accept a single value or Role too.
async function getAccountRoles() {
  try {
    const result = await xapi.Command.UserManagement.User.Get({
      Username: ACCOUNT_USERNAME,
    });
    const raw = result?.Roles ?? result?.Role;
    if (raw === undefined || raw === null) return null;
    return [raw].flat().map((role) => String(role?.Role ?? role));
  } catch {
    return null;
  }
}

// Adds any missing and removes any extra roles so the account has exactly
// ACCOUNT_ROLES. Returns true when it had to change them.
async function ensureAccountRoles() {
  const current = await getAccountRoles();
  if (!current) {
    console.warn(`${MACRO_NAME}: could not read roles for ${ACCOUNT_USERNAME}`);
    return false;
  }
  const missing = ACCOUNT_ROLES.filter((role) => !current.includes(role));
  const extra = current.filter((role) => !ACCOUNT_ROLES.includes(role));
  if (!missing.length && !extra.length) return false;

  const change = { Username: ACCOUNT_USERNAME };
  if (missing.length) change.AddRole = missing;
  if (extra.length) change.RemoveRole = extra;
  await xapi.Command.UserManagement.User.Modify(change);
  console.log(
    `${MACRO_NAME}: updated roles for ${ACCOUNT_USERNAME} (added ${missing.join(", ") || "none"}, removed ${extra.join(", ") || "none"})`,
  );
  return true;
}

// The password is only ever known from the configured URL, so the account is
// kept when the URL still carries a password for it, and recreated otherwise.
// Returns { password, rolesChanged }; a kept account has its roles corrected.
async function ensureAccount(current) {
  const password = current?.username === ACCOUNT_USERNAME && current.password;
  if (password && (await accountExists())) {
    return { password, rolesChanged: await ensureAccountRoles() };
  }

  if (await accountExists()) {
    await xapi.Command.UserManagement.User.Delete({
      Username: ACCOUNT_USERNAME,
    });
  }
  const fresh = generatePassword();
  await xapi.Command.UserManagement.User.Add({
    Username: ACCOUNT_USERNAME,
    Passphrase: fresh,
    PassphraseChangeRequired: "False",
    Role: ACCOUNT_ROLES,
    ShellLogin: "False",
  });
  console.log(`${MACRO_NAME}: created local account ${ACCOUNT_USERNAME}`);
  return { password: fresh, rolesChanged: false };
}

// Brings the configured PWA URL in line with the account and address.
// selectedMode is passed by the widget handler, which already knows the new value.
async function syncUrl(selectedMode) {
  const address = await getAddress();
  if (!address) {
    console.warn(`${MACRO_NAME}: no IP address yet, URL not updated`);
    return;
  }

  const configured =
    await xapi.Config.UserInterface.HomeScreen.Peripherals.WebApp.URL.get().catch(
      () => "",
    );
  const { base, details } = parseUrl(configured);

  const mtrDevice = await getMTRStatus();
  const mode = MODE_OPTIONS.includes(selectedMode)
    ? selectedMode
    : await getSelectedMode();

  const { password, rolesChanged } = await ensureAccount(details);
  const wanted = {
    username: ACCOUNT_USERNAME,
    password,
    address,
    mtrDevice,
    mode,
    calendar: SHOW_CALENDAR,
  };
  const upToDate =
    base === WEBAPP_URL &&
    details?.username === wanted.username &&
    details?.password === wanted.password &&
    details?.address === wanted.address &&
    details?.mtrDevice === wanted.mtrDevice &&
    details?.mode === wanted.mode &&
    details?.calendar === wanted.calendar;
  // New roles only apply to a fresh login, so a role change forces a rewrite
  // (with a new timestamp) to make the web app reload and reconnect.
  if (upToDate && !rolesChanged) return;

  await xapi.Config.UserInterface.HomeScreen.Peripherals.WebApp.URL.set(
    buildUrl(wanted),
  );
  console.log(
    `${MACRO_NAME}: updated PWA URL (address ${address}, mtr ${mtrDevice}, mode ${mode})`,
  );
}

// Serialises and debounces syncs triggered by address / URL changes.
let syncTimer;
let syncChain = Promise.resolve();
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncChain = syncChain
      .then(syncUrl)
      .catch((error) => console.error(`${MACRO_NAME}: sync failed`, error));
  }, SYNC_DEBOUNCE_MS);
}

async function onWidgetEvent({ Type, Value, WidgetId }) {
  if (WidgetId !== SELECT_WIDGET_ID) return;
  if (Type !== "released") return;

  try {
    await syncUrl(Value);
  } catch (error) {
    console.error(
      `${MACRO_NAME}: user mode change triggered sync failed`,
      error,
    );
  }
}

// Makes the button show a valid selection, setting DEFAULT_MODE if it has none.
async function syncWidgetUI() {
  if (MODE_OPTIONS.includes(await readWidgetValue())) return;
  await xapi.Command.UserInterface.Extensions.Widget.SetValue({
    Value: DEFAULT_MODE,
    WidgetId: SELECT_WIDGET_ID,
  });
}

async function createPanel() {
  const order = await panelOrder(PANEL_ID);

  const name = replaceSpecialCharacters(BUTTON_NAME);

  const options = MODE_OPTIONS.map(
    (option) => `<Value><Key>${option}</Key><Name>${option}</Name></Value>`,
  );

  const panel = `
    <Extensions>
      <Panel>
        ${order}
        <Location>ControlPanel</Location>
        <Name>${name}</Name>
        <ActivityType>Custom</ActivityType>
        <Page>
          <Name>${name}</Name>
          <Row>
            <Widget>
              <WidgetId>${PANEL_ID}-text</WidgetId>
              <Name>Tap Option Below To Change Modes</Name>
              <Type>Text</Type>
              <Options>size=4;fontSize=normal;align=center</Options>
            </Widget>
          </Row>
          <Row>
            <Widget>
              <WidgetId>${SELECT_WIDGET_ID}</WidgetId>
              <Type>GroupButton</Type>
              <Options>size=4</Options>
              <ValueSpace>
                ${options}
              </ValueSpace>
            </Widget>
          </Row>
          <Options>hideRowNames=1</Options>
        </Page>
      </Panel>
    </Extensions>`;

  try {
    return xapi.Command.UserInterface.Extensions.Panel.Save(
      { PanelId: PANEL_ID },
      panel,
    );
  } catch (error) {
    console.error(`${MACRO_NAME}: failed to save UI panel`, error);
  }
}

function replaceSpecialCharacters(text = "") {
  return String(text)
    .replaceAll(/&/g, "&amp;")
    .replaceAll(/</g, "&lt;")
    .replaceAll(/>/g, "&gt;");
  //.replaceAll(/"/g, "&quot;")
  //.replaceAll(/'/g, "&apos;");
}

/*********************************************************
 * Gets the current Panel Order if exiting Macro panel is present
 * to preserve the order in relation to other custom UI Extensions
 **********************************************************/
async function panelOrder(panelId) {
  const list = await xapi.Command.UserInterface.Extensions.List({
    ActivityType: "Custom",
  });
  const panel = list?.Extensions?.Panel;
  if (!panel) return "";
  const panels = Array.isArray(panel) ? panel : [panel];
  const existingPanel = panels.find((item) => item.PanelId == panelId);
  if (!existingPanel) return "";
  return `<Order>${existingPanel.Order}</Order>`;
}

async function init() {
  if (HAS_BUTTON) {
    try {
      await createPanel();
    } catch (error) {
      console.error(`${MACRO_NAME}: failed to save UI panel`, error);
    }

    try {
      await syncWidgetUI();
    } catch (error) {
      console.error(`${MACRO_NAME}: failed to sync widget UI`, error);
    }
    xapi.Event.UserInterface.Extensions.Widget.Action.on(onWidgetEvent);
  }

  await enableWebEngine();
  try {
    await syncUrl();
  } catch (error) {
    console.error(`${MACRO_NAME}: initial sync failed`, error);
  }

  xapi.Status.Network[1].IPv4.Address.on(scheduleSync);
  xapi.Status.Network[1].IPv6.Address.on(scheduleSync);
  xapi.Config.UserInterface.HomeScreen.Peripherals.WebApp.URL.on(scheduleSync);

  console.log(`${MACRO_NAME}: started`);
}

init();

export {
  PANEL_ID,
  WEBAPP_URL,
  ACCOUNT_USERNAME,
  ACCOUNT_ROLES,
  onWidgetEvent,
  base64Encode,
  base64Decode,
  parseUrl,
  buildUrl,
  syncUrl,
  getMTRStatus,
  getSelectedMode,
  MODE_OPTIONS,
  SELECT_WIDGET_ID,
};

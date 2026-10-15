import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const SOURCE = readFileSync(
  new URL("../../macros/main.js", import.meta.url),
  "utf8",
);
// The mode selector only exists when the project has a button.
const HAS_BUTTON = /const HAS_BUTTON = true;/.test(SOURCE);
const itIfButton = HAS_BUTTON ? it : it.skip;
const itIfNoButton = HAS_BUTTON ? it.skip : it;
const SHOW_CALENDAR = /const SHOW_CALENDAR = true;/.test(SOURCE);
const DEFAULT_MODE = SOURCE.match(/const DEFAULT_MODE = ["'](.+?)["']/)[1];
const SELECT_WIDGET_ID = `${SOURCE.match(/const MACRO_NAME = "(.+?)"/)[1]}-select`;

const NO_MTR_ERROR = { code: 1, message: "No platforms found" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Prepare the mock device, then load the macro (which starts running on import).
 * mtr: whether an MTR container is installed; widgetValue: the mode button's value.
 */
async function startMacro({ mtr = false, widgetValue } = {}) {
  jest.resetModules();
  const { default: xapi } = await import("xapi");
  xapi.reset();
  await xapi.Status.Network[1].IPv4.Address.set("10.0.0.5");
  if (!mtr) {
    xapi.Command.MicrosoftTeams.List.mockRejectedValue(NO_MTR_ERROR);
  }
  if (widgetValue !== undefined) {
    xapi.Status.UserInterface.Extensions.Widget.get.mockResolvedValue([
      { WidgetId: SELECT_WIDGET_ID, Value: widgetValue },
    ]);
  }
  const macro = await import("../../macros/main.js");
  await settle();
  const hash = async () => {
    const { details, timestamp } = macro.parseUrl(
      await xapi.Config.UserInterface.HomeScreen.Peripherals.WebApp.URL.get(),
    );
    return { ...details, timestamp };
  };
  return { xapi, macro, hash };
}

describe("macros/main.js MTR mode detection", () => {
  it("is not an MTR device when no MTR container is installed", async () => {
    const { macro, xapi } = await startMacro({ mtr: false });

    expect(xapi.Command.MicrosoftTeams.List).toHaveBeenCalledWith({
      Show: "Installed",
    });
    expect(await macro.getMTRStatus()).toBe(false);
  });

  it("is an MTR device when the MTR container is installed", async () => {
    const { macro } = await startMacro({ mtr: true });

    expect(await macro.getMTRStatus()).toBe(true);
  });

  it("passes mtrDevice=false in the URL hash when there is no MTR container", async () => {
    const { hash } = await startMacro({ mtr: false });

    expect((await hash()).mtrDevice).toBe(false);
  });

  it("passes mtrDevice=true in the URL hash on an MTR device", async () => {
    const { hash } = await startMacro({ mtr: true });

    expect((await hash()).mtrDevice).toBe(true);
  });
});

describe("macros/main.js mode selector", () => {
  itIfButton(
    "saves a panel with an Auto / RoomOS Only / MTR Only group button",
    async () => {
      const { xapi } = await startMacro();

      const [, xml] =
        xapi.Command.UserInterface.Extensions.Panel.Save.mock.calls[0];
      expect(xml).toContain(`<WidgetId>${SELECT_WIDGET_ID}</WidgetId>`);
      expect(xml).toContain("<Type>GroupButton</Type>");
      for (const option of ["Auto", "RoomOS Only", "MTR Only"]) {
        expect(xml).toContain(`<Key>${option}</Key>`);
      }
    },
  );

  itIfButton(
    "sets the button to DEFAULT_MODE when it has no value",
    async () => {
      const { xapi } = await startMacro();

      expect(
        xapi.Command.UserInterface.Extensions.Widget.SetValue,
      ).toHaveBeenCalledWith({
        Value: DEFAULT_MODE,
        WidgetId: SELECT_WIDGET_ID,
      });
    },
  );

  itIfButton(
    "leaves the button alone when it already has a valid value",
    async () => {
      const { xapi } = await startMacro({ widgetValue: "MTR Only" });

      expect(
        xapi.Command.UserInterface.Extensions.Widget.SetValue,
      ).not.toHaveBeenCalled();
    },
  );

  itIfButton(
    "writes the button's current value into the hash as mode",
    async () => {
      const { hash } = await startMacro({ widgetValue: "MTR Only" });

      expect((await hash()).mode).toBe("MTR Only");
    },
  );

  itIfButton(
    "falls back to DEFAULT_MODE when the button holds an unknown value",
    async () => {
      const { hash } = await startMacro({ widgetValue: "Bogus" });

      expect((await hash()).mode).toBe(DEFAULT_MODE);
    },
  );

  itIfNoButton(
    "uses DEFAULT_MODE in the hash when there is no button",
    async () => {
      const { hash, xapi } = await startMacro();

      expect((await hash()).mode).toBe(DEFAULT_MODE);
      expect(
        xapi.Command.UserInterface.Extensions.Panel.Save,
      ).not.toHaveBeenCalled();
    },
  );

  itIfButton(
    "rewrites the hash when a new mode is tapped, keeping the account",
    async () => {
      const { xapi, hash } = await startMacro({
        mtr: true,
        widgetValue: "Auto",
      });
      const before = await hash();
      expect(before.mode).toBe("Auto");

      xapi.Event.UserInterface.Extensions.Widget.Action.emit({
        WidgetId: SELECT_WIDGET_ID,
        Type: "released",
        Value: "RoomOS Only",
      });
      await settle();

      // The rewrite carries a fresh timestamp; everything else is unchanged.
      const after = await hash();
      expect({ ...after, timestamp: undefined }).toEqual({
        ...before,
        timestamp: undefined,
        mode: "RoomOS Only",
      });
      expect(xapi.Command.UserManagement.User.Add).toHaveBeenCalledTimes(1);
    },
  );

  itIfButton("ignores pressed events and other widgets", async () => {
    const { xapi, hash } = await startMacro({ widgetValue: "Auto" });

    xapi.Event.UserInterface.Extensions.Widget.Action.emit({
      WidgetId: SELECT_WIDGET_ID,
      Type: "pressed",
      Value: "MTR Only",
    });
    xapi.Event.UserInterface.Extensions.Widget.Action.emit({
      WidgetId: "some-other-widget",
      Type: "released",
      Value: "MTR Only",
    });
    await settle();

    expect((await hash()).mode).toBe("Auto");
  });

  itIfButton(
    "ignores a tapped value that is not one of the modes",
    async () => {
      const { xapi, hash } = await startMacro({ widgetValue: "Auto" });

      xapi.Event.UserInterface.Extensions.Widget.Action.emit({
        WidgetId: SELECT_WIDGET_ID,
        Type: "released",
        Value: "Bogus",
      });
      await settle();

      expect((await hash()).mode).toBe("Auto");
    },
  );
});

describe("macros/main.js URL helpers", () => {
  const details = { username: "u", password: "p", address: "10.0.0.5" };

  async function helpers() {
    jest.resetModules();
    const { default: xapi } = await import("xapi");
    xapi.reset();
    return import("../../macros/main.js");
  }

  it("puts a timestamp search parameter before the hash", async () => {
    const { buildUrl, WEBAPP_URL } = await helpers();

    const url = buildUrl(details, 1700000000000);

    expect(url.startsWith(`${WEBAPP_URL}?timestamp=1700000000000#`)).toBe(true);
  });

  it("defaults the timestamp to the current epoch time", async () => {
    const { buildUrl, parseUrl } = await helpers();
    const before = Date.now();

    const { timestamp } = parseUrl(buildUrl(details));

    expect(Number(timestamp)).toBeGreaterThanOrEqual(before);
    expect(Number(timestamp)).toBeLessThanOrEqual(Date.now());
  });

  it("round-trips base, timestamp and details", async () => {
    const { buildUrl, parseUrl, WEBAPP_URL } = await helpers();

    expect(parseUrl(buildUrl(details, 123))).toEqual({
      base: WEBAPP_URL,
      timestamp: "123",
      details,
    });
  });

  it("still parses URLs written before the timestamp existed", async () => {
    const { buildUrl, parseUrl, WEBAPP_URL } = await helpers();
    const legacy = buildUrl(details, 1).replace("?timestamp=1", "");

    expect(parseUrl(legacy)).toEqual({
      base: WEBAPP_URL,
      timestamp: "",
      details,
    });
  });

  it("copes with a missing or malformed hash", async () => {
    const { parseUrl, WEBAPP_URL } = await helpers();

    expect(parseUrl(`${WEBAPP_URL}?timestamp=5`)).toEqual({
      base: WEBAPP_URL,
      timestamp: "5",
      details: null,
    });
    expect(parseUrl(`${WEBAPP_URL}#not-base64!`).details).toBeNull();
    expect(parseUrl(undefined)).toEqual({
      base: "",
      timestamp: "",
      details: null,
    });
  });
});

describe("macros/main.js calendar flag", () => {
  it("passes SHOW_CALENDAR to the web app as the calendar hash parameter", async () => {
    const { hash } = await startMacro();

    expect((await hash()).calendar).toBe(SHOW_CALENDAR);
  });

  it("rewrites a URL written before the calendar flag existed, with a new timestamp", async () => {
    const { xapi, macro, hash } = await startMacro();
    const legacy = await hash();
    delete legacy.calendar;
    delete legacy.timestamp;
    await xapi.Config.UserInterface.HomeScreen.Peripherals.WebApp.URL.set(
      macro.buildUrl(legacy, 1),
    );
    await settle();

    await macro.syncUrl();

    const after = await hash();
    expect(after.calendar).toBe(SHOW_CALENDAR);
    expect(Number(after.timestamp)).toBeGreaterThan(1);
  });
});

describe("macros/main.js account roles", () => {
  const gone = () => new Promise((resolve) => setTimeout(resolve, 5));

  // Starts the macro (which creates the account), then reports the account's
  // roles as rolesFor(ACCOUNT_ROLES) - or as unreadable when that is undefined.
  async function withRoles(rolesFor) {
    const started = await startMacro({ mtr: true, widgetValue: "Auto" });
    const { xapi, macro } = started;
    xapi.Command.UserManagement.User.Modify.mockClear();
    // Behave like a device: Modify changes the roles that Get then reports
    let roles = rolesFor(macro.ACCOUNT_ROLES);
    xapi.Command.UserManagement.User.Get.mockImplementation(async () => ({
      Username: "pwa-controller",
      Roles: roles,
    }));
    xapi.Command.UserManagement.User.Modify.mockImplementation(
      async ({ AddRole = [], RemoveRole = [] }) => {
        roles = [...roles.filter((r) => !RemoveRole.includes(r)), ...AddRole];
        return { status: "OK" };
      },
    );
    return started;
  }

  it("creates the account with the required roles", async () => {
    const { xapi, macro } = await startMacro();

    expect(xapi.Command.UserManagement.User.Add).toHaveBeenCalledWith(
      expect.objectContaining({ Role: macro.ACCOUNT_ROLES }),
    );
  });

  it("leaves the account and URL alone when the roles are already right", async () => {
    const { xapi, macro, hash } = await withRoles((roles) => roles);
    const before = await hash();
    await gone();

    await macro.syncUrl();

    expect(xapi.Command.UserManagement.User.Modify).not.toHaveBeenCalled();
    expect(await hash()).toEqual(before);
  });

  it("adds a missing role and removes an extra one, then reloads the web app", async () => {
    const { xapi, macro, hash } = await withRoles((roles) => [
      "Admin",
      ...roles.slice(1),
    ]);
    const before = await hash();
    await gone();

    await macro.syncUrl();

    expect(xapi.Command.UserManagement.User.Modify).toHaveBeenCalledWith({
      Username: "pwa-controller",
      AddRole: [macro.ACCOUNT_ROLES[0]],
      RemoveRole: ["Admin"],
    });
    const after = await hash();
    expect(after.password).toBe(before.password); // same account, new login
    expect(Number(after.timestamp)).toBeGreaterThan(Number(before.timestamp));
  });

  it("only adds roles when none need removing", async () => {
    const { xapi, macro } = await withRoles((roles) => roles.slice(1));

    await macro.syncUrl();

    expect(xapi.Command.UserManagement.User.Modify).toHaveBeenCalledWith({
      Username: "pwa-controller",
      AddRole: [macro.ACCOUNT_ROLES[0]],
    });
  });

  it("only removes roles when none are missing", async () => {
    const { xapi, macro } = await withRoles((roles) => [...roles, "Audit"]);

    await macro.syncUrl();

    expect(xapi.Command.UserManagement.User.Modify).toHaveBeenCalledWith({
      Username: "pwa-controller",
      RemoveRole: ["Audit"],
    });
  });

  it("does not sync again because of its own URL write, even if the roles never change", async () => {
    const { xapi, macro } = await withRoles((roles) => ["Admin", ...roles]);
    // A device that ignores Modify: Get keeps reporting the wrong roles
    xapi.Command.UserManagement.User.Modify.mockImplementation(async () => ({
      status: "OK",
    }));

    await macro.syncUrl();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(xapi.Command.UserManagement.User.Modify).toHaveBeenCalledTimes(1);
  });

  it("does not touch the account or URL when the roles cannot be read", async () => {
    const { xapi, macro, hash } = await withRoles(() => undefined);
    const before = await hash();
    await gone();

    await macro.syncUrl();

    expect(xapi.Command.UserManagement.User.Modify).not.toHaveBeenCalled();
    expect(await hash()).toEqual(before);
  });
});

describe("macros/main.js PWA sync", () => {
  beforeEach(async () => {
    jest.resetModules();
    const { default: xapi } = await import("xapi");
    xapi.reset();
  });

  async function decodedUrl(xapi) {
    const { parseUrl } = await import("../../macros/main.js");
    return parseUrl(
      await xapi.Config.UserInterface.HomeScreen.Peripherals.WebApp.URL.get(),
    );
  }

  it("enables WebEngine settings", async () => {
    const { default: xapi } = await import("xapi");
    await xapi.Status.Network[1].IPv4.Address.set("10.0.0.5");
    await import("../../macros/main.js");
    await settle();

    expect(await xapi.Config.WebEngine.Mode.get()).toBe("On");
    expect(
      await xapi.Config.WebEngine.Features.AllowDeviceCertificate.get(),
    ).toBe("True");
  });

  it("writes username, password and IPv4 address into the URL hash", async () => {
    const { default: xapi } = await import("xapi");
    await xapi.Status.Network[1].IPv4.Address.set("10.0.0.5");
    const { WEBAPP_URL, ACCOUNT_USERNAME } =
      await import("../../macros/main.js");
    await settle();

    const { base, details } = await decodedUrl(xapi);
    expect(base).toBe(WEBAPP_URL);
    expect(details).toEqual({
      username: ACCOUNT_USERNAME,
      password: expect.any(String),
      address: "10.0.0.5",
      mtrDevice: expect.any(Boolean),
      mode: expect.any(String),
      calendar: expect.any(Boolean),
    });
    expect(xapi.Command.UserManagement.User.Add).toHaveBeenCalledTimes(1);
  });

  it("stamps the URL with the time it was updated", async () => {
    const { default: xapi } = await import("xapi");
    await xapi.Status.Network[1].IPv4.Address.set("10.0.0.5");
    const before = Date.now();
    await import("../../macros/main.js");
    await settle();

    const { timestamp } = await decodedUrl(xapi);
    expect(Number(timestamp)).toBeGreaterThanOrEqual(before);
    expect(Number(timestamp)).toBeLessThanOrEqual(Date.now());
  });

  it("refreshes the timestamp when the URL changes, so the WebEngine reloads", async () => {
    const { default: xapi } = await import("xapi");
    await xapi.Status.Network[1].IPv4.Address.set("10.0.0.5");
    await import("../../macros/main.js");
    await settle();
    const first = (await decodedUrl(xapi)).timestamp;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await xapi.Status.Network[1].IPv4.Address.set("10.0.0.9");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const next = (await decodedUrl(xapi)).timestamp;
    expect(Number(next)).toBeGreaterThan(Number(first));
  });

  it("falls back to IPv6 when there is no IPv4 address", async () => {
    const { default: xapi } = await import("xapi");
    await xapi.Status.Network[1].IPv4.Address.set("");
    await xapi.Status.Network[1].IPv6.Address.set("fd00::1");
    await import("../../macros/main.js");
    await settle();

    expect((await decodedUrl(xapi)).details.address).toBe("fd00::1");
  });

  it("updates the address but keeps the account when the IP changes", async () => {
    const { default: xapi } = await import("xapi");
    await xapi.Status.Network[1].IPv4.Address.set("10.0.0.5");
    await import("../../macros/main.js");
    await settle();
    const first = (await decodedUrl(xapi)).details;

    await xapi.Status.Network[1].IPv4.Address.set("10.0.0.9");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const next = (await decodedUrl(xapi)).details;
    expect(next.address).toBe("10.0.0.9");
    expect(next.password).toBe(first.password);
  });
});

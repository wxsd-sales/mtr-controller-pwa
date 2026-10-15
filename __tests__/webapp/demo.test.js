import { describe, expect, test } from "@jest/globals";
import {
  DEMO_NOW,
  DEMO_SCENES,
  demoBookings,
  demoScene,
} from "../../webapp/demo.js";
import {
  currentBooking,
  groupByDay,
  parseBookings,
} from "../../webapp/calendar.js";
import { useMtrCallUi, useMtrTheme } from "../../webapp/view-mode.js";

describe("demoScene", () => {
  test("is null for an unknown scene, including inherited object keys", () => {
    expect(demoScene("nope")).toBeNull();
    expect(demoScene("toString")).toBeNull();
    expect(demoScene(undefined)).toBeNull();
  });

  test("fills in the full state for every scene", () => {
    for (const name of Object.keys(DEMO_SCENES)) {
      const scene = demoScene(name);
      expect(scene.state).toEqual(
        expect.objectContaining({
          connected: expect.any(Boolean),
          standby: expect.any(String),
          volume: expect.any(Number),
        }),
      );
    }
  });

  test("MTR scenes get the MTR theme and RoomOS scenes do not", () => {
    for (const name of Object.keys(DEMO_SCENES)) {
      const { options } = demoScene(name);
      expect(useMtrTheme(options)).toBe(!name.startsWith("roomos"));
    }
  });

  test("MTR call scenes use the MTR call UI, the RoomOS call scene does not", () => {
    const callUi = (name) => {
      const { options, state } = demoScene(name);
      return useMtrCallUi({ mode: options.mode, mtrCall: state.mtrCall });
    };
    expect(callUi("mtr-call")).toBe(true);
    expect(callUi("mtr-call-camera-auto")).toBe(true);
    expect(callUi("roomos-call")).toBe(false);
  });

  test("only the calendar scene turns the calendar on", () => {
    const withCalendar = Object.keys(DEMO_SCENES).filter(
      (name) => demoScene(name).options.calendar,
    );
    expect(withCalendar).toEqual(["mtr-home-calendar"]);
  });

  test("the camera scenes open the modal; auto framing reports a behaviour", () => {
    expect(demoScene("mtr-call-camera-manual").modal).toBe(true);
    const auto = demoScene("mtr-call-camera-auto");
    expect(auto.modal).toBe(true);
    expect(auto.state.cameraMode).toBe("speaker");
    expect(auto.state.speakerBehavior).toBe("Closeup");
  });

  test("the connect scenes are not connected and the failed one has an error", () => {
    expect(demoScene("connecting").state.connected).toBe(false);
    expect(demoScene("connecting").error).toBe("");
    expect(demoScene("connect-failed").error).not.toBe("");
  });
});

describe("demoBookings", () => {
  test("parses like a real Bookings.List result, with a meeting on now", () => {
    const bookings = parseBookings(demoBookings(), DEMO_NOW);
    expect(bookings).toHaveLength(4);
    expect(currentBooking(bookings, DEMO_NOW).title).toBe("Weekly Team Sync");
  });

  test("spans today and tomorrow", () => {
    const groups = groupByDay(
      parseBookings(demoBookings(), DEMO_NOW),
      DEMO_NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(["today", "tomorrow"]);
  });
});

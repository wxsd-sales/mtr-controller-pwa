// Canned scenes for documentation screenshots. Adding "demo" to the URL hash
// (base64 JSON, e.g. { "demo": "mtr-call" }) shows a scene without connecting to
// a device: no xAPI, a frozen clock and fixed bookings, so captures are repeatable.
// scripts/screenshot.mjs builds one URL per scene.

// The frozen "now" (local time) used by every scene.
export const DEMO_NOW = new Date(2026, 9, 15, 10, 10);

export const DEMO_DEVICE_NAME = "Executive Boardroom";
export const DEMO_ADDRESS = "10.0.0.5";

const MTR = { mode: "Auto", mtrDevice: true, calendar: false };
const ROOMOS = { mode: "RoomOS Only", mtrDevice: false, calendar: false };

// The state every scene starts from; a scene overrides what it needs.
const BASE_STATE = {
  connected: true,
  standby: "Off",
  mtrCall: false,
  activeCalls: 0,
  micMuted: false,
  videoMuted: false,
  selfview: false,
  volume: 50,
  cameraMode: "manual",
  speakerBehavior: "",
  sharing: false,
};

// options: the theming flags (what the macro would put in the hash);
// state: the device status to show; modal: open the Room Camera modal;
// connecting / error: text for the connecting view.
export const DEMO_SCENES = {
  "mtr-home": { options: MTR, state: {} },
  "mtr-home-calendar": {
    options: { ...MTR, calendar: true },
    state: {},
    bookings: true,
  },
  "mtr-home-sharing": { options: MTR, state: { sharing: true } },
  "mtr-halfwake": { options: MTR, state: { standby: "Halfwake" } },
  "mtr-call": { options: MTR, state: { mtrCall: true } },
  "mtr-call-muted": {
    options: MTR,
    state: { mtrCall: true, micMuted: true, videoMuted: true },
  },
  "mtr-call-camera-auto": {
    options: MTR,
    state: { mtrCall: true, cameraMode: "speaker", speakerBehavior: "Closeup" },
    modal: true,
  },
  "mtr-call-camera-manual": {
    options: MTR,
    state: { mtrCall: true },
    modal: true,
  },
  "roomos-home": { options: ROOMOS, state: {} },
  "roomos-call": { options: ROOMOS, state: { activeCalls: 1 } },
  connecting: {
    options: MTR,
    state: { connected: false },
    connecting: `Connecting to ${DEMO_ADDRESS}`,
  },
  "connect-failed": {
    options: MTR,
    state: { connected: false },
    connecting: `Connecting to ${DEMO_ADDRESS}`,
    error: "Connection closed",
  },
};

/** The scene for a name, with its full state filled in, or null when unknown. */
export function demoScene(name) {
  const scene = Object.hasOwn(DEMO_SCENES, name) ? DEMO_SCENES[name] : null;
  if (!scene) return null;
  return {
    modal: false,
    bookings: false,
    connecting: "",
    error: "",
    ...scene,
    state: { ...BASE_STATE, ...scene.state },
  };
}

/** Bookings in the shape of Command.Bookings.List(), relative to `now`. */
export function demoBookings(now = DEMO_NOW) {
  const at = (days, hour, minute = 0) =>
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + days,
      hour,
      minute,
    ).toISOString();
  const booking = (id, title, organizer, start, end, platform = "Webex") => ({
    Id: `demo-${id}`,
    Title: title,
    MeetingPlatform: platform,
    Organizer: { FirstName: organizer },
    Time: { StartTime: start, EndTime: end, IsAllDay: "False" },
  });
  return {
    Booking: [
      booking(1, "Weekly Team Sync", "Maria Erickson", at(0, 10), at(0, 11)),
      booking(2, "Design Review", "Svein Pettersen", at(0, 13), at(0, 14)),
      booking(
        3,
        "Quarterly Planning",
        "Alexander Ottesen",
        at(0, 15),
        at(0, 16, 30),
        "MicrosoftTeams",
      ),
      booking(4, "Customer Briefing", "Nidhi Agrawal", at(1, 9), at(1, 10)),
    ],
    status: "OK",
  };
}

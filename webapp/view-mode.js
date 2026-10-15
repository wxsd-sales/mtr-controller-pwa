// Pure helpers that decide how the web app is themed. Kept free of DOM access
// so the unit tests can import them directly.
//
// mode comes from the macro's mode selector (the "<panelId>-select" widget):
//   "Auto"        follow the device: MTR theme when it is in MTR mode, but a
//                 RoomOS call (not a Teams call) shows the RoomOS in-call UI
//   "RoomOS Only" always the RoomOS views
//   "MTR Only"    always the MTR views, even on a device that is not in MTR mode

export const MODES = ["Auto", "RoomOS Only", "MTR Only"];

export const normalizeMode = (mode) => (MODES.includes(mode) ? mode : "Auto");

// The hash is JSON, so flags normally arrive as booleans; accept "true" too.
export const normalizeFlag = (value) =>
  value === true || String(value).toLowerCase() === "true";

export const normalizeMtrDevice = normalizeFlag;

/** True when the out-of-call views (home, halfwake) get the MTR controller look. */
export function useMtrTheme({ mode, mtrDevice }) {
  if (mode === "MTR Only") return true;
  if (mode === "RoomOS Only") return false;
  return Boolean(mtrDevice);
}

/** True when the in-call view shows the Microsoft Teams (MTR) controls. */
export function useMtrCallUi({ mode, mtrCall }) {
  if (mode === "MTR Only") return true;
  if (mode === "RoomOS Only") return false;
  return Boolean(mtrCall);
}

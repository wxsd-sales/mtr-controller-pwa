import { describe, expect, test } from "@jest/globals";
import {
  MODES,
  normalizeFlag,
  normalizeMode,
  normalizeMtrDevice,
  useMtrCallUi,
  useMtrTheme,
} from "../../webapp/view-mode.js";

describe("normalizeMode / normalizeMtrDevice", () => {
  test("keeps the three known modes", () => {
    expect(MODES).toEqual(["Auto", "RoomOS Only", "MTR Only"]);
    for (const mode of MODES) expect(normalizeMode(mode)).toBe(mode);
  });

  test("falls back to Auto for a missing or unknown mode", () => {
    expect(normalizeMode(undefined)).toBe("Auto");
    expect(normalizeMode("mtr only")).toBe("Auto");
  });

  test("reads the MTR flag from a boolean or the string 'true'", () => {
    expect(normalizeMtrDevice(true)).toBe(true);
    expect(normalizeMtrDevice("true")).toBe(true);
    expect(normalizeMtrDevice(false)).toBe(false);
    expect(normalizeMtrDevice(undefined)).toBe(false);
  });
});

describe("normalizeFlag", () => {
  test("is true only for true or the string 'true'", () => {
    expect(normalizeFlag(true)).toBe(true);
    expect(normalizeFlag("True")).toBe(true);
    expect(normalizeFlag(false)).toBe(false);
    expect(normalizeFlag(undefined)).toBe(false);
    expect(normalizeFlag("yes")).toBe(false);
  });
});

describe("useMtrTheme (out-of-call views)", () => {
  test.each([
    ["Auto", true, true],
    ["Auto", false, false],
    ["RoomOS Only", true, false],
    ["RoomOS Only", false, false],
    ["MTR Only", true, true],
    ["MTR Only", false, true],
  ])("mode %s, mtrDevice %s -> %s", (mode, mtrDevice, expected) => {
    expect(useMtrTheme({ mode, mtrDevice })).toBe(expected);
  });
});

describe("useMtrCallUi (in-call view)", () => {
  test.each([
    // Auto on an MTR device: a Teams call is MTR, a RoomOS call is RoomOS
    ["Auto", true, true],
    ["Auto", false, false],
    ["RoomOS Only", true, false],
    ["RoomOS Only", false, false],
    // forced: MTR in-call UI even for a RoomOS call on a RoomOS device
    ["MTR Only", true, true],
    ["MTR Only", false, true],
  ])("mode %s, Teams call %s -> %s", (mode, mtrCall, expected) => {
    expect(useMtrCallUi({ mode, mtrCall })).toBe(expected);
  });
});

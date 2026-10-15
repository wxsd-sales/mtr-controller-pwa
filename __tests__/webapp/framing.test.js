import { describe, expect, test } from "@jest/globals";
import {
  behaviorForFraming,
  framingForBehavior,
} from "../../webapp/framing.js";

describe("framingForBehavior", () => {
  test.each([
    ["BestOverview", "room"],
    ["Dynamic", "composite"],
    ["Closeup", "speaker"],
    ["Frames", "intelliframe"],
  ])("%s -> %s", (behavior, framing) => {
    expect(framingForBehavior(behavior)).toBe(framing);
  });

  test("is null for an unknown, empty or missing behaviour", () => {
    expect(framingForBehavior("Whiteboard")).toBeNull();
    expect(framingForBehavior("")).toBeNull();
    expect(framingForBehavior(undefined)).toBeNull();
    expect(framingForBehavior(null)).toBeNull();
  });

  test("ignores surrounding whitespace", () => {
    expect(framingForBehavior(" Closeup ")).toBe("speaker");
  });
});

describe("behaviorForFraming", () => {
  test.each([
    ["room", "BestOverview"],
    ["composite", "Dynamic"],
    ["speaker", "Closeup"],
    ["intelliframe", "Frames"],
  ])("%s -> %s", (framing, behavior) => {
    expect(behaviorForFraming(framing)).toBe(behavior);
  });

  test("is null for an unknown option", () => {
    expect(behaviorForFraming("bogus")).toBeNull();
    expect(behaviorForFraming(undefined)).toBeNull();
  });

  test("round-trips with framingForBehavior", () => {
    for (const behavior of ["BestOverview", "Dynamic", "Closeup", "Frames"]) {
      expect(behaviorForFraming(framingForBehavior(behavior))).toBe(behavior);
    }
  });
});

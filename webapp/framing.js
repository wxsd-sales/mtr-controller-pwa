// Maps between the SpeakerTrack behaviour (Status.Cameras.SpeakerTrack.Behavior
// .Active, and the Behavior argument of Command.Cameras.SpeakerTrack.Set) and the
// MTR "Enhanced framing" options. Framing keys match the data-framing attributes
// in index.html.
const FRAMING_BY_BEHAVIOR = {
  BestOverview: "room",
  Dynamic: "composite",
  Closeup: "speaker",
  Frames: "intelliframe",
};

/** The Behavior to send to Cameras SpeakerTrack Set for a framing option, or null. */
export const behaviorForFraming = (framing) =>
  Object.keys(FRAMING_BY_BEHAVIOR).find(
    (behavior) => FRAMING_BY_BEHAVIOR[behavior] === framing,
  ) ?? null;

/** The framing option for a reported behaviour, or null when it is unknown or empty. */
export const framingForBehavior = (behavior) =>
  FRAMING_BY_BEHAVIOR[String(behavior ?? "").trim()] ?? null;

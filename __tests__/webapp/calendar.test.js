import { describe, expect, test } from "@jest/globals";
import {
  currentBooking,
  groupByDay,
  nextBooking,
  parseBookings,
} from "../../webapp/calendar.js";

// Local times, so the day grouping does not depend on the machine's time zone.
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute);
const NOW = at(15, 12, 30);

// Mirrors the shape of a real Bookings.List result (all values are strings).
const booking = (id, title, start, end, extra = {}) => ({
  Id: `webex-${id}`,
  Title: title,
  MeetingPlatform: "Webex",
  Organizer: { FirstName: "Maria Erickson" },
  Time: {
    StartTime: start.toISOString(),
    EndTime: end.toISOString(),
    IsAllDay: "False",
    ...extra,
  },
});

describe("parseBookings", () => {
  test("reads the fields the calendar shows", () => {
    const [meeting] = parseBookings(
      { Booking: [booking(8, "Daily Standup", at(15, 19, 30), at(15, 20))] },
      NOW,
    );
    expect(meeting).toEqual({
      id: "webex-8",
      title: "Daily Standup",
      organizer: "Maria Erickson",
      platform: "Webex",
      allDay: false,
      start: at(15, 19, 30),
      end: at(15, 20),
    });
  });

  test("accepts a single booking object, no bookings, and no result", () => {
    const one = booking(1, "One", at(15, 14), at(15, 15));
    expect(parseBookings({ Booking: one }, NOW)).toHaveLength(1);
    expect(parseBookings({ status: "OK" }, NOW)).toEqual([]);
    expect(parseBookings(undefined, NOW)).toEqual([]);
  });

  test("drops meetings that have finished and sorts the rest by start", () => {
    const result = {
      Booking: [
        booking(3, "Later", at(15, 16), at(15, 17)),
        booking(1, "Done", at(15, 9), at(15, 10)),
        booking(2, "On now", at(15, 12), at(15, 13)),
      ],
    };
    expect(parseBookings(result, NOW).map((b) => b.title)).toEqual([
      "On now",
      "Later",
    ]);
  });

  test("ignores bookings with unusable times and fills in a missing title", () => {
    const result = {
      Booking: [
        { Id: "x", Time: { StartTime: "nope", EndTime: "nope" } },
        { ...booking(2, "", at(15, 14), at(15, 15)), Title: "" },
      ],
    };
    const parsed = parseBookings(result, NOW);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("Meeting");
  });

  test("flags all-day entries", () => {
    const result = {
      Booking: [booking(1, "OOO", at(15, 0), at(16, 0), { IsAllDay: "True" })],
    };
    expect(parseBookings(result, NOW)[0].allDay).toBe(true);
  });
});

describe("currentBooking / nextBooking", () => {
  const bookings = parseBookings(
    {
      Booking: [
        booking(1, "OOO", at(15, 0), at(16, 0), { IsAllDay: "True" }),
        booking(2, "On now", at(15, 12), at(15, 13)),
        booking(3, "Next", at(15, 14), at(15, 15)),
        booking(4, "After", at(15, 16), at(15, 17)),
      ],
    },
    NOW,
  );

  test("finds the meeting that is on now", () => {
    expect(currentBooking(bookings, NOW).title).toBe("On now");
  });

  test("finds the next meeting that has not started", () => {
    expect(nextBooking(bookings, NOW).title).toBe("Next");
  });

  test("an all-day entry does not make the room busy", () => {
    const onlyAllDay = bookings.filter((b) => b.allDay);
    expect(currentBooking(onlyAllDay, NOW)).toBeNull();
    expect(nextBooking(onlyAllDay, NOW)).toBeNull();
  });

  test("is free between meetings", () => {
    expect(currentBooking(bookings, at(15, 13, 30))).toBeNull();
    expect(nextBooking(bookings, at(15, 13, 30)).title).toBe("Next");
  });
});

describe("groupByDay", () => {
  test("groups by start day and labels today, tomorrow and later", () => {
    const bookings = parseBookings(
      {
        Booking: [
          booking(3, "Friday", at(17, 9), at(17, 10)),
          booking(1, "Today A", at(15, 14), at(15, 15)),
          booking(2, "Tomorrow", at(16, 9), at(16, 10)),
          booking(4, "Today B", at(15, 16), at(15, 17)),
        ],
      },
      NOW,
    );
    const groups = groupByDay(bookings, NOW);
    expect(groups.map((g) => g.key)).toEqual(["today", "tomorrow", "later"]);
    expect(groups[0].items.map((b) => b.title)).toEqual(["Today A", "Today B"]);
    expect(groups[2].date).toEqual(at(17, 0));
  });

  test("a meeting already under way, or started yesterday, counts for today", () => {
    const bookings = parseBookings(
      { Booking: [booking(1, "Overnight", at(14, 23), at(15, 14))] },
      NOW,
    );
    expect(groupByDay(bookings, NOW).map((g) => g.key)).toEqual(["today"]);
  });

  test("no meetings gives no groups", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

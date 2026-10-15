// Pure helpers for the MTR home screen's calendar. Kept free of DOM access so the
// unit tests can import them directly.
//
// Input is the result of xapi.Command.Bookings.List(): { Booking: [...] }, where
// Booking is an array (or a single object when there is only one, or absent when
// there are none) and every value is a string, e.g. Time.IsAllDay: "False".

/** Normalises a Bookings.List result into upcoming meetings, soonest first. */
export function parseBookings(result, now = new Date()) {
  const raw = result?.Booking ?? [];
  return [raw]
    .flat()
    .map((booking) => {
      const start = new Date(booking?.Time?.StartTime);
      const end = new Date(booking?.Time?.EndTime);
      return {
        id: String(booking?.Id ?? booking?.id ?? ""),
        title: booking?.Title || "Meeting",
        organizer: booking?.Organizer?.FirstName || "",
        platform: booking?.MeetingPlatform || "",
        allDay: String(booking?.Time?.IsAllDay).toLowerCase() === "true",
        start,
        end,
      };
    })
    .filter(
      ({ start, end }) =>
        !Number.isNaN(start.getTime()) &&
        !Number.isNaN(end.getTime()) &&
        end > now,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The timed meeting that is on now, if any (all-day entries never make the room busy). */
export function currentBooking(bookings, now = new Date()) {
  return (
    bookings.find((b) => !b.allDay && b.start <= now && now < b.end) ?? null
  );
}

/** The next timed meeting that has not started yet, if any. */
export function nextBooking(bookings, now = new Date()) {
  return bookings.find((b) => !b.allDay && b.start > now) ?? null;
}

const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Groups meetings by the (local) day they start on. A meeting already under way
 * counts for today. Each group has a key of "today", "tomorrow" or "later" plus
 * the day's date, so the UI can label it.
 */
export function groupByDay(bookings, now = new Date()) {
  const today = startOfDay(now).getTime();
  const days = new Map();
  for (const booking of bookings) {
    const day = Math.max(startOfDay(booking.start).getTime(), today);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(booking);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, items]) => {
      const diff = Math.round((day - today) / 86_400_000);
      return {
        key: diff === 0 ? "today" : diff === 1 ? "tomorrow" : "later",
        date: new Date(day),
        items,
      };
    });
}

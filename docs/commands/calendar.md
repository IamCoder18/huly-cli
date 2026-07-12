# Commands — Calendar

Calendars, calendar events, and recurring events.

```bash
huly calendar calendars                            # list calendars (NOT events)
huly calendar create-calendar --name "Work" [--description] [--private] [--access owner|team|public]
huly calendar delete-calendar <ref>

huly calendar list                                 # list events
huly calendar get <eventRef> [--markdown]          # events have --markdown body
huly calendar create --title "..." [--start ISO] [--end ISO] [--attendee email@...]
                  [--location] [--all-day] [--description] [--body <md>]
                  [--calendar-id <ref>] [--rrule "FREQ=DAILY;COUNT=3"]
huly calendar update <eventRef> [--title] [--start] [--end] [--attendee]
huly calendar delete <eventRef...> [--yes]

huly calendar recurring                            # list recurring event definitions
huly calendar recurring-instances <recRef>         # list materialized instances
```

**Date format:** ISO 8601 with timezone, e.g.
`2026-07-01T14:00:00Z`. The CLI does not parse natural-language
dates — use `date -u -d "..."` or similar to generate.

**RRULE format:** iCalendar RFC 5545, e.g. `FREQ=DAILY;COUNT=3`,
`FREQ=WEEKLY;BYDAY=MO,WE,FR`. Use `recurring-instances` to see what
got materialized.

**`calendars` vs `get`:** confusingly, `calendar get <ref>` returns
**events** (not calendars). To fetch a calendar's metadata, use
`calendar calendars --json` and grep for `_id`.

## Smart defaults

- `--access` defaults to `public` on `create-calendar` (one of
  `owner` / `team` / `public`).
- `--private` defaults to `false` on `create-calendar`.
- `--duration` defaults to `30` minutes on `schedule create`.
- `--interval` defaults to `15` minutes on `schedule create`.
- `--time-zone` defaults to `UTC`. For recurring events the RRULE is
  evaluated in the given TZ.
- `blockTime` defaults to `false` — events don't block the user's
  calendar by default. Pass `--block-time` to set.

## Best practices & side effects

- `--rrule` is iCalendar RFC 5545. Server coerces `BYDAY` /
  `BYMONTH` / `BYMONTHDAY` / `BYSETPOS` to numeric arrays.
- **Recurring exceptions (EXDATE) are not implemented.** The
  `ReccuringEvent` model has no `exdates` field; exception dates are
  silently ignored. There is no UI to skip a single occurrence.
- Each materialized instance is a `ReccuringInstance` carrying
  `recurringEventId` + `originalStartTime`. To list instances, query
  by `recurringEventId`.
- `WorkSlot` visibility mirrors back to the parent `ToDo` and the
  derived calendar event when `WorkSlot.visibility` changes.
- Visibility mapping for Google sync:
  `transparency:transparent ↔ visibility:freeBusy`;
  Huly `private ↔ Google private`.

For more, see
[Platform behavior — Calendar](../reference/platform-behavior.md#calendar-recurring-events).

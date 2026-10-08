import { test } from "node:test";
import assert from "node:assert";

import {
  slugify,
  shareId,
  nextCallDate,
  CallDayUnsetError,
  agendaPath,
  projectPath,
  recapPath,
  sharePath,
} from "../src/paths.mjs";

const NY = "America/New_York";
// callTime is the local wall clock read in `timezone`, so these are the New York answers.
const WED = { callWeekday: 3, callTime: "09:00", timezone: NY };
const T = 1728400000000;

test("MCP-AGENDA-005 lowercases, collapses runs, trims hyphens, adds the suffix", () => {
  const slug = slugify("Weekly  Prep -- Notes!", T);
  assert.match(slug, /^weekly-prep-notes-[0-9a-z]{4}$/);
  assert.equal(slugify("  --The Context--Window-- ", T), slugify("The Context Window", T));
});

test("MCP-AGENDA-005 cuts the title at 60 chars and keeps the suffix 4 wide", () => {
  const slug = slugify("a".repeat(80), T);
  // 60 title chars + the hyphen + 4 suffix chars.
  assert.equal(slug.length, 65);
  assert.equal(slug.slice(0, 60), "a".repeat(60));
  assert.equal(slug[60], "-");
  assert.equal(slug.slice(61).length, 4);
  assert.match(slug.slice(61), /^[0-9a-z]{4}$/);
  // A word boundary inside the window leaves no doubled hyphen before the suffix.
  const words = slugify("one two three four five six seven eight nine ten eleven twelve", T);
  assert.equal(words.includes("--"), false);
});

test("MCP-AGENDA-005 the timestamp suffix separates two members adding the same title", () => {
  assert.notEqual(slugify("Weekly prep", T), slugify("Weekly prep", T + 1));
});

test("MCP-GIT-001 every helper yields its own per-item file, and titles never collide", () => {
  assert.equal(agendaPath("2026-10-07", "alpha-abcd"), "agenda/2026-10-07/alpha-abcd.md");
  assert.equal(projectPath("micah", "alpha-abcd"), "projects/micah/alpha-abcd.md");
  assert.equal(recapPath("2026-10-07"), "recaps/2026-10-07.md");
  assert.equal(sharePath("20261007-micah-abcd", "src/a.ts"), "shares/20261007-micah-abcd/src/a.ts");
  const a = agendaPath("2026-10-07", slugify("Alpha", T));
  const b = agendaPath("2026-10-07", slugify("Beta", T));
  assert.notEqual(a, b);
});

test("MCP-AGENDA-005 the share id is the day, the login and a 4-wide suffix", () => {
  const id = shareId("micah", new Date("2026-10-07T14:00:00Z"));
  assert.match(id, /^20261007-micah-[0-9a-z]{4}$/);
  assert.notEqual(shareId("micah", new Date("2026-10-07T14:00:01Z")), id);
});

test("MCP-AGENDA-002 a Monday now moves to Wednesday of the same week", () => {
  assert.equal(nextCallDate(WED, new Date("2026-10-05T09:00:00Z")), "2026-10-07");
});

test("MCP-AGENDA-002 on the call day before callTime the same date is kept", () => {
  // 12:59Z is 08:59 local, still before the 09:00 call.
  assert.equal(nextCallDate(WED, new Date("2026-10-07T12:59:00Z")), "2026-10-07");
});

test("MCP-AGENDA-002 on the call day at or after callTime the next week is used", () => {
  // 13:00Z is 09:00 local, exactly the call time, and 13:01Z is past it.
  assert.equal(nextCallDate(WED, new Date("2026-10-07T13:00:00Z")), "2026-10-14");
  assert.equal(nextCallDate(WED, new Date("2026-10-07T13:01:00Z")), "2026-10-14");
});
test("MCP-AGENDA-002 a null callTime is compared against noon local", () => {
  const cfg = { callWeekday: 3, callTime: null, timezone: NY };
  // 12:30 local is past noon, 11:30 local is not.
  assert.equal(nextCallDate(cfg, new Date("2026-10-07T16:30:00Z")), "2026-10-14");
  assert.equal(nextCallDate(cfg, new Date("2026-10-05T15:30:00Z")), "2026-10-07");
});

test("MCP-AGENDA-002 an unset callWeekday reports the config error", () => {
  assert.throws(
    () => nextCallDate({ callWeekday: null, callTime: "14:00" }, new Date("2026-10-05T09:00:00Z")),
    (err) => err instanceof CallDayUnsetError && /Set callWeekday in config.json/.test(err.message),
  );
});

test("MCP-AGENDA-002 the weekday and date come from the configured timezone", () => {
  // 23:30Z on the 7th is Wednesday 13:30 in New York, so that same day is the answer.
  assert.equal(nextCallDate(WED, new Date("2026-10-07T23:30:00Z")), "2026-10-07");
  // In Kiritimati the same instant is Thursday 12:30, one day ahead of the UTC date,
  // so the Wednesday of that week has already gone and the 14th answers.
  assert.equal(
    nextCallDate({ callWeekday: 3, callTime: "09:00", timezone: "Pacific/Kiritimati" }, new Date("2026-10-07T23:30:00Z")),
    "2026-10-14",
  );
});

// The same wall clock is read in two zones, which is what makes the zone load-bearing.
test("MCP-AGENDA-002 the timezone also decides whether the call time has passed", () => {
  // Kiritimati is 12:30 local at 22:30Z, past a 12:00 call, so the next Thursday is 15.
  assert.equal(
    nextCallDate({ callWeekday: 4, callTime: "12:00", timezone: "Pacific/Kiritimati" }, new Date("2026-10-08T22:30:00Z")),
    "2026-10-15",
  );
  // In New York that same instant is 08:30, before the call, so the 8th still stands.
  assert.equal(
    nextCallDate({ callWeekday: 4, callTime: "12:00", timezone: NY }, new Date("2026-10-08T22:30:00Z")),
    "2026-10-08",
  );
});

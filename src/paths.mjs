// Path + identifier helpers. These are the only place where the on-disk layout named in
// the contract is spelled out, so the writer and the reader agree on one spelling.

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

// 60 chars keeps the trimmed title readable while the 4-char tail still separates two
// members who typed the same title inside one timestamp window.
const SLUG_MAX = 60;

const NO_CALL_DAY =
  "Set callWeekday in config.json to the call's weekday (0 = Sunday through 6 = Saturday).";

// MCP-AGENDA-005
export function slugify(title, now = Date.now()) {
  const collapsed = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = collapsed.slice(0, SLUG_MAX).replace(/-+$/g, "");
  return `${cut}-${base36(now, 4)}`;
}

// The id has to be unique inside one day without a second round trip, so the timestamp
// remainder rides along next to the day and the login.
export function shareId(login, now = new Date()) {
  const stamp = now instanceof Date ? now : new Date(Number(now));
  const ms = stamp.getTime();
  const { year, month, day } = dateParts(stamp, "America/New_York");
  return `${year}${pad(month)}${pad(day)}-${login}-${base36(ms, 4)}`;
}

// Call days are 0-6 from Sunday, which is Intl's own weekday numbering.
const WEEKDAY_NUMBER = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// MCP-AGENDA-002
export function nextCallDate(config, now = new Date()) {
  const { callWeekday = null, callTime = null, timezone = "America/New_York" } = config ?? {};
  if (callWeekday === null || callWeekday === undefined) throw new CallDayUnsetError(NO_CALL_DAY);

  const stamp = now instanceof Date ? now : new Date(Number(now));
  const { weekday, hour, minute } = dateParts(stamp, timezone);
  let days = (callWeekday - weekday + 7) % 7;

  // On the call day the call itself decides the week: a passed callTime means this
  // occurrence is done, and with no callTime recorded noon local is the fallback.
  if (days === 0) {
    const [callHour = 12, callMinute = 0] = String(callTime ?? "")
      .split(":")
      .map(Number);
    const limit = callTime ? callHour * 60 + callMinute : 12 * 60;
    if (hour * 60 + minute >= limit) days = 7;
  }

  return formatDate(stamp, timezone, days);
}

export class CallDayUnsetError extends Error {}

// Each item gets its own file, so two titles that slug identically still land as two
// files rather than as one merged record.
// MCP-GIT-001
export function agendaPath(callDate, slug) {
  return `agenda/${callDate}/${slug}.md`;
}

// MCP-GIT-001
export function projectPath(login, slug) {
  return `projects/${login}/${slug}.md`;
}

// MCP-GIT-001
export function recapPath(callDate) {
  return `recaps/${callDate}.md`;
}

// MCP-GIT-001
export function sharePath(id, relPath) {
  return `shares/${id}/${relPath}`;
}

// Both date and time come from the one formatter so the "has the call happened" test
// compares values that are already in the call's own zone.
function dateParts(now, timeZone) {
  const options = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  // hourCycle "h23" yields 1-24, so 24 has to fold to 0 for the midnight hour.
  const hourRaw = Number(get("hour"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAY_NUMBER[get("weekday")],
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: Number(get("minute")),
  };
}

// The day shift goes through the epoch so DST steps are resolved by Intl instead of by
// arithmetic on component values.
function formatDate(now, timeZone, dayShift) {
  const shifted = new Date(now.getTime() + dayShift * 24 * 60 * 60 * 1000);
  const { year, month, day } = dateParts(shifted, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function base36(n, width) {
  let out = "";
  let v = Math.trunc(Number(n));
  for (let i = 0; i < width; i++) {
    out = BASE36[v % 36] + out;
    v = Math.floor(v / 36);
  }
  return out;
}

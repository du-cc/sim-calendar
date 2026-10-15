const SIM = require("sim");

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function parseDay(str) {
  return new Date(`${str}T00:00:00Z`);
}

// Format a Date as ICS UTC time, e.g. 20261015T070000Z
function toICSTime(date) {
  return date.toISOString().split(".")[0].replaceAll(/[:-]/g, "") + "Z";
}

async function requestTimetable(start, end, cookie) {
  // requests can only start on Sundays, so snap both ends back to their Sunday
  const rangeStart = parseDay(start);
  const rangeEnd = parseDay(end);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - rangeStart.getUTCDay());
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() - rangeEnd.getUTCDay());

  const weeks = Math.round((rangeEnd - rangeStart) / WEEK_MS) + 1;

  var requestData = {
    viewName: "Timetable.Timetable",
    screenData: {
      variables: {
        IsShowCalendar: false,
        IsDay: false,
        IsWeek: true,
        IsMonth: false,
        EventList: { List: [], EmptyListItem: "1900-01-01T00:00:00" },
        IsShowLoading: true,
        IsRemoveContentWrapper: false,
        IsAVE: false,
        IsFromHome: false,
        _isFromHomeInDataFetchStatus: 1,
        SelectedDate: "2026-01-01",
        _selectedDateInDataFetchStatus: 1,
      },
    },
  };

  // auth
  const os = new SIM.OutSystems();
  try {
    const b2c_auth = await SIM.B2c.authenticate(cookie);
    await os.authenticate(b2c_auth.saml, b2c_auth.cookie);
  } catch (err) {
    throw Object.assign(
      new Error(`Authentication failed: ${err.message}`, { cause: err }),
      {
        status: 401,
      },
    );
  }

  // fetch versions
  var versionInfo = {
    moduleVersion: await SIM.OutSystems.fetchModuleVersion(),
    apiVersion: await SIM.OutSystems.fetchApiVersion(
      "https://simattendance.simge.edu.sg/StudentApp/screenservices/StudentApp/Timetable/Timetable/DataActionWeekPreparation",
    ),
  };
  const data = [];
  for (let i = 0; i < weeks; i++) {
    const sunday = new Date(rangeStart.getTime() + i * WEEK_MS);
    requestData.screenData.variables.SelectedDate = sunday
      .toISOString()
      .split("T")[0];
    const res = await os.interact(
      "https://simattendance.simge.edu.sg/StudentApp/screenservices/StudentApp/Timetable/Timetable/DataActionWeekPreparation",
      versionInfo,
      requestData,
    );
    data.push(await res.json());
  }
  return data;
}

function extractEvents(data, start, end) {
  const events = [];
  const stamp = toICSTime(new Date());

  for (const week of data) {
    for (const day of week.data.WeekItems.List) {
      for (const item of day.TimeTableBlockDisplayList.List) {
        if (item.Type === "Holiday") continue;

        const dateStart = new Date(
          Date.parse(`${item.Date} ${item.TimeStart}`),
        );
        const dateEnd = new Date(Date.parse(`${item.Date} ${item.TimeEnd}`));

        const day = dateStart.toLocaleDateString("en-CA", {
          timeZone: "Asia/Singapore",
        });
        if (day < start || day > end) continue; // ISO date strings compare correctly

        events.push({
          start: toICSTime(dateStart),
          end: toICSTime(dateEnd),
          stamp,
          // ":" and "-" stripped for better calendar-app compatibility
          uid: `${item.ClassInformation.SlotId}@sim.edu.sg`.replaceAll(
            /[:-]/g,
            "",
          ),
          title: item.Class,
          location: item.Venue,
        });
      }
    }
  }
  return events;
}

function buildCalendar(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SIM//Class Schedule//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `DTSTART:${e.start}`,
      `DTEND:${e.end}`,
      `DTSTAMP:${e.stamp}`,
      `UID:${e.uid}`,
      `SUMMARY:${e.title}`,
      `LOCATION:${e.location}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * @param {string} start  YYYY-MM-DD
 * @param {string} end    YYYY-MM-DD
 * @param {"merged"|"split"} mode
 * @param {string | null} cookie  stored cookie, or null if none has been saved
 * @returns {Promise<string | Record<string,string>>}
 *   merged = one .ics string; split = { [moduleName]: .ics string }
 */
async function getTimetable(start, end, mode = "merged", cookie = null) {
  const raw = await requestTimetable(start, end, cookie);
  const events = extractEvents(raw, start, end);

  if (mode === "split") {
    const byModule = {};
    for (const e of events) (byModule[e.title] ||= []).push(e);
    return Object.fromEntries(
      Object.entries(byModule).map(([title, evs]) => [
        title,
        buildCalendar(evs),
      ]),
    );
  }
  return buildCalendar(events);
}

module.exports = { getTimetable };

import { academicYearOf, seasonOf, type Season } from "./academicCalendar";

const STORAGE_KEY = "studies-planner-agenda-v1";

export type AgendaItemType = "series" | "lab" | "midterm" | "final" | "note";

/** Series: to do -> done -> corrected. Labs: to do -> done (submitted). Exams and notes have no status. */
export type AgendaStatus = "todo" | "done" | "corrected";

export interface AgendaItem {
  id: string;
  type: AgendaItemType;
  // "2026-autumn": the semester the item belongs to (finals may have no date yet).
  semester: string;
  // Course code and name are copied so the item survives changes to the plan. Notes may have no course.
  courseCode: string;
  courseName: string;
  // "Series 3", "Lab 2", "Midterm" or the note's text.
  title: string;
  // YYYY-MM-DD, empty only for a final whose date isn't known yet.
  date: string;
  // HH:MM, optional.
  time: string;
  status: AgendaStatus;
  details: string;
  // Items added together with "Every week" share a group, so they can be edited or deleted at once. "" = on its own.
  group: string;
}

/** A batch of changes applied at once (bulk edits, imports). */
export interface AgendaChange {
  add?: Array<Omit<AgendaItem, "id">>;
  update?: Array<{ id: string; patch: Partial<Omit<AgendaItem, "id">> }>;
  remove?: string[];
}

export const newAgendaId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const AGENDA_TYPE_LABELS: Record<AgendaItemType, string> = {
  series: "Series",
  lab: "Lab",
  midterm: "Midterm",
  final: "Final",
  note: "Note",
};

/** Item types that are ticked off; exams and notes are just dated. */
export const hasStatus = (type: AgendaItemType): boolean => type === "series" || type === "lab";

export const statusCycle = (type: AgendaItemType, status: AgendaStatus): AgendaStatus => {
  if (type === "series") {
    return status === "todo" ? "done" : status === "done" ? "corrected" : "todo";
  }
  return status === "todo" ? "done" : "todo";
};

export const isFinished = (item: AgendaItem): boolean => !hasStatus(item.type) || item.status !== "todo";

export const semesterKeyOf = (academicYear: number, season: Season): string => `${academicYear}-${season}`;

export const currentSemesterKey = (date: Date = new Date()): string => semesterKeyOf(academicYearOf(date), seasonOf(date));

export const parseSemesterKey = (key: string): { academicYear: number; season: Season } => {
  const [year, season] = key.split("-");
  return { academicYear: Number(year), season: season === "spring" ? "spring" : "autumn" };
};

export const shiftSemesterKey = (key: string, offset: number): string => {
  const { academicYear, season } = parseSemesterKey(key);
  const index = academicYear * 2 + (season === "spring" ? 1 : 0) + offset;
  return semesterKeyOf(Math.floor(index / 2), index % 2 === 1 ? "spring" : "autumn");
};

// --- Dates (local, day precision; YYYY-MM-DD strings avoid timezone surprises) ---

export const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const fromIsoDate = (iso: string): Date => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
};

export const addDays = (iso: string, days: number): string => {
  const date = fromIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round((fromIsoDate(toIso).getTime() - fromIsoDate(fromIso).getTime()) / DAY_MS);

/** Monday of the week containing `iso`. */
export const mondayOf = (iso: string): string => {
  const day = fromIsoDate(iso).getDay(); // 0 = Sunday
  return addDays(iso, day === 0 ? -6 : 1 - day);
};

/**
 * Default first day of a semester: the first Monday on or after 8 September (autumn) or 16 February (spring).
 * This is an estimate of the EPFL calendar; users can correct it in the Agenda.
 */
export const defaultSemesterStart = (key: string): string => {
  const { academicYear, season } = parseSemesterKey(key);
  const anchor = season === "autumn" ? `${academicYear}-09-08` : `${academicYear + 1}-02-16`;
  const monday = mondayOf(anchor);
  return monday < anchor ? addDays(monday, 7) : monday;
};

/** Teaching weeks per semester, used when the academic calendar doesn't cover a semester. */
export const TEACHING_WEEKS = 14;

/** One calendar week (Monday to Sunday) of a semester. */
export interface AgendaWeek {
  monday: string;
  sunday: string;
  // Teaching week number (1, 2, ...), or null for a week without courses (e.g. the autumn break week).
  number: number | null;
  breakName: string | null;
  // Weekdays off inside a teaching week (bank holidays).
  daysOff: Array<{ date: string; name: string }>;
}

export interface SemesterLayout {
  weeks: AgendaWeek[];
  exams: { from: string; to: string } | null;
  // "epfl": from the academic calendar; otherwise 14 consecutive weeks from an estimated or chosen start.
  source: "epfl" | "estimate" | "custom";
}

/**
 * The weeks of a semester. With the EPFL calendar, weeks whose weekdays are all off (break weeks) get no
 * number, so teaching weeks stay numbered 1..14 as the courses count them.
 */
export const semesterLayout = (
  calendar: { firstDay: string; lastDay: string; daysOff: Array<{ from: string; to: string; name: string }>; exams: { from: string; to: string } | null } | undefined,
  fallbackStart: string,
  isCustomStart: boolean,
): SemesterLayout => {
  if (!calendar) {
    const weeks = Array.from({ length: TEACHING_WEEKS }, (_, index) => {
      const monday = addDays(fallbackStart, index * 7);
      return { monday, sunday: addDays(monday, 6), number: index + 1, breakName: null, daysOff: [] };
    });
    return { weeks, exams: null, source: isCustomStart ? "custom" : "estimate" };
  }

  const offName = (iso: string): string | null =>
    calendar.daysOff.find((range) => range.from <= iso && iso <= range.to)?.name ?? null;

  const weeks: AgendaWeek[] = [];
  let number = 0;
  for (let monday = mondayOf(calendar.firstDay); monday <= calendar.lastDay; monday = addDays(monday, 7)) {
    const weekdays = Array.from({ length: 5 }, (_, index) => addDays(monday, index));
    const off = weekdays
      .map((date) => ({ date, name: offName(date) }))
      .filter((day): day is { date: string; name: string } => day.name !== null);
    const isBreak = off.length === weekdays.length;
    if (!isBreak) {
      number += 1;
    }
    weeks.push({
      monday,
      sunday: addDays(monday, 6),
      number: isBreak ? null : number,
      breakName: isBreak ? off[off.length - 1].name : null,
      daysOff: isBreak ? [] : off,
    });
  }
  return { weeks, exams: calendar.exams, source: "epfl" };
};

/** The week containing a date, if it is inside the semester's weeks. */
export const weekContaining = (weeks: AgendaWeek[], iso: string): AgendaWeek | undefined =>
  weeks.find((week) => week.monday <= iso && iso <= week.sunday);

/** 0 = Monday ... 6 = Sunday. */
export const weekdayIndex = (iso: string): number => (fromIsoDate(iso).getDay() + 6) % 7;

// --- Storage ---

interface StoredAgenda {
  version: 1;
  items: AgendaItem[];
  semesterStarts: Record<string, string>;
}

const AGENDA_TYPES: readonly AgendaItemType[] = ["series", "lab", "midterm", "final", "note"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseItem = (value: unknown): AgendaItem | null => {
  const raw = (value ?? {}) as Record<string, unknown>;
  if (typeof raw.id !== "string" || !AGENDA_TYPES.includes(raw.type as AgendaItemType) || typeof raw.semester !== "string") {
    return null;
  }
  const date = typeof raw.date === "string" && ISO_DATE.test(raw.date) ? raw.date : "";
  return {
    id: raw.id,
    type: raw.type as AgendaItemType,
    semester: raw.semester,
    courseCode: typeof raw.courseCode === "string" ? raw.courseCode : "",
    courseName: typeof raw.courseName === "string" ? raw.courseName : "",
    title: typeof raw.title === "string" ? raw.title : "",
    date,
    time: typeof raw.time === "string" && /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : "",
    status: raw.status === "done" || raw.status === "corrected" ? raw.status : "todo",
    details: typeof raw.details === "string" ? raw.details : "",
    group: typeof raw.group === "string" ? raw.group : "",
  };
};

/**
 * Items saved before groups existed: series or labs of a course that repeat on the same weekday and time
 * were added with "Every week", so they become one group.
 */
const groupLegacyItems = (items: AgendaItem[], legacy: Set<AgendaItem>): void => {
  const buckets = new Map<string, AgendaItem[]>();
  items.forEach((item) => {
    if (legacy.has(item) && hasStatus(item.type) && item.date) {
      const key = [item.semester, item.courseCode, item.type, weekdayIndex(item.date), item.time].join("|");
      buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }
  });
  buckets.forEach((bucket) => {
    if (bucket.length > 1) {
      const group = newAgendaId();
      bucket.forEach((item) => {
        item.group = group;
      });
    }
  });
};

/** Series, labs, exams and notes per semester, saved in this browser. */
export class AgendaStore {
  private items: AgendaItem[] = [];
  private semesterStarts: Record<string, string> = {};

  public constructor() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
      if (parsed && parsed.version === 1) {
        const rawItems: unknown[] = Array.isArray(parsed.items) ? parsed.items : [];
        const legacy = new Set<AgendaItem>();
        rawItems.forEach((raw) => {
          const item = parseItem(raw);
          if (item) {
            this.items.push(item);
            if (typeof (raw as { group?: unknown }).group !== "string") {
              legacy.add(item);
            }
          }
        });
        groupLegacyItems(this.items, legacy);
        Object.entries((parsed.semesterStarts ?? {}) as Record<string, unknown>).forEach(([key, value]) => {
          if (typeof value === "string" && ISO_DATE.test(value)) {
            this.semesterStarts[key] = value;
          }
        });
      }
    } catch {
      // Unreadable storage: start with an empty agenda.
    }
  }

  public itemsOf(semester: string): AgendaItem[] {
    return this.items.filter((item) => item.semester === semester);
  }

  public semesterStart(semester: string): string {
    return this.semesterStarts[semester] ?? defaultSemesterStart(semester);
  }

  public isDefaultStart(semester: string): boolean {
    return !(semester in this.semesterStarts);
  }

  public setSemesterStart(semester: string, iso: string | null): void {
    if (iso && ISO_DATE.test(iso)) {
      this.semesterStarts[semester] = mondayOf(iso);
    } else {
      delete this.semesterStarts[semester];
    }
    this.persist();
  }

  public add(items: Array<Omit<AgendaItem, "id">>): void {
    this.apply({ add: items });
  }

  /** Removals first, then updates, then additions; saved once. */
  public apply(change: AgendaChange): void {
    const removed = new Set(change.remove ?? []);
    this.items = this.items.filter((item) => !removed.has(item.id));
    (change.update ?? []).forEach(({ id, patch }) => {
      const item = this.items.find((candidate) => candidate.id === id);
      if (item) {
        Object.assign(item, patch);
      }
    });
    (change.add ?? []).forEach((item) => {
      this.items.push({ ...item, id: newAgendaId() });
    });
    this.persist();
  }

  public update(id: string, patch: Partial<Omit<AgendaItem, "id">>): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (item) {
      Object.assign(item, patch);
      this.persist();
    }
  }

  public remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.persist();
  }

  private persist(): void {
    const payload: StoredAgenda = { version: 1, items: this.items, semesterStarts: this.semesterStarts };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write errors (private mode, quota issues, etc.).
    }
  }
}

// --- Sharing ---
// A course's workload (or a whole semester's) as JSON, without statuses. Items inside a teaching week are
// stored as week number + weekday, so a file made one year still fits the next year's calendar.

export const SHARE_FORMAT = "my-studies-agenda";

export interface SharedAgendaItem {
  type: AgendaItemType;
  title: string;
  // Teaching week (1, 2, ...) and weekday (0 = Monday) for items inside a teaching week...
  week?: number;
  weekday?: number;
  // ...else the date itself (exam session, break week), which only fits the same semester.
  date?: string;
  time: string;
  details: string;
  // Items sharing a group were added together ("Every week").
  group?: string;
}

export interface SharedAgendaCourse {
  code: string;
  name: string;
  items: SharedAgendaItem[];
}

export interface SharedAgenda {
  semester: string;
  courses: SharedAgendaCourse[];
}

export const exportAgenda = (semester: string, weeks: AgendaWeek[], items: AgendaItem[]): string => {
  const courses = new Map<string, SharedAgendaCourse>();
  const groups = new Map<string, string>();
  [...items]
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.time.localeCompare(b.time))
    .forEach((item) => {
      let course = courses.get(item.courseCode);
      if (!course) {
        course = { code: item.courseCode, name: item.courseName, items: [] };
        courses.set(item.courseCode, course);
      }
      const shared: SharedAgendaItem = { type: item.type, title: item.title, time: item.time, details: item.details };
      const week = item.date ? weekContaining(weeks, item.date) : undefined;
      if (week?.number) {
        shared.week = week.number;
        shared.weekday = weekdayIndex(item.date);
      } else if (item.date) {
        shared.date = item.date;
      }
      if (item.group) {
        if (!groups.has(item.group)) {
          groups.set(item.group, `g${groups.size + 1}`);
        }
        shared.group = groups.get(item.group);
      }
      course.items.push(shared);
    });
  return JSON.stringify({ format: SHARE_FORMAT, version: 1, semester, exportedAt: new Date().toISOString(), courses: [...courses.values()] }, null, 2);
};

/** Reads a shared file; throws an Error with a readable message if it isn't one. */
export const parseAgendaShare = (text: string): SharedAgenda => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This isn't valid JSON.");
  }
  if (!parsed || parsed.format !== SHARE_FORMAT || !Array.isArray(parsed.courses)) {
    throw new Error("This JSON isn't an agenda shared from My Studies.");
  }
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const courses = (parsed.courses as unknown[]).map((rawCourse): SharedAgendaCourse => {
    const course = (rawCourse ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(course.items) ? course.items : [])
      .map((rawItem: unknown): SharedAgendaItem | null => {
        const item = (rawItem ?? {}) as Record<string, unknown>;
        if (!AGENDA_TYPES.includes(item.type as AgendaItemType)) {
          return null;
        }
        const shared: SharedAgendaItem = {
          type: item.type as AgendaItemType,
          title: str(item.title),
          time: /^\d{2}:\d{2}$/.test(str(item.time)) ? str(item.time) : "",
          details: str(item.details),
        };
        if (Number.isInteger(item.week) && (item.week as number) > 0 && Number.isInteger(item.weekday) && (item.weekday as number) >= 0 && (item.weekday as number) <= 6) {
          shared.week = item.week as number;
          shared.weekday = item.weekday as number;
        } else if (ISO_DATE.test(str(item.date))) {
          shared.date = str(item.date);
        }
        if (str(item.group)) {
          shared.group = str(item.group);
        }
        return shared;
      })
      .filter((item: SharedAgendaItem | null): item is SharedAgendaItem => item !== null);
    return { code: str(course.code), name: str(course.name), items };
  });
  return { semester: str(parsed.semester), courses: courses.filter((course) => course.items.length > 0) };
};

/**
 * Agenda items for a shared course in a target semester. Weekly positions map onto its teaching weeks; dates
 * only carry over within the same semester (a final keeps its place without a date). Groups get fresh ids.
 */
export const materializeShared = (
  course: SharedAgendaCourse,
  share: { semester: string },
  target: { semester: string; weeks: AgendaWeek[] },
  as: { code: string; name: string },
): { items: Array<Omit<AgendaItem, "id">>; skipped: number } => {
  const groups = new Map<string, string>();
  const items: Array<Omit<AgendaItem, "id">> = [];
  let skipped = 0;
  course.items.forEach((shared) => {
    let date = "";
    if (shared.week !== undefined && shared.weekday !== undefined) {
      const week = target.weeks.find((candidate) => candidate.number === shared.week);
      date = week ? addDays(week.monday, shared.weekday) : "";
    } else if (shared.date && share.semester === target.semester) {
      date = shared.date;
    }
    if (!date && shared.type !== "final") {
      skipped += 1;
      return;
    }
    let group = "";
    if (shared.group) {
      group = groups.get(shared.group) ?? newAgendaId();
      groups.set(shared.group, group);
    }
    items.push({
      type: shared.type,
      semester: target.semester,
      courseCode: as.code,
      courseName: as.name,
      title: shared.title || AGENDA_TYPE_LABELS[shared.type],
      date,
      time: shared.time,
      status: "todo",
      details: shared.details,
      group,
    });
  });
  return { items, skipped };
};

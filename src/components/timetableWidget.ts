import { timetableConfig, type TimetableConfig } from "../config/timetableConfig";
import type { ConflictSlotBlock, Period } from "../domain/timetableModel";
import { TimetableModel } from "../domain/timetableModel";
import type { CourseEditInfo, EditableCourseValues, LectureSlot } from "../domain/courseOverrides";
import { seasonLabel, studyPosition, type Season, type StudyPosition } from "../domain/academicCalendar";
import {
  AGENDA_TYPE_LABELS,
  addDays,
  daysBetween,
  exportAgenda,
  fromIsoDate,
  hasStatus,
  isFinished,
  materializeShared,
  newAgendaId,
  parseAgendaShare,
  parseSemesterKey,
  statusCycle,
  mondayOf,
  toIsoDate,
  weekContaining,
  weekdayIndex,
  type AgendaChange,
  type AgendaItem,
  type AgendaWeek,
  type SemesterLayout,
  type AgendaItemType,
  type AgendaStatus,
  type SharedAgenda,
  type SharedAgendaCourse,
} from "../domain/agenda";
import { CYCLE_SEMESTERS, baseCourseCode, cycleOf, describeLectureMix, getPlacementSemesters } from "../domain/courseGroups";
import { ALL_SEMESTERS, type AppTab, type Course, type CourseKind, type Cycle, type PlannedLecture, type Semester, type StudyPlan } from "../types";
import type { CloudSync } from "../sync/cloudSync";
import { createSyncPanel } from "../sync/syncUi";
import { Heading } from "./heading";
import { TimetableGrid, formatHours } from "./timetableGrid";

interface ExtraCurriculumAddOption {
  key: string;
  label: string;
}

export interface CurriculumCourse {
  id: string;
  course: Course;
  studyPlans: StudyPlan[];
}

export interface OptionalCourseGroup {
  groupName: string;
  courses: CurriculumCourse[];
}

export interface OptionalSemesterGroup {
  semester: Semester;
  groups: OptionalCourseGroup[];
}

/** A course in the user's plan: it lives in at most one semester (null = waiting in its plan's box) and can be disabled. */
export interface PlannerCourse {
  id: string;
  course: Course;
  studyPlan: StudyPlan;
  kind: CourseKind;
  originSemester: Semester;
  semester: Semester | null;
  validSemesters: Semester[];
  enabled: boolean;
  // Set when several sections of the course (MATH-101(e), MATH-101(en)...) were merged into this entry.
  variantGroupKey?: string;
  variants?: Array<{ id: string; course: Course }>;
}

/** One semester of the agenda, with the plan's courses for that semester (for the course picker). */
export interface AgendaData {
  semester: string;
  academicYear: number;
  season: Season;
  planSemester: Semester | null;
  start: string;
  isDefaultStart: boolean;
  layout: SemesterLayout;
  items: AgendaItem[];
  courses: Array<{ code: string; name: string }>;
}

export interface TimetableWidgetData {
  activeCycle: Cycle;
  // Main study of the active cycle and the studies it can be picked from.
  mainStudies: Record<Cycle, { options: string[]; value: string }>;
  // Autumn of the year the user started BA1, and where that puts them today.
  startYear: number;
  startYearRange: [number, number];
  studyPosition: StudyPosition;
  semesters: Semester[];
  activeSemester: Semester;
  activeTab: AppTab;
  plannerCourses: PlannerCourse[];
  // Courses counted in the summary strip; falls back to the courses of the planned lectures.
  summaryCourses?: Course[];
  extraCurriculumAddOptions: ExtraCurriculumAddOption[];
  timetableTabAddOptions: ExtraCurriculumAddOption[];
  timetableTabSelectedItems: Array<{ key: string; label: string }>;
  optionalSemesterGroups: OptionalSemesterGroup[];
  collapsedOptionalSemesters: string[];
  curriculumPaneScrollTop: Record<string, number>;
  plannedLectures: PlannedLecture[];
  conflictSlotBlocks: ConflictSlotBlock[];
  planColorByKey: Record<string, string>;
  onChangeMainStudy: (cycle: Cycle, mainStudyName: string) => void;
  onChangeStartYear: (year: number) => void;
  onChangeCycle: (cycle: Cycle) => void;
  onChangeSemester: (semester: Semester) => void;
  onChangeTab: (tab: AppTab) => void;
  onAddExtraCurriculumItem: (itemKey: string) => void;
  onAddTimetableTabItem: (itemKey: string) => void;
  onRemoveTimetableTabItem: (itemKey: string) => void;
  onToggleOptionalCourse: (courseId: string) => void;
  onToggleCourseEnabled: (courseId: string) => void;
  onMoveCourse: (courseId: string, semester: Semester) => void;
  onUnplaceCourse: (courseId: string) => void;
  onRemoveCourse: (courseId: string) => void;
  onChooseVariant: (groupKey: string, courseId: string) => void;
  // Courses corrected by hand, by course id.
  courseEdits: Record<string, CourseEditInfo>;
  onSaveCourseEdit: (courseId: string, values: EditableCourseValues) => void;
  onResetCourseEdit: (courseId: string) => void;
  onRemoveStudyPlan: (planKey: string) => void;
  onOpenSemesterSchedule: (semester: Semester) => void;
  // Back from the schedule to the study plan, scrolled to the semester (and a course in it, if given).
  onShowInPlan: (semester: Semester) => void;
  // Account sync, when Supabase is set up (null otherwise).
  cloudSync: CloudSync | null;
  // The semester shown in the Agenda tab, and the current one (for My studies).
  agenda: AgendaData;
  currentAgenda: AgendaData;
  onAgendaAdd: (items: Array<Omit<AgendaItem, "id">>) => void;
  onAgendaUpdate: (id: string, patch: Partial<Omit<AgendaItem, "id">>) => void;
  onAgendaRemove: (id: string) => void;
  // Several additions, edits and removals at once (recurring groups, imports, clearing a course).
  onAgendaChange: (change: AgendaChange) => void;
  onAgendaSetStart: (iso: string | null) => void;
  onAgendaShiftSemester: (offset: number) => void;
  onToggleOptionalSemesterOpen: (semester: Semester, open: boolean) => void;
  onCurriculumPaneScroll: (paneKey: string, scrollTop: number) => void;
}

type CurriculumPaneKey = "optional" | "extra";

/** Phones: one day at a time in the schedule, no drag and drop, plan and catalog on separate panes. */
export const COMPACT_SCREEN_QUERY = "(max-width: 720px)";
const isCompactScreen = (): boolean => typeof window !== "undefined" && window.matchMedia(COMPACT_SCREEN_QUERY).matches;

// Agenda view state (per session): course filter, hiding finished items, the last type added.
let agendaCourseFilter = "";
let agendaHideFinished = false;
let agendaFormType: AgendaItemType = "series";
// Calendar (what is due when) or Courses (each course's workload, where items are added).
let agendaView: "weeks" | "courses" = "weeks";
// Phones: the calendar day whose items are listed under the grid.
let agendaSelectedDay: string | null = null;
// Recurring groups unfolded in the Courses view, and a course to scroll to once it opens.
const agendaOpenGroups = new Set<string>();
let agendaFocusCourse: string | null = null;
// Series and labs are due on a weekday (0 = Monday ... 6 = Sunday), every teaching week or in a single week.
// The last choices are remembered per type; series default to every week, labs to a single week.
const agendaWeekday: Record<"series" | "lab", number> = { series: 6, lab: 6 };
const agendaRecurrence: Record<"series" | "lab", "every" | "once"> = { series: "every", lab: "once" };
const isWeekly = (type: AgendaItemType): type is "series" | "lab" => type === "series" || type === "lab";
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// The current week is scrolled into view once when the Agenda opens, not on every re-render.
let agendaScrolledTo: string | null = null;

interface AgendaCourseEntry {
  code: string;
  name: string;
  items: AgendaItem[];
}

const AGENDA_TYPE_ICONS: Record<AgendaItemType, string> = {
  series: "fa-list-ol",
  lab: "fa-flask",
  midterm: "fa-pen-to-square",
  final: "fa-graduation-cap",
  note: "fa-note-sticky",
};

const createSelect = (options: Array<{ value: string; label: string }>): HTMLSelectElement => {
  const element = document.createElement("select");
  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    element.appendChild(node);
  });
  return element;
};

/** By date (undated last), then time, then title. Sorts in place. */
const sortAgendaItems = (list: AgendaItem[]): AgendaItem[] => list.sort((a, b) =>
  (a.date || "9999").localeCompare(b.date || "9999") || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, undefined, { numeric: true }));

/** "14 series · 2 labs · 1 midterm". */
const summarizeAgendaItems = (items: ReadonlyArray<{ type: AgendaItemType }>): string => {
  const plural: Record<AgendaItemType, string> = { series: "series", lab: "labs", midterm: "midterms", final: "finals", note: "notes" };
  return (Object.keys(AGENDA_TYPE_LABELS) as AgendaItemType[])
    .map((type) => {
      const count = items.filter((item) => item.type === type).length;
      return count === 0 ? "" : `${count} ${count === 1 ? AGENDA_TYPE_LABELS[type].toLowerCase() : plural[type]}`;
    })
    .filter(Boolean)
    .join(" · ");
};

/** Series and labs ticked off (done or corrected) out of all of them. */
const agendaProgress = (items: AgendaItem[]): { done: number; total: number } => {
  const tracked = items.filter((item) => hasStatus(item.type));
  return { done: tracked.filter((item) => item.status !== "todo").length, total: tracked.length };
};

/** Series and labs: "due Thursday · 23:59 · week 3"; exams and notes: their date. */
const describeAgendaWhen = (item: AgendaItem, weeks: AgendaWeek[]): string => {
  if (!item.date) {
    return "date not set";
  }
  const time = item.time ? ` · ${item.time}` : "";
  const week = hasStatus(item.type) ? weekContaining(weeks, item.date) : undefined;
  return week
    ? `due ${WEEKDAYS[weekdayIndex(item.date)]}${time}${week.number ? ` · week ${week.number}` : ""}`
    : `${hasStatus(item.type) ? "due " : ""}${formatDay(item.date)}${time}`;
};

/** "Series" and 1 when every title is "Series <n>" (items sorted by date), else null. */
const numberedStem = (items: AgendaItem[]): { stem: string; first: number; last: number } | null => {
  const matches = items.map((item) => /^(.*?)\s*(\d+)$/.exec(item.title));
  if (matches.length === 0 || matches.some((match) => !match || match[1] !== matches[0]![1])) {
    return null;
  }
  return { stem: matches[0]![1], first: Number(matches[0]![2]), last: Number(matches[matches.length - 1]![2]) };
};

/** [1, 2, 3, 5, 7, 8] -> "1–3, 5, 7–8". */
const compressRanges = (numbers: number[]): string => {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const from = sorted[index];
    while (index + 1 < sorted.length && sorted[index + 1] === sorted[index] + 1) {
      index += 1;
    }
    parts.push(from === sorted[index] ? `${from}` : `${from}–${sorted[index]}`);
  }
  return parts.join(", ");
};

/** A recurring group in one line: "Series 1–14" and "every week · due Thursday 23:59". */
const describeAgendaGroup = (items: AgendaItem[], weeks: AgendaWeek[]): { title: string; when: string } => {
  const sorted = sortAgendaItems([...items]);
  const stem = numberedStem(sorted);
  const title = stem
    ? `${stem.stem} ${stem.first === stem.last ? stem.first : `${stem.first}–${stem.last}`}`.trim()
    : `${sorted.length} × ${AGENDA_TYPE_LABELS[sorted[0].type]}`;
  const numbers = sorted
    .map((item) => (item.date ? weekContaining(weeks, item.date)?.number : null))
    .filter((number): number is number => typeof number === "number");
  const teaching = weeks.filter((week) => week.number !== null).length;
  const distinct = new Set(numbers).size;
  const weeksText = distinct === teaching && numbers.length === sorted.length
    ? "every week"
    : numbers.length > 0 ? `week${distinct === 1 ? "" : "s"} ${compressRanges(numbers)}` : "";
  const days = new Set(sorted.map((item) => (item.date ? weekdayIndex(item.date) : -1)));
  const day = days.size === 1 && !days.has(-1) ? `due ${WEEKDAYS[[...days][0]]}` : "due on different days";
  const times = new Set(sorted.map((item) => item.time));
  const time = times.size === 1 && sorted[0].time ? ` ${sorted[0].time}` : "";
  return { title, when: [weeksText, `${day}${time}`].filter(Boolean).join(" · ") };
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

/**
 * Click (or tap) runs `onClick`; right click, a long press on touch screens or the keyboard's menu key runs
 * `onMenu`. Clicks inside an element marked `data-press-ignore` (its own buttons) are left alone.
 */
const bindPress = (element: HTMLElement, onClick: () => void, onMenu: () => void): void => {
  let timer: number | null = null;
  let start: { x: number; y: number } | null = null;
  // When the menu last opened: the click (or contextmenu) that ends a long press must not act again.
  let menuAt = 0;
  const ignored = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest("[data-press-ignore]") !== null && element.contains(target.closest("[data-press-ignore]"));
  const cancel = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    start = null;
  };
  const openMenu = (): void => {
    cancel();
    if (Date.now() - menuAt < 800) {
      return;
    }
    menuAt = Date.now();
    onMenu();
  };

  element.addEventListener("pointerdown", (event) => {
    // Mice use the right button; touch and pens get the long press.
    if (event.pointerType === "mouse" || event.button !== 0 || ignored(event.target)) {
      return;
    }
    cancel();
    start = { x: event.clientX, y: event.clientY };
    timer = window.setTimeout(() => {
      timer = null;
      navigator.vibrate?.(12);
      // Lifting the finger sends a click to whatever is now under it (the dialog that just opened): drop it.
      const swallow = (click: Event): void => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 1000);
      openMenu();
    }, LONG_PRESS_MS);
  });
  element.addEventListener("pointermove", (event) => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) {
      cancel();
    }
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => element.addEventListener(type, () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }));
  element.addEventListener("contextmenu", (event) => {
    if (ignored(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openMenu();
  });
  element.addEventListener("click", (event) => {
    if (ignored(event.target)) {
      return;
    }
    event.stopPropagation();
    if (Date.now() - menuAt < 800) {
      return;
    }
    onClick();
  });
};

/** "Mon 5 Oct" (or "5 Oct" without the weekday). */
const formatDay = (iso: string, withWeekday = true): string =>
  fromIsoDate(iso).toLocaleDateString(undefined, withWeekday ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });

// One color per course. Courses of the semester get distinct colors by their position in its course list;
// anything else (a course no longer in the plan) falls back to a hash of its code.
const COURSE_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0f766e", "#ea580c", "#4f46e5", "#65a30d", "#0891b2"];
const courseColor = (key: string, semesterCourses: ReadonlyArray<{ code: string }> = []): string => {
  if (!key) {
    return "#98a1b3";
  }
  const position = semesterCourses.findIndex((course) => course.code === key);
  if (position >= 0) {
    return COURSE_COLORS[position % COURSE_COLORS.length];
  }
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return COURSE_COLORS[hash % COURSE_COLORS.length];
};

// Compact screens only: which pane of the study plan is shown, and which day of the schedule.
let mobilePlanPane: "board" | "add" = "board";
let activeMobileDay = Math.min(4, Math.max(0, new Date().getDay() - 1));

// Survives re-renders (the widget is rebuilt on every state change).
let activeCurriculumPane: CurriculumPaneKey = "optional";

// What drop targets need to know about the course being dragged (a plan card or a catalog card).
interface DraggedCourse {
  id: string;
  // Stable across variant switches; matches the card's data-anchor-key.
  anchorKey: string;
  kind: CourseKind;
  semester: Semester | null;
  validSemesters: Semester[];
  planKey: string;
}

// dataTransfer can't be read during dragover, so drop targets check this instead.
let draggedCourse: DraggedCourse | null = null;

/**
 * Every change re-renders the page, which can move the course the user just touched (it changed list or semester).
 * Before the change we note where that course was on screen; after the render we scroll so it is there again.
 */
interface ScrollAnchor {
  key: string;
  scope: CardScope;
  top: number;
}

// Where a course card is rendered; the same course can appear in several places at once.
type CardScope = "board" | "box" | "list" | "optional";

let pendingScrollAnchor: ScrollAnchor | null = null;

// Set when switching from the schedule to the plan: what to scroll to and highlight once it is rendered.
interface PendingFocus {
  semester: Semester;
  courseId?: string;
}

let pendingFocus: PendingFocus | null = null;

const findScrollParent = (element: HTMLElement): HTMLElement | null => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
};

// Plan board rows: each study year pairs an autumn (odd) and a spring (even) semester.
const PLAN_YEARS: ReadonlyArray<{ cycle: Cycle; label: string; semesters: [Semester, Semester] }> = [
  { cycle: "bachelor", label: "Year 1", semesters: ["BA1", "BA2"] },
  { cycle: "bachelor", label: "Year 2", semesters: ["BA3", "BA4"] },
  { cycle: "bachelor", label: "Year 3", semesters: ["BA5", "BA6"] },
  { cycle: "master", label: "Year 1", semesters: ["MA1", "MA2"] },
  { cycle: "master", label: "Year 2", semesters: ["MA3", "MA4"] },
];

const CYCLE_LABELS: Record<Cycle, string> = {
  bachelor: "Bachelor",
  master: "Master",
};

const COURSE_KIND_LABELS: Record<CourseKind, string> = {
  mandatory: "Mandatory",
  optional: "Optional",
  extra: "Extra",
};

// A timetable period is a 45-minute slot (0 = 08:15-09:00).
const PERIOD_MINUTES = 45;

interface StatItem {
  label: string;
  value: string;
  unit: string;
  alert?: boolean;
}

const TAB_TITLES: Record<AppTab, string> = {
  studies: "My studies",
  agenda: "Agenda",
  planner: "Planner",
  schedule: "Planner",
  timetable: "Explore",
};

const TAB_ICONS: Record<AppTab, string> = {
  studies: "fa-user-graduate",
  agenda: "fa-list-check",
  planner: "fa-graduation-cap",
  schedule: "fa-graduation-cap",
  timetable: "fa-compass",
};

const TAB_SUBTITLES: Partial<Record<AppTab, string>> = {
  studies: "Your current semester at a glance.",
  agenda: "Series, labs, exams and notes, week by week.",
  timetable: "Search any study plan, course or room and see its weekly timetable.",
};

interface ScheduleSummary {
  courses: number;
  credits: number;
  occupiedPeriods: number;
  dayPeriods: number[];
  conflicts: number;
}

export class TimetableWidget {
  private static readonly MODAL_FADE_DURATION_MS = 180;

  private static normalizeSearchValue(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
  }

  private static fuzzyScore(candidate: string, query: string): number {
    const cleanQuery = TimetableWidget.normalizeSearchValue(query.trim());
    if (!cleanQuery) {
      return 0;
    }

    const cleanCandidate = TimetableWidget.normalizeSearchValue(candidate);
    if (cleanCandidate === cleanQuery) {
      return 1000;
    }

    if (cleanCandidate.startsWith(cleanQuery)) {
      return 800 - cleanCandidate.length;
    }

    if (cleanCandidate.includes(cleanQuery)) {
      return 600 - cleanCandidate.length;
    }

    const queryTokens = cleanQuery.split(/\s+/).filter(Boolean);
    const candidateTokens = cleanCandidate.split(/\s+/).filter(Boolean);
    let tokenMatches = 0;
    queryTokens.forEach((token) => {
      if (candidateTokens.some((candidateToken) => candidateToken.startsWith(token))) {
        tokenMatches += 1;
      }
    });
    if (tokenMatches > 0) {
      return 500 + tokenMatches * 10 - candidateTokens.length;
    }

    let streak = 0;
    let candidateIndex = 0;
    for (let index = 0; index < cleanQuery.length; index += 1) {
      const char = cleanQuery[index];
      const foundIndex = cleanCandidate.indexOf(char, candidateIndex);
      if (foundIndex === -1) {
        return -1;
      }
      if (foundIndex === candidateIndex) {
        streak += 1;
      }
      candidateIndex = foundIndex + 1;
    }

    return 300 + Math.min(20, streak * 4) - cleanCandidate.length;
  }

  private static filterOptions<T extends { label: string }>(options: T[], query: string): T[] {
    const cleanQuery = TimetableWidget.normalizeSearchValue(query.trim());
    if (!cleanQuery) {
      return [...options];
    }

    return options
        .map((option) => ({ option, score: TimetableWidget.fuzzyScore(option.label, cleanQuery) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score || a.option.label.localeCompare(b.option.label))
        .map((entry) => entry.option);
  }

  private static semesterRank(semester: Semester): number {
    const level = Number.parseInt(semester.slice(2), 10);
    const cycleOffset = semester.startsWith("MA") ? 100 : 0;
    return cycleOffset + level;
  }

  public constructor(
      private readonly data: TimetableWidgetData,
      private readonly model: TimetableModel,
      private readonly config: TimetableConfig = timetableConfig,
  ) {}

  public render(): HTMLElement {
    const periods = this.model.buildPeriods();
    const tab = this.data.activeTab;
    const summary = this.buildSummary();

    const shell = document.createElement("div");
    shell.className = "app-shell";

    let sidebarToggle: HTMLButtonElement | null = null;
    const setSidebarOpen = (open: boolean): void => {
      shell.classList.toggle("sidebar-open", open);
      if (sidebarToggle) {
        sidebarToggle.setAttribute("aria-expanded", `${open}`);
      }
    };

    const sidebar = this.createSidebar(() => setSidebarOpen(false));
    sidebar.id = "app-sidebar";

    const sidebarBackdrop = document.createElement("button");
    sidebarBackdrop.type = "button";
    sidebarBackdrop.className = "app-sidebar-backdrop";
    sidebarBackdrop.setAttribute("aria-label", "Close menu");
    sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));

    const content = document.createElement("div");
    content.className = "app-content";

    const widget = document.createElement("section");
    widget.className = "timetable-widget";

    const heading = new Heading(
        TAB_TITLES[tab],
        tab === "planner" ? this.describePlan() : TAB_SUBTITLES[tab] ?? this.config.subtitleTemplate(summary.courses),
        TAB_ICONS[tab],
    ).render();

    const topBar = document.createElement("div");
    topBar.className = "timetable-topbar";

    sidebarToggle = document.createElement("button");
    sidebarToggle.type = "button";
    sidebarToggle.className = "sidebar-toggle";
    sidebarToggle.setAttribute("aria-label", "Toggle menu");
    sidebarToggle.setAttribute("aria-controls", "app-sidebar");
    sidebarToggle.setAttribute("aria-expanded", "false");
    sidebarToggle.addEventListener("click", () => {
      setSidebarOpen(!shell.classList.contains("sidebar-open"));
    });

    const toggleIcon = document.createElement("i");
    toggleIcon.className = "fa-solid fa-bars";
    toggleIcon.setAttribute("aria-hidden", "true");

    const toggleLabel = document.createElement("span");
    toggleLabel.className = "sidebar-toggle-label";
    toggleLabel.textContent = "Menu";

    sidebarToggle.appendChild(toggleIcon);
    sidebarToggle.appendChild(toggleLabel);

    topBar.appendChild(sidebarToggle);
    topBar.appendChild(heading);
    if (tab === "planner" || tab === "schedule") {
      topBar.appendChild(this.createPlannerViewSwitch());
    }

    const workspace = document.createElement("div");
    workspace.className = "workspace";
    const compact = isCompactScreen();
    if (tab === "planner" && compact) {
      workspace.classList.add(mobilePlanPane === "add" ? "mobile-show-side" : "mobile-show-main");
    }

    const main = document.createElement("div");
    main.className = "workspace-main";

    const side = document.createElement("div");
    side.className = "workspace-side";

    if (tab !== "agenda") {
      agendaScrolledTo = null;
    }

    if (tab === "studies") {
      workspace.classList.add("workspace-single");
      main.appendChild(this.createStudiesDashboard(periods, summary));
    } else if (tab === "agenda") {
      if (compact) {
        // Phones: the course list (where items are added) sits above the agenda, the view settings below it.
        main.append(this.createAgendaCourseList(), this.createAgendaMain(), this.createAgendaSettings());
      } else {
        main.appendChild(this.createAgendaMain());
        side.append(this.createAgendaCourseList(), this.createAgendaSettings());
      }
    } else if (tab === "planner") {
      // Planning first: the whole curriculum by semester, with the course catalog beside it.
      main.appendChild(this.createPlanBoard());
      side.appendChild(this.createCurriculumSection());
    } else {
      main.appendChild(this.createScheduleCard(periods, summary));
      side.appendChild(tab === "schedule" ? this.createSemesterCoursesPanel() : this.createTimetableTabPanel());
    }

    workspace.appendChild(main);
    if (tab !== "studies") {
      workspace.appendChild(side);
    }

    widget.appendChild(topBar);
    // My studies shows its own figures inside the dashboard.
    if (tab !== "studies") {
      widget.appendChild(
        tab === "planner"
          ? this.createStatStrip(this.buildPlanStats())
          : tab === "agenda"
            ? this.createStatStrip(this.createAgendaStats())
            : this.createSummaryStrip(summary),
      );
    }
    if (tab === "planner" && compact) {
      widget.appendChild(this.createMobilePaneSwitch(workspace));
    }
    widget.appendChild(workspace);

    content.appendChild(widget);
    shell.appendChild(sidebar);
    shell.appendChild(sidebarBackdrop);
    shell.appendChild(content);

    return shell;
  }

  private createMobilePaneSwitch(workspace: HTMLElement): HTMLElement {
    const switcher = document.createElement("div");
    switcher.className = "mobile-pane-switch";
    switcher.setAttribute("role", "tablist");

    const waiting = this.data.plannerCourses.filter((entry) => entry.kind === "extra" && entry.semester === null).length;
    const panes: Array<{ key: typeof mobilePlanPane; label: string }> = [
      { key: "board", label: "Semesters" },
      { key: "add", label: waiting > 0 ? `Add courses · ${waiting} to place` : "Add courses" },
    ];

    const buttons = panes.map((pane) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "tab");
      button.textContent = pane.label;
      button.addEventListener("click", () => {
        mobilePlanPane = pane.key;
        workspace.classList.toggle("mobile-show-main", pane.key === "board");
        workspace.classList.toggle("mobile-show-side", pane.key === "add");
        buttons.forEach((other, index) => {
          const selected = panes[index].key === pane.key;
          other.classList.toggle("active", selected);
          other.setAttribute("aria-selected", `${selected}`);
        });
        window.scrollTo({ top: switcher.offsetTop - 8 });
      });
      const selected = pane.key === mobilePlanPane;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", `${selected}`);
      switcher.appendChild(button);
      return button;
    });

    return switcher;
  }

  private buildSummary(): ScheduleSummary {
    const courses = new Map<string, Course>();
    const occupied = new Set<string>();
    const dayPeriods = this.config.days.map(() => 0);

    this.data.plannedLectures.forEach((plannedLecture) => {
      const course = plannedLecture.lecture.course;
      courses.set(course.abbreviation, course);

      // Count each occupied slot once so overlapping lectures don't inflate class time.
      const safe = this.model.clampLecture(plannedLecture.lecture);
      for (let period = safe.timeStart; period < safe.timeEnd; period += 1) {
        const slotKey = `${safe.day}:${period}`;
        if (occupied.has(slotKey)) {
          continue;
        }
        occupied.add(slotKey);
        if (safe.day < dayPeriods.length) {
          dayPeriods[safe.day] += 1;
        }
      }
    });

    // Courses without a timetable (projects, internships...) still count towards the semester.
    if (this.data.summaryCourses) {
      courses.clear();
      this.data.summaryCourses.forEach((course) => courses.set(course.abbreviation, course));
    }

    let credits = 0;
    courses.forEach((course) => {
      credits += course.credits;
    });

    return {
      courses: courses.size,
      credits,
      occupiedPeriods: occupied.size,
      dayPeriods,
      conflicts: this.data.conflictSlotBlocks.length,
    };
  }

  private createSummaryStrip(summary: ScheduleSummary): HTMLElement {
    return this.createStatStrip([
      { label: "Courses", value: `${summary.courses}`, unit: summary.courses === 1 ? "course" : "courses" },
      { label: "Credits", value: `${summary.credits}`, unit: "ECTS" },
      {
        label: "Class time",
        value: formatHours((summary.occupiedPeriods * PERIOD_MINUTES) / 60),
        unit: "h per week",
      },
      {
        label: "Conflicts",
        value: `${summary.conflicts}`,
        unit: summary.conflicts === 1 ? "overlap" : "overlaps",
        alert: summary.conflicts > 0,
      },
    ]);
  }

  /** Totals over the active cycle (bachelor or master), shown above the plan board. */
  private buildPlanStats(): StatItem[] {
    const inCycle = this.coursesInCycle(this.data.activeCycle);
    const enabled = inCycle.filter((entry) => entry.enabled);
    const credits = enabled.reduce((total, entry) => total + (entry.course.credits ?? 0), 0);
    const moved = inCycle.filter((entry) => entry.kind !== "extra" && entry.semester !== entry.originSemester).length;
    const mandatoryLeftOut = inCycle.filter((entry) => entry.kind === "mandatory" && !entry.enabled).length;

    return [
      { label: `${CYCLE_LABELS[this.data.activeCycle]} credits`, value: `${credits}`, unit: "ECTS" },
      { label: "Courses", value: `${enabled.length}`, unit: `of ${inCycle.length} placed` },
      { label: "Moved", value: `${moved}`, unit: moved === 1 ? "course rescheduled" : "courses rescheduled" },
      {
        label: "Mandatory left out",
        value: `${mandatoryLeftOut}`,
        unit: mandatoryLeftOut === 1 ? "course" : "courses",
        alert: mandatoryLeftOut > 0,
      },
    ];
  }

  private describePlan(): string {
    const cycle = CYCLE_LABELS[this.data.activeCycle].toLowerCase();
    return isCompactScreen()
      ? `Your ${cycle} in ${this.data.mainStudies[this.data.activeCycle].value}. Move a course with the semester menu on its card.`
      : `Your ${cycle} in ${this.data.mainStudies[this.data.activeCycle].value}. Drag a course to another semester of the same season, or load courses from other plans.`;
  }

  private createStatStrip(items: StatItem[]): HTMLElement {
    const strip = document.createElement("dl");
    strip.className = "summary-strip";

    items.forEach((item) => {
      const cell = document.createElement("div");
      cell.className = "summary-item";
      if (item.alert) {
        cell.classList.add("has-conflict");
      }

      const label = document.createElement("dt");
      label.className = "summary-label";
      label.textContent = item.label;

      const figure = document.createElement("dd");
      figure.className = "summary-figure";

      const value = document.createElement("span");
      value.className = "summary-value";
      value.textContent = item.value;

      const unit = document.createElement("span");
      unit.className = "summary-unit";
      unit.textContent = item.unit;

      figure.appendChild(value);
      figure.appendChild(unit);
      cell.appendChild(label);
      cell.appendChild(figure);
      strip.appendChild(cell);
    });

    return strip;
  }

  private createScheduleCard(periods: Period[], summary: ScheduleSummary): HTMLElement {
    const card = document.createElement("section");
    card.className = "schedule-card";
    card.setAttribute("aria-label", "Weekly schedule");

    const header = document.createElement("div");
    header.className = "schedule-card-header";

    const title = document.createElement("h2");
    title.className = "schedule-card-title";
    title.textContent = "Weekly schedule";
    header.appendChild(title);

    if (this.data.activeTab === "schedule") {
      header.appendChild(this.createSemesterTabs());

      const toPlan = document.createElement("button");
      toPlan.type = "button";
      toPlan.className = "view-link";
      toPlan.title = `Show ${this.data.activeSemester} in the study plan`;
      toPlan.innerHTML = '<i class="fa-solid fa-graduation-cap" aria-hidden="true"></i><span>Study plan</span>';
      toPlan.addEventListener("click", () => {
        pendingFocus = { semester: this.data.activeSemester };
        this.data.onShowInPlan(this.data.activeSemester);
      });
      header.appendChild(toPlan);
    }

    const dayLoads = summary.dayPeriods.map((count) => (count * PERIOD_MINUTES) / 60);
    // Five columns don't fit a phone: show one day, picked with chips, and put it in the only column.
    const singleDay = isCompactScreen() ? activeMobileDay : null;
    if (singleDay !== null) {
      header.appendChild(this.createDayChips(dayLoads));
    }
    const shownDays = singleDay === null ? this.config.days : [this.config.days[singleDay]];
    const shownLoads = singleDay === null ? dayLoads : [dayLoads[singleDay] ?? 0];
    const toColumn = (day: number): number => (singleDay === null ? day : 0);
    const isShown = (day: number): boolean => singleDay === null || day === singleDay;

    // The grid sets its sizes inline, so the phone layout is passed here rather than in CSS.
    const layout = singleDay === null
      ? this.config.layout
      : { ...this.config.layout, timeColumnWidthPx: 62, dayColumnMinWidthPx: 0, headerRowHeightPx: 40, periodRowHeightPx: 60 };
    const grid = new TimetableGrid(shownDays, periods, layout, shownLoads);
    const gridElement = grid.render();
    const lectureLayouts = this.model.buildLectureLayouts(this.data.plannedLectures);

    this.data.conflictSlotBlocks.forEach((block) => {
      if (isShown(block.day)) {
        grid.appendLectureBlock(this.createConflictSlotOverlay({ ...block, day: toColumn(block.day) }, grid));
      }
    });

    this.data.plannedLectures.forEach((plannedLecture) => {
      const safeLecture = this.model.clampLecture(plannedLecture.lecture);
      if (safeLecture.timeEnd <= safeLecture.timeStart || !isShown(safeLecture.day)) {
        return;
      }

      const lectureLayout = lectureLayouts.get(plannedLecture.id);
      const placed = { ...safeLecture, day: toColumn(safeLecture.day) as typeof safeLecture.day };
      grid.appendLectureBlock(
          this.createLectureBlock({ ...plannedLecture, lecture: placed }, grid, lectureLayout?.laneIndex ?? 0, lectureLayout?.laneCount ?? 1),
      );
    });

    if (singleDay !== null && !this.data.plannedLectures.some((planned) => planned.lecture.day === singleDay)) {
      gridElement.classList.add("empty-day");
    }

    const gridContainer = document.createElement("div");
    gridContainer.className = "timetable-scroll";
    gridContainer.appendChild(gridElement);

    card.appendChild(header);
    card.appendChild(gridContainer);
    card.appendChild(this.createLegend());
    return card;
  }

  private createDayChips(dayLoads: number[]): HTMLElement {
    const chips = document.createElement("div");
    chips.className = "day-chips";
    chips.setAttribute("role", "tablist");
    chips.setAttribute("aria-label", "Day");

    this.config.days.forEach((day, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "day-chip";
      chip.setAttribute("role", "tab");
      chip.setAttribute("aria-selected", `${index === activeMobileDay}`);
      chip.classList.toggle("active", index === activeMobileDay);

      const name = document.createElement("span");
      name.textContent = day.slice(0, 3);
      const load = document.createElement("small");
      load.textContent = dayLoads[index] > 0 ? `${formatHours(dayLoads[index])} h` : "free";
      chip.append(name, load);

      chip.addEventListener("click", () => {
        if (index !== activeMobileDay) {
          activeMobileDay = index;
          this.data.onChangeSemester(this.data.activeSemester); // re-render with the new day
        }
      });
      chips.appendChild(chip);
    });

    return chips;
  }

  private createLegend(): HTMLElement {
    const legend = document.createElement("ul");
    legend.className = "schedule-legend";

    const items = [
      { cls: "course", label: "Course" },
      { cls: "exercise", label: "Exercise" },
      { cls: "lab", label: "Lab" },
      { cls: "conflict", label: "Time conflict" },
    ];

    items.forEach((item) => {
      const entry = document.createElement("li");
      entry.className = "legend-item";

      const swatch = document.createElement("span");
      swatch.className = `legend-swatch ${item.cls}`;
      swatch.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.textContent = item.label;

      entry.appendChild(swatch);
      entry.appendChild(label);
      legend.appendChild(entry);
    });

    const note = document.createElement("li");
    note.className = "legend-note";
    note.textContent = "The coloured left edge shows which study plan a lecture comes from.";
    legend.appendChild(note);

    return legend;
  }

  private createSidebar(onNavigate?: () => void): HTMLElement {
    const sidebar = document.createElement("aside");
    sidebar.className = "app-sidebar";

    const brand = document.createElement("div");
    brand.className = "sidebar-brand";

    const brandMark = document.createElement("div");
    brandMark.className = "sidebar-brand-mark";
    // Same mark as public/favicon.svg: semester tiles (years x autumn/spring) with a path through them.
    brandMark.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><defs><linearGradient id="brand-mark-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b6cf0"/><stop offset="1" stop-color="#2b39a8"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#brand-mark-bg)"/><g fill="#fff"><rect x="6.5" y="6.5" width="8.5" height="5" rx="1.6"/><rect x="17" y="6.5" width="8.5" height="5" rx="1.6" opacity=".32"/><rect x="6.5" y="13.5" width="8.5" height="5" rx="1.6" opacity=".32"/><rect x="17" y="13.5" width="8.5" height="5" rx="1.6"/><rect x="6.5" y="20.5" width="8.5" height="5" rx="1.6"/><rect x="17" y="20.5" width="8.5" height="5" rx="1.6" opacity=".32"/></g><path d="M12.5 11.5 L19.5 13.5 M19.5 18.5 L12.5 20.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".85"/></svg>`;

    const brandCopy = document.createElement("div");
    brandCopy.className = "sidebar-brand-copy";
    brandCopy.innerHTML = "<strong>My Studies</strong><span>EPFL study planner</span>";

    brand.appendChild(brandMark);
    brand.appendChild(brandCopy);
    sidebar.appendChild(brand);

    const nav = document.createElement("nav");
    nav.className = "app-sidebar-nav";
    nav.setAttribute("aria-label", "Main");

    // Planner covers both the study plan and the weekly schedule views.
    const options: Array<{ tab: AppTab; label: string; iconClass: string; covers: AppTab[] }> = [
      { tab: "studies", label: "My studies", iconClass: TAB_ICONS.studies, covers: ["studies"] },
      { tab: "planner", label: "Planner", iconClass: TAB_ICONS.planner, covers: ["planner", "schedule"] },
      { tab: "agenda", label: "Agenda", iconClass: TAB_ICONS.agenda, covers: ["agenda"] },
      { tab: "timetable", label: "Explore", iconClass: TAB_ICONS.timetable, covers: ["timetable"] },
    ];

    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sidebar-tab";
      const isActive = option.covers.includes(this.data.activeTab);
      button.setAttribute("aria-pressed", `${isActive}`);

      if (isActive) {
        button.classList.add("active");
      }

      const icon = document.createElement("i");
      icon.className = `fa-solid ${option.iconClass}`;
      icon.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "sidebar-tab-label";
      label.textContent = option.label;

      button.appendChild(icon);
      button.appendChild(label);

      button.addEventListener("click", () => {
        if (!isActive) {
          this.data.onChangeTab(option.tab);
        }
        onNavigate?.();
      });

      nav.appendChild(button);
    });

    sidebar.appendChild(nav);
    sidebar.appendChild(this.createStudySettings());
    if (this.data.cloudSync) {
      sidebar.appendChild(createSyncPanel(this.data.cloudSync));
    } else {
      const note = document.createElement("p");
      note.className = "sidebar-note";
      note.textContent = "Your selections are saved in this browser.";
      sidebar.appendChild(note);
    }

    return sidebar;
  }

  private createTimetableTabPanel(): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "timetable-tab-panel side-panel";

    const heading = document.createElement("h3");
    heading.className = "timetable-tab-title";

    const headingIcon = document.createElement("i");
    headingIcon.className = "fa-solid fa-layer-group panel-title-icon";
    headingIcon.setAttribute("aria-hidden", "true");

    const headingText = document.createElement("span");
    headingText.textContent = "Timetable catalog";

    heading.appendChild(headingIcon);
    heading.appendChild(headingText);

    const addRow = document.createElement("div");
    addRow.className = "extra-curriculum-add-row";

    const addLabel = document.createElement("label");
    addLabel.className = "extra-curriculum-add-label";
    addLabel.setAttribute("for", "timetable-tab-dropdown");

    const addLabelIcon = document.createElement("i");
    addLabelIcon.className = "fa-solid fa-circle-plus";
    addLabelIcon.setAttribute("aria-hidden", "true");

    const addLabelText = document.createElement("span");
    addLabelText.textContent = "Add to timetable";

    addLabel.appendChild(addLabelIcon);
    addLabel.appendChild(addLabelText);

    const combo = document.createElement("div");
    combo.className = "extra-curriculum-combobox";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "extra-curriculum-dropdown";
    input.id = "timetable-tab-dropdown";
    input.placeholder = "Search plan, course, or room...";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");

    const optionsList = document.createElement("div");
    optionsList.className = "extra-curriculum-options";
    optionsList.setAttribute("role", "listbox");

    let isOpen = false;
    let activeIndex = -1;
    let filtered = [...this.data.timetableTabAddOptions];
    let isPositioned = false;

    const ensureOptionsMounted = (): void => {
      if (!document.body.contains(optionsList)) {
        document.body.appendChild(optionsList);
      }
    };

    const detachOptions = (): void => {
      if (document.body.contains(optionsList)) {
        optionsList.remove();
      }
    };

    const updateOptionsPosition = (): void => {
      const rect = input.getBoundingClientRect();
      optionsList.style.left = `${rect.left}px`;
      optionsList.style.top = `${rect.bottom + 4}px`;
      optionsList.style.width = `${rect.width}px`;
    };

    const bindFloatingListeners = (): void => {
      if (isPositioned) {
        return;
      }
      isPositioned = true;
      window.addEventListener("resize", updateOptionsPosition);
      window.addEventListener("scroll", updateOptionsPosition, true);
    };

    const unbindFloatingListeners = (): void => {
      if (!isPositioned) {
        return;
      }
      isPositioned = false;
      window.removeEventListener("resize", updateOptionsPosition);
      window.removeEventListener("scroll", updateOptionsPosition, true);
    };

    const renderOptions = (): void => {
      optionsList.replaceChildren();

      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "extra-curriculum-option-empty";
        empty.textContent = "No matching course or plan";
        optionsList.appendChild(empty);
        return;
      }

      let lastPrefix = "";
      filtered.forEach((option, index) => {
        let prefix = "Courses";
        if (option.label.startsWith("Plan:")) {
          prefix = "Plans";
        } else if (option.label.startsWith("Room:")) {
          prefix = "Rooms";
        }
        if (prefix !== lastPrefix) {
          const header = document.createElement("div");
          header.className = "extra-curriculum-option-group";
          header.textContent = prefix;
          optionsList.appendChild(header);
          lastPrefix = prefix;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "extra-curriculum-option";
        if (index === activeIndex) {
          button.classList.add("active");
        }
        button.textContent = option.label;

        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          input.value = "";
          this.data.onAddTimetableTabItem(option.key);
        });

        optionsList.appendChild(button);
      });
    };

    const openOptions = (): void => {
      isOpen = true;
      combo.classList.add("open");
      optionsList.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      ensureOptionsMounted();
      updateOptionsPosition();
      bindFloatingListeners();
      renderOptions();
    };

    const closeOptions = (): void => {
      isOpen = false;
      combo.classList.remove("open");
      optionsList.classList.remove("open");
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
      unbindFloatingListeners();
      detachOptions();
    };

    const updateFilter = (): void => {
      filtered = TimetableWidget.filterOptions(this.data.timetableTabAddOptions, input.value);
      activeIndex = filtered.length > 0 ? 0 : -1;
      if (isOpen) {
        renderOptions();
      }
    };

    input.addEventListener("focus", () => {
      updateFilter();
      openOptions();
    });

    input.addEventListener("input", () => {
      updateFilter();
      openOptions();
    });

    input.addEventListener("keydown", (event) => {
      if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        updateFilter();
        openOptions();
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filtered.length > 0) {
          activeIndex = (activeIndex + 1 + filtered.length) % filtered.length;
          renderOptions();
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length > 0) {
          activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
          renderOptions();
        }
      } else if (event.key === "Enter") {
        if (isOpen && activeIndex >= 0 && filtered[activeIndex]) {
          event.preventDefault();
          input.value = "";
          this.data.onAddTimetableTabItem(filtered[activeIndex].key);
        }
      } else if (event.key === "Escape") {
        closeOptions();
      }
    });

    combo.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!combo.contains(document.activeElement) && !optionsList.contains(document.activeElement)) {
          closeOptions();
        }
      }, 0);
    });

    combo.appendChild(input);
    combo.appendChild(optionsList);

    addRow.appendChild(addLabel);
    addRow.appendChild(combo);

    const selection = document.createElement("div");
    selection.className = "timetable-tab-selection";

    if (this.data.timetableTabSelectedItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "timetable-tab-empty";
      empty.textContent = "Nothing added yet. Search above to add a study plan, a course or a room.";
      selection.appendChild(empty);
    } else {
      this.data.timetableTabSelectedItems.forEach((item) => {
        const row = document.createElement("div");
        row.className = "timetable-tab-selection-row";

        const label = document.createElement("span");
        label.className = "timetable-tab-selection-label";
        label.textContent = item.label;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "timetable-tab-selection-remove";
        remove.setAttribute("aria-label", `Remove ${item.label}`);
        remove.title = "Remove";

        const removeIcon = document.createElement("i");
        removeIcon.className = "fa-solid fa-xmark";
        removeIcon.setAttribute("aria-hidden", "true");
        remove.appendChild(removeIcon);
        remove.addEventListener("click", () => this.data.onRemoveTimetableTabItem(item.key));

        row.appendChild(label);
        row.appendChild(remove);
        selection.appendChild(row);
      });
    }

    panel.appendChild(heading);
    panel.appendChild(addRow);
    panel.appendChild(selection);

    return panel;
  }

  private createLectureBlock(
      plannedLecture: PlannedLecture,
      grid: TimetableGrid,
      laneIndex: number,
      laneCount: number,
  ): HTMLElement {
    const { lecture, studyPlans } = plannedLecture;
    const planColor = this.resolvePlanColor(studyPlans);
    const planBorder = this.resolvePlanBorder(studyPlans);
    const lectureSpan = this.model.lectureSpan(lecture);
    const isSinglePeriod = lectureSpan === 1;
    const lectureBlock = document.createElement("article");
    lectureBlock.className = `lecture ${lecture.type}`;
    if (planColor) {
      lectureBlock.style.setProperty("--plan-color", planColor);
    }
    if (planBorder) {
      lectureBlock.style.setProperty("--plan-border", planBorder);
    }

    if (laneCount > 1) {
      lectureBlock.classList.add("compact");
    }

    if (isSinglePeriod) {
      lectureBlock.classList.add("single-period");
    }

    if (studyPlans.length > 1) {
      lectureBlock.classList.add("merged");
    }

    if (plannedLecture.kind) {
      lectureBlock.classList.add(`kind-${plannedLecture.kind}`);
    }

    lectureBlock.style.setProperty("--lecture-lane-index", `${laneIndex}`);
    lectureBlock.style.setProperty("--lecture-lane-count", `${Math.max(1, laneCount)}`);
    lectureBlock.style.gridColumn = grid.getGridColumn(lecture.day);
    lectureBlock.style.gridRow = `${grid.getGridRowStart(lecture.timeStart)} / span ${lectureSpan}`;
    lectureBlock.ariaLabel = this.buildLectureTitle(plannedLecture);

    const abbreviation = document.createElement("div");
    abbreviation.className = "lecture-abbreviation";
    abbreviation.textContent = lecture.course.abbreviation;

    const name = document.createElement("div");
    name.className = "lecture-name";
    name.textContent = lecture.course.name;

    const meta = document.createElement("div");
    meta.className = "lecture-meta";

    const type = document.createElement("span");
    type.className = "lecture-type";
    type.textContent = lecture.type;
    meta.appendChild(type);

    // Mandatory is the default, so only flag the courses the user chose.
    if (plannedLecture.kind && plannedLecture.kind !== "mandatory") {
      const kind = document.createElement("span");
      kind.className = `lecture-kind kind-${plannedLecture.kind}`;
      kind.textContent = COURSE_KIND_LABELS[plannedLecture.kind];
      meta.appendChild(kind);
    }

    const rooms = (lecture.room ?? []).join(", ");
    if (rooms) {
      const room = document.createElement("span");
      room.className = "lecture-room";
      room.textContent = rooms;
      room.title = rooms;
      meta.appendChild(room);
    }

    lectureBlock.appendChild(abbreviation);
    lectureBlock.appendChild(name);
    lectureBlock.appendChild(meta);
    const overlay = this.createCourseOverlay(plannedLecture, lectureBlock);
    lectureBlock.appendChild(overlay);

    const linkToCourse = lecture.course.linkToCourse.trim();
    if (isCompactScreen()) {
      lectureBlock.classList.add("clickable");
      lectureBlock.tabIndex = 0;
      lectureBlock.setAttribute("role", "button");
      lectureBlock.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest(".lecture-course-overlay")) {
          return;
        }
        TimetableWidget.openLectureSheet(overlay, lectureBlock);
      });
    } else if (linkToCourse.length > 0) {
      lectureBlock.classList.add("clickable");
      lectureBlock.tabIndex = 0;
      lectureBlock.setAttribute("role", "button");
      lectureBlock.addEventListener("keydown", (event) => {
        if (event.target === lectureBlock && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          this.openCourseModal(linkToCourse, `${lecture.course.abbreviation} - ${lecture.course.name}`);
        }
      });
      lectureBlock.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".lecture-course-overlay")) {
          return;
        }

        this.openCourseModal(linkToCourse, `${lecture.course.abbreviation} - ${lecture.course.name}`);
      });
    }

    return lectureBlock;
  }

  /** Phones: the hover card becomes a bottom sheet, closed by tapping anywhere else. */
  private static openLectureSheet(overlay: HTMLElement, lectureBlock: HTMLElement): void {
    document.querySelectorAll(".lecture-course-overlay.visible").forEach((open) => open.classList.remove("visible"));
    overlay.classList.add("visible", "sheet");
    lectureBlock.classList.add("overlay-active");

    const close = (event: Event): void => {
      if (overlay.contains(event.target as Node)) {
        return;
      }
      overlay.classList.remove("visible", "sheet");
      lectureBlock.classList.remove("overlay-active");
      document.removeEventListener("pointerdown", close, true);
    };
    // Registered after this tap so it doesn't close the sheet right away.
    window.setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }

  private buildLectureTitle(plannedLecture: PlannedLecture): string {
    const { lecture, studyPlans } = plannedLecture;
    const plans = studyPlans.map((studyPlan) => `${studyPlan.semester} - ${studyPlan.name}`).join(" | ");
    return `${lecture.course.abbreviation} - ${lecture.course.name} (${lecture.type})${plans ? `\n${plans}` : ""}`;
  }

  private createCourseOverlay(plannedLecture: PlannedLecture, lectureBlock: HTMLElement): HTMLElement {
    const { course } = plannedLecture.lecture;
    const overlay = document.createElement("aside");
    overlay.className = "lecture-course-overlay";

    const title = document.createElement("div");
    title.className = "lecture-course-overlay-title";
    title.textContent = `${course.abbreviation} - ${course.name}`;

    const teacher = document.createElement("div");
    teacher.className = "lecture-course-overlay-row";
    teacher.textContent = `Teacher: ${course.teacher}`;

    const credits = document.createElement("div");
    credits.className = "lecture-course-overlay-row";
    credits.textContent = `Credits: ${course.credits}`;

    const group = document.createElement("div");
    group.className = "lecture-course-overlay-row";
    group.textContent = plannedLecture.kind
      ? `${COURSE_KIND_LABELS[plannedLecture.kind]} · ${course.group}`
      : `Group: ${course.group}`;

    const mix = document.createElement("div");
    mix.className = "lecture-course-overlay-row";
    mix.textContent = `Weekly: ${describeLectureMix(course)}${course.language ? ` · ${course.language}` : ""}`;
    if (course.timetableOutdated) {
      mix.textContent += " · timetable from the previous scrape";
    }

    const link = document.createElement("a");
    link.className = "lecture-course-overlay-link";
    link.href = course.linkToCourse;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Course page";

    overlay.appendChild(title);
    overlay.appendChild(teacher);
    overlay.appendChild(credits);
    overlay.appendChild(group);
    overlay.appendChild(mix);
    const overlayActions = document.createElement("div");
    overlayActions.className = "lecture-course-overlay-actions";
    overlayActions.appendChild(link);
    const plan = plannedLecture.studyPlans[0];
    if (plan) {
      const courseId = `${this.toPlanKey(plan)}|${course.abbreviation}|${course.name}`;
      const edit = this.createEditButton(courseId, course);
      edit.classList.add("labelled");
      edit.insertAdjacentText("beforeend", " Edit");
      overlayActions.appendChild(edit);

      if (this.data.activeTab === "schedule") {
        const showInPlan = document.createElement("button");
        showInPlan.type = "button";
        showInPlan.className = "course-edit-button labelled";
        showInPlan.title = "Show this course in the study plan";
        showInPlan.innerHTML = '<i class="fa-solid fa-graduation-cap" aria-hidden="true"></i> In plan';
        showInPlan.addEventListener("click", (event) => {
          event.stopPropagation();
          pendingFocus = { semester: this.data.activeSemester, courseId };
          this.data.onShowInPlan(this.data.activeSemester);
        });
        overlayActions.appendChild(showInPlan);
      }
    }
    overlay.appendChild(overlayActions);

    let hoverTimer: number | null = null;
    let hideTimer: number | null = null;

    const clearTimers = (): void => {
      if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
      }

      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    const scheduleHideOverlay = (): void => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }

      hideTimer = window.setTimeout(() => {
        clearTimers();
        overlay.classList.remove("visible");
        lectureBlock.classList.remove("overlay-active");
      }, 220);
    };

    const showOverlay = (): void => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }

      if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
      }

      hoverTimer = window.setTimeout(() => {
        const offset = 10;
        const popupWidth = 300;
        const popupHeight = 190;
        const rect = lectureBlock.getBoundingClientRect();
        const maxLeft = Math.max(offset, window.innerWidth - popupWidth - offset);
        const maxTop = Math.max(offset, window.innerHeight - popupHeight - offset);
        const left = Math.min(maxLeft, rect.right + offset);
        const top = Math.min(maxTop, rect.top);

        overlay.style.setProperty("--overlay-left", `${left}px`);
        overlay.style.setProperty("--overlay-top", `${top}px`);
        overlay.classList.add("visible");
        lectureBlock.classList.add("overlay-active");
        hoverTimer = null;
      }, 1000);
    };

    lectureBlock.addEventListener("mouseenter", showOverlay);
    lectureBlock.addEventListener("mouseleave", scheduleHideOverlay);
    overlay.addEventListener("mouseenter", showOverlay);
    overlay.addEventListener("mouseleave", scheduleHideOverlay);

    return overlay;
  }

  private createEditButton(courseId: string, course: Course, beforeOpen?: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "course-edit-button";
    button.title = "Correct this course's data";
    button.setAttribute("aria-label", `Edit ${course.abbreviation}`);
    button.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      beforeOpen?.();
      this.openCourseEditor(courseId, course);
    });
    return button;
  }

  /**
   * Manual correction of a course whose scraped data is outdated (rooms, times, teacher, credits...).
   * Saved edits are applied on top of the scraped data in this browser and can be reset at any time.
   */
  private openCourseEditor(courseId: string, course: Course): void {
    if (document.querySelector(".course-edit-backdrop")) {
      return;
    }

    const periods = this.model.buildPeriods();
    // The plan part of the id ("BA3:info") is the plan whose group/optional flag is being edited.
    const plan = (courseId.split("|")[0] ?? "").replace(":", " ");
    const editInfo = this.data.courseEdits[courseId];
    const editedAt = editInfo?.editedAt;
    const slots: LectureSlot[] = course.lectures.map((lecture) => ({
      type: lecture.type,
      day: lecture.day,
      timeStart: lecture.timeStart,
      timeEnd: lecture.timeEnd,
      room: [...(lecture.room ?? [])],
    }));

    const backdrop = document.createElement("div");
    backdrop.className = "course-link-modal-backdrop course-edit-backdrop";

    const form = document.createElement("form");
    form.className = "course-edit-modal";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-labelledby", "course-edit-title");
    form.noValidate = true;

    // Header
    const header = document.createElement("header");
    header.className = "course-link-modal-header";

    const titleBlock = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "course-link-modal-title";
    title.id = "course-edit-title";
    title.textContent = `Edit ${course.abbreviation} - ${course.name}`;
    const status = document.createElement("p");
    status.className = "course-edit-status";
    status.textContent = editedAt
      ? `Corrected on ${new Date(editedAt).toLocaleDateString()} · the scraped data is kept and can be restored`
      : "Showing the scraped data · your changes are saved in this browser";

    const scopeNote = document.createElement("p");
    scopeNote.className = "course-edit-scope";
    const strong = (text: string): HTMLElement => {
      const element = document.createElement("strong");
      element.textContent = text;
      return element;
    };
    scopeNote.append(
      strong("Teacher, credits and timetable"),
      " are fixed for this course in every study plan that lists it. ",
      strong("Group and optional"),
      ` only change for ${plan}.`,
    );
    titleBlock.appendChild(title);
    titleBlock.appendChild(status);
    titleBlock.appendChild(scopeNote);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "course-link-modal-close";
    closeButton.textContent = "Close";

    header.appendChild(titleBlock);
    header.appendChild(closeButton);

    // Course fields
    const body = document.createElement("div");
    body.className = "course-edit-body";

    const fields = document.createElement("div");
    fields.className = "course-edit-fields";

    const makeField = (labelText: string, input: HTMLInputElement): HTMLLabelElement => {
      const label = document.createElement("label");
      label.className = "course-edit-field";
      const caption = document.createElement("span");
      caption.textContent = labelText;
      label.appendChild(caption);
      label.appendChild(input);
      return label;
    };

    const teacherInput = document.createElement("input");
    teacherInput.type = "text";
    teacherInput.value = course.teacher;

    const creditsInput = document.createElement("input");
    creditsInput.type = "number";
    creditsInput.min = "0";
    creditsInput.step = "1";
    creditsInput.value = course.credits === null || course.credits === undefined ? "" : `${course.credits}`;

    const groupInput = document.createElement("input");
    groupInput.type = "text";
    groupInput.value = course.group;

    fields.appendChild(makeField("Teacher", teacherInput));
    fields.appendChild(makeField("Credits (ECTS)", creditsInput));
    const groupField = makeField("Group", groupInput);
    groupField.classList.add("wide");
    fields.appendChild(groupField);

    const optionalLabel = document.createElement("label");
    optionalLabel.className = "course-edit-check wide";
    const optionalInput = document.createElement("input");
    optionalInput.type = "checkbox";
    optionalInput.checked = course.isOptional;
    const optionalText = document.createElement("span");
    optionalText.innerHTML = "<strong>Optional</strong> in its study plan (only in your plan once you add it). Untick for a mandatory course.";
    optionalLabel.appendChild(optionalInput);
    optionalLabel.appendChild(optionalText);
    fields.appendChild(optionalLabel);

    // Lecture slots
    const slotsSection = document.createElement("section");
    slotsSection.className = "course-edit-slots";

    const slotsHeader = document.createElement("div");
    slotsHeader.className = "course-edit-slots-header";
    const slotsTitle = document.createElement("h4");
    slotsTitle.textContent = "Weekly timetable";
    const addSlot = document.createElement("button");
    addSlot.type = "button";
    addSlot.className = "course-edit-add";
    addSlot.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> Add slot';
    slotsHeader.appendChild(slotsTitle);
    slotsHeader.appendChild(addSlot);

    const slotRows = document.createElement("div");
    slotRows.className = "course-edit-slot-rows";

    const makeSelect = (options: Array<{ value: number | string; label: string }>, selected: number | string, label: string): HTMLSelectElement => {
      const select = document.createElement("select");
      select.setAttribute("aria-label", label);
      options.forEach((option) => {
        const element = document.createElement("option");
        element.value = `${option.value}`;
        element.textContent = option.label;
        element.selected = `${option.value}` === `${selected}`;
        select.appendChild(element);
      });
      return select;
    };

    const typeOptions = [
      { value: "course", label: "Lecture" },
      { value: "exercise", label: "Exercise" },
      { value: "lab", label: "Lab" },
    ];
    const dayOptions = this.config.days.map((day, index) => ({ value: index, label: day }));
    const startOptions = periods.map((period) => ({ value: period.index, label: period.startLabel }));
    const endOptions = periods.map((period) => ({ value: period.index + 1, label: period.endLabel }));

    const renderSlots = (): void => {
      slotRows.replaceChildren();

      if (slots.length === 0) {
        const empty = document.createElement("p");
        empty.className = "course-edit-empty";
        empty.textContent = "No timetable slots (e.g. a project or an internship).";
        slotRows.appendChild(empty);
        return;
      }

      slots.forEach((slot, index) => {
        const row = document.createElement("div");
        row.className = "course-edit-slot";

        const type = makeSelect(typeOptions, slot.type, "Type");
        type.addEventListener("change", () => {
          slot.type = type.value as LectureSlot["type"];
        });

        const day = makeSelect(dayOptions, slot.day, "Day");
        day.addEventListener("change", () => {
          slot.day = Number(day.value) as LectureSlot["day"];
        });

        const start = makeSelect(startOptions, slot.timeStart, "Starts");
        const end = makeSelect(endOptions, slot.timeEnd, "Ends");
        start.addEventListener("change", () => {
          slot.timeStart = Number(start.value);
          // Keep the slot at least one period long.
          if (slot.timeEnd <= slot.timeStart) {
            slot.timeEnd = slot.timeStart + 1;
            end.value = `${slot.timeEnd}`;
          }
        });
        end.addEventListener("change", () => {
          slot.timeEnd = Number(end.value);
        });

        const rooms = document.createElement("input");
        rooms.type = "text";
        rooms.placeholder = "Rooms, comma separated";
        rooms.setAttribute("aria-label", "Rooms");
        rooms.value = slot.room.join(", ");
        rooms.addEventListener("input", () => {
          slot.room = rooms.value.split(",").map((room) => room.trim()).filter(Boolean);
        });

        const dash = document.createElement("span");
        dash.className = "course-edit-dash";
        dash.textContent = "–";

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "plan-course-remove";
        remove.title = "Remove this slot";
        remove.setAttribute("aria-label", "Remove this slot");
        remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        remove.addEventListener("click", () => {
          slots.splice(index, 1);
          renderSlots();
        });

        row.append(type, day, start, dash, end, rooms, remove);
        slotRows.appendChild(row);
      });
    };

    addSlot.addEventListener("click", () => {
      const last = slots[slots.length - 1];
      slots.push({ type: "course", day: last?.day ?? 0, timeStart: 0, timeEnd: 2, room: [] });
      renderSlots();
    });

    renderSlots();
    slotsSection.appendChild(slotsHeader);
    slotsSection.appendChild(slotRows);

    const error = document.createElement("p");
    error.className = "course-edit-error";
    error.setAttribute("role", "alert");

    body.appendChild(fields);
    body.appendChild(slotsSection);

    const linkToCourse = course.linkToCourse.trim();
    if (linkToCourse) {
      const source = document.createElement("a");
      source.className = "course-edit-source";
      source.href = linkToCourse;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      source.innerHTML = 'Compare with the coursebook <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>';
      body.appendChild(source);
    }
    body.appendChild(error);

    // Footer
    const footer = document.createElement("footer");
    footer.className = "course-edit-footer";

    if (editedAt) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "course-edit-reset";
      reset.textContent = "Reset to scraped data";
      reset.addEventListener("click", () => {
        const scope = editInfo?.sharedWithOtherPlans ? " This also restores it in the other study plans that list it." : "";
        if (window.confirm(`Discard your corrections to ${course.abbreviation} and use the scraped data again?${scope}`)) {
          closeModal();
          this.data.onResetCourseEdit(courseId);
        }
      });
      footer.appendChild(reset);
    }

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "course-link-modal-close";
    cancel.textContent = "Cancel";

    const save = document.createElement("button");
    save.type = "submit";
    save.className = "course-edit-save";
    save.textContent = "Save changes";

    footer.appendChild(cancel);
    footer.appendChild(save);

    form.appendChild(header);
    form.appendChild(body);
    form.appendChild(footer);
    backdrop.appendChild(form);
    document.body.appendChild(backdrop);

    const closeModal = (): void => {
      backdrop.classList.remove("visible");
      window.removeEventListener("keydown", handleEscape);
      window.setTimeout(() => backdrop.remove(), TimetableWidget.MODAL_FADE_DURATION_MS);
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const credits = creditsInput.value.trim() === "" ? 0 : Number(creditsInput.value);
      if (!Number.isFinite(credits) || credits < 0) {
        error.textContent = "Credits must be a positive number.";
        creditsInput.focus();
        return;
      }
      if (slots.some((slot) => slot.timeEnd <= slot.timeStart)) {
        error.textContent = "Every slot must end after it starts.";
        return;
      }

      closeModal();
      this.data.onSaveCourseEdit(courseId, {
        teacher: teacherInput.value.trim(),
        credits,
        group: groupInput.value.trim(),
        isOptional: optionalInput.checked,
        lectures: slots.map((slot) => ({ ...slot, room: [...slot.room] })),
      });
    });

    closeButton.addEventListener("click", closeModal);
    cancel.addEventListener("click", closeModal);
    // No close on backdrop click: a stray click must not throw away edits.
    window.addEventListener("keydown", handleEscape);
    window.requestAnimationFrame(() => {
      backdrop.classList.add("visible");
      teacherInput.focus();
    });
  }

  private openCourseModal(url: string, title: string): void {
    const existing = document.querySelector(".course-link-modal-backdrop");
    if (existing) {
      return;
    }

    const backdrop = document.createElement("div");
    backdrop.className = "course-link-modal-backdrop";

    const modal = document.createElement("section");
    modal.className = "course-link-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", title);

    const header = document.createElement("header");
    header.className = "course-link-modal-header";

    const heading = document.createElement("h3");
    heading.className = "course-link-modal-title";
    heading.textContent = title;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "course-link-modal-close";
    closeButton.textContent = "Close";

    const frame = document.createElement("iframe");
    frame.className = "course-link-modal-frame";
    frame.src = url;
    frame.loading = "lazy";
    frame.referrerPolicy = "no-referrer";
    frame.title = title;

    header.appendChild(heading);
    header.appendChild(closeButton);
    modal.appendChild(header);
    modal.appendChild(frame);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const closeModal = (): void => {
      backdrop.classList.remove("visible");
      window.removeEventListener("keydown", handleEscape);
      window.setTimeout(() => backdrop.remove(), TimetableWidget.MODAL_FADE_DURATION_MS);
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    closeButton.addEventListener("click", closeModal);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeModal();
      }
    });

    window.addEventListener("keydown", handleEscape);
    window.requestAnimationFrame(() => backdrop.classList.add("visible"));
  }

  // ==================================================================================================
  // Agenda: series, labs, exams and notes of a semester, week by week or course by course
  // ==================================================================================================

  private createAgendaStats(): StatItem[] {
    const { items } = this.data.agenda;
    const today = toIsoDate(new Date());
    const sunday = addDays(mondayOf(today), 6);
    const open = items.filter((item) => !isFinished(item) && item.date);
    const dueThisWeek = open.filter((item) => item.date >= today && item.date <= sunday).length;
    const overdue = open.filter((item) => item.date < today).length;
    const series = items.filter((item) => item.type === "series");
    const seriesDone = series.filter((item) => item.status !== "todo").length;
    const nextExam = items
      .filter((item) => (item.type === "midterm" || item.type === "final") && item.date && item.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    return [
      { label: "Due this week", value: `${dueThisWeek}`, unit: dueThisWeek === 1 ? "item" : "items" },
      { label: "Overdue", value: `${overdue}`, unit: overdue === 1 ? "item" : "items", alert: overdue > 0 },
      { label: "Series done", value: `${seriesDone}`, unit: `of ${series.length}` },
      nextExam
        ? {
            label: "Next exam",
            value: `${daysBetween(today, nextExam.date)}`,
            unit: `days · ${nextExam.courseCode || nextExam.courseName} ${AGENDA_TYPE_LABELS[nextExam.type].toLowerCase()}`,
          }
        : { label: "Next exam", value: "–", unit: "none planned" },
    ];
  }

  /** Re-render with the current Agenda state (view, open groups...). */
  private rerenderAgenda(): void {
    this.data.onAgendaShiftSemester(0);
  }

  /**
   * The courses of the Agenda's semester with their items: the plan's courses first, then courses that only
   * have items (no longer in the plan), then "General" for items without a course.
   */
  private agendaCourseEntries(): AgendaCourseEntry[] {
    const { items, courses } = this.data.agenda;
    const entries: AgendaCourseEntry[] = courses.map((course) => ({ code: course.code, name: course.name, items: [] }));
    items.forEach((item) => {
      let entry = entries.find((candidate) => candidate.code === item.courseCode);
      if (!entry) {
        entry = { code: item.courseCode, name: item.courseCode ? item.courseName : "General", items: [] };
        entries.push(entry);
      }
      entry.items.push(item);
    });
    if (!entries.some((entry) => entry.code === "")) {
      entries.push({ code: "", name: "General", items: [] });
    }
    return entries.sort((a, b) => Number(a.code === "") - Number(b.code === ""));
  }

  private createAgendaMain(): HTMLElement {
    const { academicYear, season } = this.data.agenda;

    const card = document.createElement("section");
    card.className = "agenda-card";

    const header = document.createElement("div");
    header.className = "agenda-card-header";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.className = "agenda-nav";
    previous.setAttribute("aria-label", "Previous semester");
    previous.innerHTML = '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i>';
    previous.addEventListener("click", () => this.data.onAgendaShiftSemester(-1));
    const title = document.createElement("h2");
    title.className = "schedule-card-title";
    title.textContent = seasonLabel(season, academicYear);
    const next = document.createElement("button");
    next.type = "button";
    next.className = "agenda-nav";
    next.setAttribute("aria-label", "Next semester");
    next.innerHTML = '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
    next.addEventListener("click", () => this.data.onAgendaShiftSemester(1));
    const semesterName = document.createElement("span");
    semesterName.className = "agenda-plan-semester";
    semesterName.textContent = this.data.agenda.planSemester ? `your ${this.data.agenda.planSemester}` : "";

    // Calendar: what is due when. Courses: each course's workload, where items are added and edited in bulk.
    const switcher = document.createElement("div");
    switcher.className = "view-switch agenda-view-switch";
    switcher.setAttribute("role", "tablist");
    switcher.setAttribute("aria-label", "Agenda view");
    const views: Array<{ view: typeof agendaView; label: string; icon: string }> = [
      { view: "weeks", label: "Calendar", icon: "fa-calendar-days" },
      { view: "courses", label: "Courses", icon: "fa-book" },
    ];
    views.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "tab");
      const selected = agendaView === entry.view;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", `${selected}`);
      button.innerHTML = `<i class="fa-solid ${entry.icon}" aria-hidden="true"></i><span>${entry.label}</span>`;
      button.addEventListener("click", () => {
        if (!selected) {
          agendaView = entry.view;
          this.rerenderAgenda();
        }
      });
      switcher.appendChild(button);
    });

    header.append(previous, title, next, semesterName, switcher);
    card.appendChild(header);
    card.appendChild(agendaView === "weeks" ? this.createAgendaCalendar() : this.createAgendaCourseCards());
    return card;
  }

  /**
   * Calendar view: the semester as a grid, one row per week (Monday to Sunday) from week 1 to the end of the
   * exam session, with items as chips on their day. Phones show dots instead, and the tapped day's items
   * below the grid.
   */
  private createAgendaCalendar(): HTMLElement {
    const { items, layout } = this.data.agenda;
    const today = toIsoDate(new Date());
    const compact = isCompactScreen();
    const visible = items.filter((item) =>
      (!agendaCourseFilter || item.courseCode === agendaCourseFilter) && (!agendaHideFinished || !isFinished(item)),
    );

    // Range: the semester's weeks through the exam session, stretched (within reason) to items just outside it.
    const firstMonday = layout.weeks[0].monday;
    let lastSunday = layout.weeks[layout.weeks.length - 1].sunday;
    if (layout.exams && layout.exams.to > lastSunday) {
      lastSunday = addDays(mondayOf(layout.exams.to), 6);
    }
    let start = firstMonday;
    const dated = visible.filter((item) => item.date).map((item) => item.date).sort();
    if (dated.length > 0 && dated[0] < start && daysBetween(dated[0], start) <= 8 * 7) {
      start = mondayOf(dated[0]);
    }
    const latest = dated[dated.length - 1];
    if (latest && latest > lastSunday && daysBetween(lastSunday, latest) <= 8 * 7) {
      lastSunday = addDays(mondayOf(latest), 6);
    }

    const byDate = new Map<string, AgendaItem[]>();
    const unscheduled: AgendaItem[] = [];
    visible.forEach((item) => {
      if (item.date && item.date >= start && item.date <= lastSunday) {
        byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
      } else {
        unscheduled.push(item);
      }
    });

    // Days without courses: whole break weeks and bank holidays.
    const daysOff = new Map<string, string>();
    layout.weeks.forEach((week) => {
      if (week.number === null) {
        for (let day = 0; day < 5; day += 1) {
          daysOff.set(addDays(week.monday, day), week.breakName ?? "No courses");
        }
      }
      week.daysOff.forEach((day) => daysOff.set(day.date, day.name));
    });
    const inExams = (iso: string): boolean => Boolean(layout.exams && layout.exams.from <= iso && iso <= layout.exams.to);

    if (agendaSelectedDay === null || agendaSelectedDay < start || agendaSelectedDay > lastSunday) {
      agendaSelectedDay = today >= start && today <= lastSunday ? today : firstMonday;
    }

    // Phones: the selected day's items in full, opened right under its week.
    const buildDayPanel = (selected: string): HTMLElement => {
      const panel = document.createElement("section");
      panel.className = "agenda-day-panel inline";
      const panelHeader = document.createElement("header");
      const panelTitle = document.createElement("strong");
      panelTitle.textContent = fromIsoDate(selected).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      const add = document.createElement("button");
      add.type = "button";
      add.className = "course-edit-button labelled";
      add.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>Add</span>';
      add.addEventListener("click", () => this.openAgendaItemModal(agendaCourseFilter, undefined, selected));
      panelHeader.append(panelTitle, add);
      panel.appendChild(panelHeader);
      const off = daysOff.get(selected);
      if (off) {
        const offLine = document.createElement("p");
        offLine.className = "agenda-week-off";
        offLine.innerHTML = '<i class="fa-solid fa-umbrella-beach" aria-hidden="true"></i>';
        offLine.append(` ${off}: no courses`);
        panel.appendChild(offLine);
      }
      const dayItems = sortAgendaItems(byDate.get(selected) ?? []);
      if (dayItems.length > 0) {
        const list = document.createElement("ul");
        list.className = "agenda-items";
        dayItems.forEach((item) => list.appendChild(this.createAgendaRow(item, today)));
        panel.appendChild(list);
      } else {
        const empty = document.createElement("p");
        empty.className = "agenda-week-empty";
        empty.textContent = "Nothing on this day.";
        panel.appendChild(empty);
      }
      return panel;
    };

    const wrapper = document.createElement("div");
    wrapper.className = "agenda-calendar-wrap";
    const calendar = document.createElement("div");
    calendar.className = "agenda-calendar";

    const head = document.createElement("div");
    head.className = "agenda-cal-row agenda-cal-head";
    head.appendChild(document.createElement("span"));
    WEEKDAYS.forEach((name, index) => {
      const cell = document.createElement("span");
      cell.className = `agenda-cal-weekday${index >= 5 ? " weekend" : ""}`;
      cell.textContent = compact ? name.slice(0, 1) : name.slice(0, 3);
      cell.title = name;
      head.appendChild(cell);
    });
    calendar.appendChild(head);

    for (let monday = start; monday <= lastSunday; monday = addDays(monday, 7)) {
      const sunday = addDays(monday, 6);
      const week = layout.weeks.find((candidate) => candidate.monday === monday);
      const row = document.createElement("div");
      row.className = "agenda-cal-row agenda-cal-week";
      const isCurrent = monday <= today && today <= sunday;
      row.classList.toggle("current", isCurrent);
      row.classList.toggle("past", sunday < today);
      row.classList.toggle("break", week?.number === null);

      // Week label: teaching week number, break, exams, or nothing (holidays between the two).
      const label = document.createElement("div");
      label.className = "agenda-cal-label";
      if (week?.number) {
        label.innerHTML = `<small>${compact ? "W" : "week"}</small><strong>${week.number}</strong>`;
        label.title = `Week ${week.number}`;
      } else if (week) {
        label.innerHTML = '<i class="fa-solid fa-mug-hot" aria-hidden="true"></i>';
        label.title = week.breakName ?? "No courses";
      } else if (inExams(monday) || inExams(addDays(monday, 4)) || (layout.exams && layout.exams.from <= sunday && monday <= layout.exams.to)) {
        label.innerHTML = '<i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>';
        label.title = "Exam session";
        row.classList.add("exams");
      } else {
        label.classList.add("empty");
      }
      row.appendChild(label);

      for (let index = 0; index < 7; index += 1) {
        const iso = addDays(monday, index);
        const dayItems = sortAgendaItems(byDate.get(iso) ?? []);
        const off = daysOff.get(iso);
        const cell = document.createElement("div");
        cell.className = "agenda-cal-day";
        cell.classList.toggle("weekend", index >= 5);
        cell.classList.toggle("today", iso === today);
        cell.classList.toggle("off", Boolean(off));
        cell.classList.toggle("exam-day", inExams(iso) && index < 5);
        cell.classList.toggle("selected", compact && iso === agendaSelectedDay);
        cell.classList.toggle("has-open", dayItems.some((item) => !isFinished(item)));

        const date = fromIsoDate(iso);
        const top = document.createElement("div");
        top.className = "agenda-cal-date";
        const number = document.createElement("span");
        number.className = "agenda-cal-number";
        // The month is spelled out on its first day and on the first row.
        number.textContent = date.getDate() === 1 || monday === start
          ? (compact ? `${date.getDate()}` : date.toLocaleDateString(undefined, { day: "numeric", month: "short" }))
          : `${date.getDate()}`;
        top.appendChild(number);
        if (off && !compact && (week?.number !== null || index === 0)) {
          const name = document.createElement("span");
          name.className = "agenda-cal-off";
          name.textContent = off;
          name.title = off;
          top.appendChild(name);
        }
        cell.appendChild(top);

        if (compact) {
          // Phones: one dot per item, in its course color.
          if (dayItems.length > 0) {
            const dots = document.createElement("div");
            dots.className = "agenda-cal-dots";
            dayItems.slice(0, 4).forEach((item) => {
              const dot = document.createElement("span");
              dot.className = `agenda-cal-dot${isFinished(item) && hasStatus(item.type) ? " finished" : ""}${item.type === "midterm" || item.type === "final" ? " exam" : ""}`;
              dot.style.setProperty("--course-color", courseColor(item.courseCode || item.courseName, this.data.agenda.courses));
              dots.appendChild(dot);
            });
            cell.appendChild(dots);
          }
          // Selecting a day only swaps the panel: no re-render, so the page doesn't move.
          cell.addEventListener("click", () => {
            agendaSelectedDay = iso;
            calendar.querySelectorAll(".agenda-cal-day.selected").forEach((element) => element.classList.remove("selected"));
            cell.classList.add("selected");
            calendar.querySelector(".agenda-day-panel")?.remove();
            row.after(buildDayPanel(iso));
          });
        } else {
          dayItems.forEach((item) => cell.appendChild(this.createAgendaChip(item, today)));
          // Click on the empty part of a day: add something on that day.
          cell.title = `Add on ${formatDay(iso)}`;
          cell.addEventListener("click", (event) => {
            if (event.target === cell || event.target === top || event.target === number) {
              this.openAgendaItemModal(agendaCourseFilter, undefined, iso);
            }
          });
        }
        row.appendChild(cell);
      }
      calendar.appendChild(row);
      if (compact && agendaSelectedDay && mondayOf(agendaSelectedDay) === monday) {
        calendar.appendChild(buildDayPanel(agendaSelectedDay));
      }
    }
    wrapper.appendChild(calendar);

    // Finals without a date, and anything outside the calendar.
    if (unscheduled.length > 0) {
      const section = document.createElement("section");
      section.className = "agenda-day-panel agenda-unscheduled";
      const heading = document.createElement("header");
      const headingTitle = document.createElement("strong");
      headingTitle.textContent = "Not on the calendar";
      heading.appendChild(headingTitle);
      section.appendChild(heading);
      const list = document.createElement("ul");
      list.className = "agenda-items";
      sortAgendaItems(unscheduled).forEach((item) => list.appendChild(this.createAgendaRow(item, today)));
      section.appendChild(list);
      wrapper.appendChild(section);
    }

    // Open on the current week the first time the Agenda is shown for this semester.
    if (agendaScrolledTo !== this.data.agenda.semester) {
      agendaScrolledTo = this.data.agenda.semester;
      window.requestAnimationFrame(() => {
        const current = document.querySelector<HTMLElement>(".agenda-cal-week.current");
        if (current && current.getBoundingClientRect().bottom > window.innerHeight * 0.8) {
          current.scrollIntoView({ block: "center" });
        }
      });
    }
    return wrapper;
  }

  /** An item on the calendar: course code and title in the course color; the circle ticks series and labs off. */
  private createAgendaChip(item: AgendaItem, today: string): HTMLElement {
    const chip = document.createElement("div");
    chip.className = `agenda-chip type-${item.type} status-${item.status}`;
    chip.style.setProperty("--course-color", courseColor(item.courseCode || item.courseName, this.data.agenda.courses));
    chip.classList.toggle("overdue", !isFinished(item) && item.date !== "" && item.date < today);
    chip.classList.toggle("finished", hasStatus(item.type) && item.status !== "todo");
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
    const tracked = hasStatus(item.type);
    const statusLabels: Record<AgendaStatus, string> = { todo: "to do", done: item.type === "lab" ? "submitted" : "done", corrected: "corrected" };
    const next = statusLabels[statusCycle(item.type, item.status)];
    chip.title = [
      `${AGENDA_TYPE_LABELS[item.type]}: ${item.title}`,
      item.courseCode ? `${item.courseCode} – ${item.courseName}` : "",
      describeAgendaWhen(item, this.data.agenda.layout.weeks),
      item.details,
      tracked ? `Click: mark ${next} · Right click or long press: edit` : "Click: edit",
    ].filter(Boolean).join("\n");
    chip.setAttribute("aria-label", tracked
      ? `${item.title}, ${item.courseCode}: ${statusLabels[item.status]}. Press to mark ${next}; menu key to edit.`
      : `${AGENDA_TYPE_LABELS[item.type]}: ${item.title}. Press to edit.`);

    if (tracked) {
      const check = document.createElement("span");
      check.className = `agenda-chip-check ${item.status}`;
      check.innerHTML = `<i class="fa-solid ${item.status === "corrected" ? "fa-check-double" : "fa-check"}" aria-hidden="true"></i>`;
      chip.appendChild(check);
    } else {
      const icon = document.createElement("i");
      icon.className = `fa-solid ${AGENDA_TYPE_ICONS[item.type]} agenda-chip-icon`;
      icon.setAttribute("aria-hidden", "true");
      chip.appendChild(icon);
    }
    // Two lines: course code and time, then the title (or just the title for items without a course).
    const text = document.createElement("span");
    text.className = "agenda-chip-text";
    if (item.courseCode || item.time) {
      const first = document.createElement("span");
      first.className = "agenda-chip-line";
      const code = document.createElement("b");
      code.textContent = item.courseCode;
      first.appendChild(code);
      if (item.time) {
        const time = document.createElement("span");
        time.className = "agenda-chip-time";
        time.textContent = item.time;
        first.appendChild(time);
      }
      text.appendChild(first);
    }
    const titleLine = document.createElement("span");
    titleLine.className = "agenda-chip-title";
    titleLine.textContent = item.title;
    text.appendChild(titleLine);
    chip.appendChild(text);
    const edit = (): void => this.openAgendaItemModal(item.courseCode, item);
    const press = (): void => (tracked ? this.data.onAgendaUpdate(item.id, { status: statusCycle(item.type, item.status) }) : edit());
    bindPress(chip, press, edit);
    chip.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        press();
      }
    });
    return chip;
  }

  private createAgendaRow(
    item: AgendaItem,
    today: string,
    options: { courses?: ReadonlyArray<{ code: string }>; weeks?: AgendaWeek[]; showCourse?: boolean } = {},
  ): HTMLElement {
    const semesterCourses = options.courses ?? this.data.agenda.courses;
    const weeks = options.weeks ?? this.data.agenda.layout.weeks;
    const row = document.createElement("li");
    row.className = `agenda-item type-${item.type} status-${item.status}`;
    row.style.setProperty("--course-color", courseColor(item.courseCode || item.courseName, semesterCourses));
    const overdue = !isFinished(item) && item.date !== "" && item.date < today;
    row.classList.toggle("overdue", overdue);
    row.classList.toggle("finished", hasStatus(item.type) && item.status !== "todo");

    // A round check for series and labs (to do -> done -> corrected), a type icon for exams and notes.
    const statusLabels: Record<AgendaStatus, string> = {
      todo: "To do",
      done: item.type === "lab" ? "Submitted" : "Done",
      corrected: "Corrected",
    };
    if (hasStatus(item.type)) {
      const check = document.createElement("button");
      check.type = "button";
      check.className = `agenda-check ${item.status}`;
      check.innerHTML = `<i class="fa-solid ${item.status === "corrected" ? "fa-check-double" : "fa-check"}" aria-hidden="true"></i>`;
      const next = statusLabels[statusCycle(item.type, item.status)];
      check.title = `${statusLabels[item.status]} · click to mark "${next}"`;
      check.setAttribute("aria-label", `${item.title}: ${statusLabels[item.status]}. Mark as ${next}`);
      // The row's click toggles; the check is the keyboard way to do it (its click bubbles to the row).
      row.appendChild(check);
    } else {
      const icon = document.createElement("span");
      icon.className = "agenda-type-icon";
      icon.innerHTML = `<i class="fa-solid ${AGENDA_TYPE_ICONS[item.type]}" aria-hidden="true"></i>`;
      row.appendChild(icon);
    }

    const body = document.createElement("div");
    body.className = "agenda-item-body";

    const line = document.createElement("div");
    line.className = "agenda-item-line";
    const title = document.createElement("span");
    title.className = "agenda-item-title";
    title.textContent = item.title;
    line.appendChild(title);
    if ((options.showCourse ?? true) && (item.courseCode || item.courseName)) {
      const course = document.createElement("span");
      course.className = "agenda-course";
      course.textContent = item.courseCode || item.courseName;
      course.title = item.courseName;
      line.appendChild(course);
    }
    body.appendChild(line);

    const meta = document.createElement("div");
    meta.className = "agenda-item-meta";
    const when = document.createElement("span");
    when.innerHTML = `<i class="fa-regular ${item.type === "note" ? "fa-calendar" : "fa-clock"}" aria-hidden="true"></i>`;
    when.append(` ${describeAgendaWhen(item, weeks)}`);
    meta.appendChild(when);
    if (item.date && item.type !== "note" && !isFinished(item)) {
      const days = daysBetween(today, item.date);
      const relative = overdue ? "Overdue" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : days > 1 && days <= 14 ? `In ${days} days` : "";
      if (relative) {
        const pill = document.createElement("span");
        pill.className = `agenda-due${overdue ? " overdue" : days <= 2 ? " soon" : ""}`;
        pill.textContent = relative;
        meta.appendChild(pill);
      }
    }
    if (hasStatus(item.type) && item.status !== "todo") {
      const status = document.createElement("span");
      status.className = `agenda-status-label ${item.status}`;
      status.textContent = statusLabels[item.status];
      meta.appendChild(status);
    }
    if (item.details) {
      const details = document.createElement("span");
      details.className = "agenda-item-details";
      details.textContent = item.details;
      meta.appendChild(details);
    }
    body.appendChild(meta);
    row.appendChild(body);

    const type = document.createElement("span");
    type.className = "agenda-type";
    type.textContent = AGENDA_TYPE_LABELS[item.type];
    row.appendChild(type);

    const actions = document.createElement("div");
    actions.className = "agenda-item-actions";
    actions.dataset.pressIgnore = "";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "course-edit-button";
    editButton.title = "Edit";
    editButton.setAttribute("aria-label", `Edit ${item.title}`);
    editButton.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
    editButton.addEventListener("click", () => this.openAgendaItemModal(item.courseCode, item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "plan-course-remove";
    remove.title = "Delete";
    remove.setAttribute("aria-label", `Delete ${item.title}`);
    remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    remove.addEventListener("click", () => {
      if (window.confirm(`Delete "${item.title}"?`)) {
        this.data.onAgendaRemove(item.id);
      }
    });
    actions.append(editButton, remove);
    row.appendChild(actions);

    // Click toggles series and labs (opens exams and notes); right click or long press edits.
    const edit = (): void => this.openAgendaItemModal(item.courseCode, item);
    bindPress(row, () => (hasStatus(item.type) ? this.data.onAgendaUpdate(item.id, { status: statusCycle(item.type, item.status) }) : edit()), edit);
    row.title = hasStatus(item.type) ? "Click: tick off · Right click or long press: edit" : "Click: edit";
    return row;
  }

  /** Small icon button used on course cards and recurring groups. */
  private createAgendaIconButton(icon: string, label: string, onClick: () => void, className = "course-edit-button"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
    button.addEventListener("click", (event) => {
      // Inside a <summary>: act without folding or unfolding the group.
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  /** Sidebar: every course of the semester with what it holds; add to a course, share or import workloads. */
  private createAgendaCourseList(): HTMLElement {
    const { items, courses } = this.data.agenda;
    const card = document.createElement("section");
    card.className = "agenda-card";
    const heading = document.createElement("h3");
    heading.className = "studies-card-title";
    heading.innerHTML = '<i class="fa-solid fa-book" aria-hidden="true"></i>';
    heading.append("Courses");
    card.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "agenda-course-list";
    this.agendaCourseEntries().forEach((entry) => {
      const row = document.createElement("li");
      row.className = "agenda-course-row";
      row.style.setProperty("--course-color", courseColor(entry.code, courses));

      // Opens the course in the Courses view.
      const open = document.createElement("button");
      open.type = "button";
      open.className = "agenda-course-row-main";
      open.title = `Show ${entry.code || "general items"}`;
      const name = document.createElement("span");
      name.className = "agenda-course-row-name";
      const code = document.createElement("strong");
      code.textContent = entry.code || "General";
      name.appendChild(code);
      if (entry.code) {
        name.append(` ${entry.name}`);
      }
      const summary = document.createElement("span");
      summary.className = "agenda-course-row-summary";
      summary.textContent = summarizeAgendaItems(entry.items) || (entry.code ? "Nothing yet" : "Notes without a course");
      open.append(name, summary);
      open.addEventListener("click", () => {
        agendaView = "courses";
        agendaFocusCourse = entry.code;
        this.rerenderAgenda();
      });

      const progress = agendaProgress(entry.items);
      const count = document.createElement("span");
      count.className = "agenda-course-row-count";
      count.textContent = progress.total > 0 ? `${progress.done}/${progress.total}` : "";
      count.title = progress.total > 0 ? `${progress.done} of ${progress.total} series and labs done` : "";

      const add = this.createAgendaIconButton("fa-plus", `Add to ${entry.code || "General"}`, () => this.openAgendaItemModal(entry.code), "course-edit-button agenda-course-row-add");
      row.append(open, count, add);
      list.appendChild(row);
    });
    card.appendChild(list);

    const footer = document.createElement("div");
    footer.className = "agenda-share-actions";
    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "course-edit-button labelled";
    importButton.innerHTML = '<i class="fa-solid fa-file-import" aria-hidden="true"></i><span>Import</span>';
    importButton.addEventListener("click", () => this.openAgendaImportModal());
    const shareAll = document.createElement("button");
    shareAll.type = "button";
    shareAll.className = "course-edit-button labelled";
    shareAll.innerHTML = '<i class="fa-solid fa-share-nodes" aria-hidden="true"></i><span>Share all</span>';
    shareAll.disabled = items.length === 0;
    shareAll.addEventListener("click", () => this.openAgendaShareModal(null));
    footer.append(importButton, shareAll);
    card.appendChild(footer);
    return card;
  }

  /** Courses view: one card per course with its recurring series and labs, single items, and bulk actions. */
  private createAgendaCourseCards(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "agenda-courses";
    const entries = this.agendaCourseEntries().filter((entry) => !agendaCourseFilter || entry.code === agendaCourseFilter);
    entries.forEach((entry) => wrapper.appendChild(this.createAgendaCourseCard(entry)));

    if (agendaFocusCourse !== null) {
      const focus = agendaFocusCourse;
      agendaFocusCourse = null;
      window.requestAnimationFrame(() => {
        const target = [...document.querySelectorAll<HTMLElement>(".agenda-course-card")].find((element) => element.dataset.course === focus);
        if (target) {
          target.scrollIntoView({ block: "start", behavior: "smooth" });
          target.classList.add("flash");
          window.setTimeout(() => target.classList.remove("flash"), 1200);
        }
      });
    }
    return wrapper;
  }

  private createAgendaCourseCard(entry: AgendaCourseEntry): HTMLElement {
    const { courses } = this.data.agenda;
    const today = toIsoDate(new Date());
    const card = document.createElement("article");
    card.className = "agenda-course-card";
    card.dataset.course = entry.code;
    card.style.setProperty("--course-color", courseColor(entry.code, courses));

    const header = document.createElement("header");
    header.className = "agenda-course-card-header";
    // Tile with the code's prefix (MATH, AR...), then the name and a line with the code and what it holds.
    const tile = document.createElement("span");
    tile.className = "agenda-course-tile";
    if (entry.code) {
      tile.textContent = entry.code.split("-")[0].slice(0, 4);
    } else {
      tile.innerHTML = '<i class="fa-solid fa-thumbtack" aria-hidden="true"></i>';
    }
    const name = document.createElement("div");
    name.className = "agenda-course-card-name";
    const full = document.createElement("strong");
    full.textContent = entry.code ? entry.name : "General";
    const line = document.createElement("span");
    if (entry.code) {
      const code = document.createElement("span");
      code.className = "agenda-course";
      code.textContent = entry.code;
      line.appendChild(code);
    }
    line.append(entry.items.length > 0 ? summarizeAgendaItems(entry.items) : entry.code ? "" : "Notes and reminders without a course");
    name.append(full, line);

    const actions = document.createElement("div");
    actions.className = "agenda-course-card-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "course-edit-button labelled";
    add.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>Add</span>';
    add.addEventListener("click", () => this.openAgendaItemModal(entry.code));
    actions.appendChild(add);
    if (entry.items.length > 0) {
      actions.appendChild(this.createAgendaIconButton("fa-share-nodes", `Share ${entry.code || "general items"} as JSON`, () => this.openAgendaShareModal([entry.code])));
      actions.appendChild(this.createAgendaIconButton("fa-trash-can", `Delete everything in ${entry.code || "General"}`, () => {
        if (window.confirm(`Delete all ${entry.items.length} items of ${entry.code || "General"}?`)) {
          this.data.onAgendaChange({ remove: entry.items.map((item) => item.id) });
        }
      }, "plan-course-remove"));
    }
    header.append(tile, name, actions);
    card.appendChild(header);

    const progress = agendaProgress(entry.items);
    if (progress.total > 0) {
      const bar = document.createElement("div");
      bar.className = "agenda-progress";
      bar.title = `${progress.done} of ${progress.total} series and labs done`;
      const fill = document.createElement("span");
      fill.style.width = `${Math.round((progress.done / progress.total) * 100)}%`;
      bar.appendChild(fill);
      const label = document.createElement("span");
      label.className = "agenda-progress-label";
      label.textContent = `${progress.done} of ${progress.total} done`;
      const line = document.createElement("div");
      line.className = "agenda-progress-line";
      line.append(bar, label);
      card.appendChild(line);
    }

    if (entry.items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "agenda-week-empty";
      empty.textContent = entry.code
        ? "Nothing yet: add its series, labs and exams, or import a workload a classmate shared."
        : "Nothing yet.";
      card.appendChild(empty);
      return card;
    }

    // Recurring groups first (by their first date), then items on their own.
    const groups = new Map<string, AgendaItem[]>();
    const singles: AgendaItem[] = [];
    sortAgendaItems([...entry.items]).forEach((item) => {
      if (item.group) {
        groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
      } else {
        singles.push(item);
      }
    });
    const visible = (item: AgendaItem): boolean => !agendaHideFinished || !isFinished(item);
    const rowOptions = { showCourse: false };

    groups.forEach((groupItems, groupId) => {
      const description = describeAgendaGroup(groupItems, this.data.agenda.layout.weeks);
      const details = document.createElement("details");
      details.className = "agenda-group";
      details.open = agendaOpenGroups.has(groupId);
      details.addEventListener("toggle", () => {
        if (details.open) {
          agendaOpenGroups.add(groupId);
        } else {
          agendaOpenGroups.delete(groupId);
        }
      });
      const summary = document.createElement("summary");
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-repeat agenda-group-icon";
      icon.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "agenda-group-text";
      const groupTitle = document.createElement("strong");
      groupTitle.textContent = description.title;
      const when = document.createElement("span");
      when.textContent = description.when;
      text.append(groupTitle, when);
      const groupProgress = agendaProgress(groupItems);
      const count = document.createElement("span");
      count.className = "agenda-course-row-count";
      count.textContent = `${groupProgress.done}/${groupProgress.total}`;
      const groupActions = document.createElement("span");
      groupActions.className = "agenda-group-actions";
      groupActions.append(
        this.createAgendaIconButton("fa-pen", `Edit all of ${description.title}`, () => this.openAgendaGroupModal(groupId)),
        this.createAgendaIconButton("fa-xmark", `Delete all of ${description.title}`, () => {
          if (window.confirm(`Delete all ${groupItems.length} of ${description.title}?`)) {
            agendaOpenGroups.delete(groupId);
            this.data.onAgendaChange({ remove: groupItems.map((item) => item.id) });
          }
        }, "plan-course-remove"),
      );
      summary.append(icon, text, count, groupActions);
      details.appendChild(summary);

      const list = document.createElement("ul");
      list.className = "agenda-items";
      groupItems.filter(visible).forEach((item) => list.appendChild(this.createAgendaRow(item, today, rowOptions)));
      details.appendChild(list);
      card.appendChild(details);
    });

    const shownSingles = singles.filter(visible);
    if (shownSingles.length > 0) {
      const list = document.createElement("ul");
      list.className = "agenda-items";
      shownSingles.forEach((item) => list.appendChild(this.createAgendaRow(item, today, rowOptions)));
      card.appendChild(list);
    }
    return card;
  }

  /** Modal shell shared by the Agenda dialogs: a form with a header, a scrolling body and a footer. */
  private openAgendaModal(title: string, subtitle: string): { form: HTMLFormElement; body: HTMLElement; footer: HTMLElement; close: () => void } {
    document.querySelector(".agenda-modal-backdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "course-link-modal-backdrop agenda-modal-backdrop";

    const form = document.createElement("form");
    form.className = "course-edit-modal agenda-modal";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-label", title);
    form.noValidate = true;

    const header = document.createElement("header");
    header.className = "course-link-modal-header";
    const titleBlock = document.createElement("div");
    const heading = document.createElement("h3");
    heading.className = "course-link-modal-title";
    heading.textContent = title;
    titleBlock.appendChild(heading);
    if (subtitle) {
      const sub = document.createElement("p");
      sub.className = "course-edit-status";
      sub.textContent = subtitle;
      titleBlock.appendChild(sub);
    }
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "course-link-modal-close";
    closeButton.textContent = "Close";
    header.append(titleBlock, closeButton);

    const body = document.createElement("div");
    body.className = "course-edit-body";
    const footer = document.createElement("footer");
    footer.className = "course-edit-footer";
    form.append(header, body, footer);
    backdrop.appendChild(form);
    document.body.appendChild(backdrop);

    const close = (): void => {
      backdrop.classList.remove("visible");
      window.removeEventListener("keydown", handleEscape);
      window.setTimeout(() => backdrop.remove(), TimetableWidget.MODAL_FADE_DURATION_MS);
    };
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
      }
    };
    closeButton.addEventListener("click", close);
    // No close on backdrop click: a stray click must not throw away what was typed.
    window.addEventListener("keydown", handleEscape);
    window.requestAnimationFrame(() => backdrop.classList.add("visible"));
    return { form, body, footer, close };
  }

  private createAgendaFooterButton(label: string, className: string, type: "button" | "submit" = "button"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = type;
    button.className = className;
    button.textContent = label;
    return button;
  }

  /**
   * Add an item to a course (or edit one). Series and labs are due on a weekday, every teaching week (break
   * weeks skipped, added as one group) or in a single week; exams and notes take a date.
   */
  private openAgendaItemModal(courseCode: string, editing?: AgendaItem, onDay?: string): void {
    const { items, semester, layout } = this.data.agenda;
    const entries = this.agendaCourseEntries();
    const nameOf = (code: string): string => (code ? entries.find((candidate) => candidate.code === code)?.name ?? editing?.courseName ?? "" : "");
    const courseName = nameOf(courseCode);
    // Opened from a calendar day: the course is picked in the dialog and the item lands on that day.
    const fromDay = onDay && !editing ? onDay : undefined;
    const dayWeek = fromDay ? layout.weeks.find((candidate) => candidate.number !== null && candidate.monday === mondayOf(fromDay)) : undefined;
    const today = toIsoDate(new Date());
    const teachingWeeks = layout.weeks.filter((week) => week.number !== null);
    // The week to suggest: the current teaching week, else the next one, else the last.
    const suggestedWeek = teachingWeeks.find((week) => week.sunday >= today) ?? teachingWeeks[teachingWeeks.length - 1];
    const groupItems = editing?.group ? items.filter((item) => item.group === editing.group) : [];

    const { form, body, footer, close } = this.openAgendaModal(
      editing ? `Edit ${editing.title}` : fromDay ? `Add on ${formatDay(fromDay)}` : `Add to ${courseCode || "General"}`,
      fromDay ? (dayWeek ? `Week ${dayWeek.number}` : "") : courseCode ? `${courseCode} – ${courseName}` : "Not tied to a course",
    );

    let type: AgendaItemType = editing?.type ?? agendaFormType;

    const typePicker = document.createElement("div");
    typePicker.className = "agenda-type-picker";
    typePicker.setAttribute("role", "radiogroup");
    typePicker.setAttribute("aria-label", "Type");

    const field = (label: string, control: HTMLElement, extraClass = ""): HTMLLabelElement => {
      const wrapper = document.createElement("label");
      wrapper.className = `agenda-field ${extraClass}`.trim();
      const caption = document.createElement("span");
      caption.textContent = label;
      wrapper.append(caption, control);
      return wrapper;
    };

    const title = document.createElement("input");
    title.type = "text";

    const recurrence = createSelect([
      { value: "every", label: "Every week" },
      { value: "once", label: "Only week…" },
    ]);
    const week = createSelect(teachingWeeks.map((teachingWeek) => ({
      value: teachingWeek.monday,
      label: `Week ${teachingWeek.number} · ${formatDay(teachingWeek.monday, false)} – ${formatDay(teachingWeek.sunday, false)}`,
    })));
    const weekday = createSelect(WEEKDAYS.map((name, index) => ({ value: `${index}`, label: name })));

    const date = document.createElement("input");
    date.type = "date";
    const time = document.createElement("input");
    time.type = "time";

    const details = document.createElement("input");
    details.type = "text";
    details.placeholder = "Optional (room, chapters…)";

    const course = createSelect(entries.map((candidate) => ({
      value: candidate.code,
      label: candidate.code ? `${candidate.code} – ${candidate.name}` : "General (no course)",
    })));
    if (fromDay && !courseCode) {
      courseCode = entries[0]?.code ?? "";
    }
    course.value = courseCode;
    const courseField = field("Course", course, "wide");
    courseField.hidden = !fromDay;

    const titleField = field("Title", title, "wide");
    const repeatField = field("Repeat", recurrence);
    const weekField = field("Week", week);
    const weekdayField = field("Due on", weekday);
    const dateField = field("Date", date);
    const timeField = field("Time", time);
    const detailsField = field("Details", details, "wide");

    const nextNumber = (kind: AgendaItemType): number =>
      items.filter((item) => item.type === kind && item.courseCode === courseCode).length + 1;

    const applyDefaults = (): void => {
      typePicker.querySelectorAll("button").forEach((button) => {
        const selected = button.dataset.type === type;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-checked", `${selected}`);
      });
      // "Every week" numbers from 1 (Series 1 ... 14); a single one continues the course's count.
      const every = !editing && recurrence.value === "every";
      const placeholders: Record<AgendaItemType, string> = {
        series: `Series ${every ? 1 : nextNumber("series")}`,
        lab: `Lab ${every ? 1 : nextNumber("lab")}`,
        midterm: "Midterm",
        final: "Final exam",
        note: "e.g. No course: videos",
      };
      title.placeholder = placeholders[type];
      titleField.querySelector("span")!.textContent = type === "note" ? "Note" : every && isWeekly(type) ? "Title of the first one" : "Title";
      const weekly = isWeekly(type);
      repeatField.hidden = !weekly || Boolean(editing);
      weekField.hidden = !weekly || (!editing && recurrence.value === "every");
      weekdayField.hidden = !weekly;
      dateField.hidden = weekly;
      timeField.hidden = type === "note";
      dateField.querySelector("span")!.textContent = type === "final" ? "Date (if known)" : "Date";
      if (!editing) {
        date.value = fromDay ?? (type === "note" ? today : "");
        time.value = weekly ? "23:59" : "";
      }
    };

    // Switching type restores that type's last weekday and recurrence.
    const loadWeeklyChoices = (): void => {
      if (isWeekly(type) && !editing) {
        weekday.value = `${agendaWeekday[type]}`;
        recurrence.value = agendaRecurrence[type];
      }
      // From a calendar day: that week and weekday, just once.
      if (fromDay) {
        recurrence.value = "once";
        weekday.value = `${weekdayIndex(fromDay)}`;
        if (dayWeek) {
          week.value = dayWeek.monday;
        }
      }
    };

    (Object.keys(AGENDA_TYPE_LABELS) as AgendaItemType[]).forEach((kind) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.type = kind;
      button.setAttribute("role", "radio");
      button.textContent = AGENDA_TYPE_LABELS[kind];
      button.addEventListener("click", () => {
        type = kind;
        if (!editing) {
          agendaFormType = kind;
        }
        loadWeeklyChoices();
        applyDefaults();
      });
      typePicker.appendChild(button);
    });
    course.addEventListener("change", () => {
      courseCode = course.value;
      applyDefaults();
    });
    weekday.addEventListener("change", () => {
      if (isWeekly(type) && !editing && !fromDay) {
        agendaWeekday[type] = Number(weekday.value);
      }
    });
    recurrence.addEventListener("change", () => {
      if (isWeekly(type)) {
        agendaRecurrence[type] = recurrence.value === "every" ? "every" : "once";
      }
      applyDefaults();
    });

    // Initial values: the edited item, else the remembered choices.
    const editingWeek = editing?.date ? weekContaining(layout.weeks, editing.date) : undefined;
    week.value = editingWeek?.monday ?? suggestedWeek?.monday ?? "";
    loadWeeklyChoices();
    if (editing?.date) {
      weekday.value = `${weekdayIndex(editing.date)}`;
    }
    if (editing) {
      title.value = editing.title;
      date.value = editing.date;
      time.value = editing.time;
      details.value = editing.details;
    }
    applyDefaults();

    const grid = document.createElement("div");
    grid.className = "agenda-form-grid";
    grid.append(courseField, titleField, repeatField, weekField, weekdayField, timeField, dateField, detailsField);
    const error = document.createElement("p");
    error.className = "course-edit-error";
    error.setAttribute("role", "alert");
    body.append(typePicker, grid, error);

    // An item of a recurring group: offer to edit the whole group instead.
    if (editing && groupItems.length > 1) {
      const all = this.createAgendaFooterButton(`Edit all ${groupItems.length} at once`, "course-edit-reset agenda-footer-link");
      all.addEventListener("click", () => {
        close();
        this.openAgendaGroupModal(editing.group);
      });
      footer.appendChild(all);
    }
    const cancel = this.createAgendaFooterButton("Cancel", "course-link-modal-close");
    cancel.addEventListener("click", close);
    footer.append(cancel, this.createAgendaFooterButton(editing ? "Save changes" : "Add", "course-edit-save", "submit"));

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = title.value.trim() || (type === "note" ? "" : title.placeholder);
      if (!text) {
        error.textContent = "Write the note first.";
        title.focus();
        return;
      }
      const weekly = isWeekly(type);
      const every = weekly && !editing && recurrence.value === "every";
      if (weekly && teachingWeeks.length === 0) {
        error.textContent = "This semester has no teaching weeks.";
        return;
      }
      if (!weekly && !date.value && type !== "final") {
        error.textContent = "Pick a date.";
        date.focus();
        return;
      }
      const dueOffset = Number(weekday.value);
      const base = {
        type,
        semester,
        courseCode,
        courseName: nameOf(courseCode),
        title: text,
        date: weekly ? addDays(week.value, dueOffset) : date.value,
        time: type === "note" ? "" : time.value,
        details: details.value.trim(),
      };

      close();
      if (editing) {
        this.data.onAgendaUpdate(editing.id, { ...base, status: hasStatus(type) ? editing.status : "todo" });
        return;
      }

      // "Every week": one item per teaching week of the semester (break weeks skipped), numbered on from
      // the title (Series 1, Series 2, ...) and kept together as a group. Otherwise a single item.
      const mondays = every ? teachingWeeks.map((teachingWeek) => teachingWeek.monday) : [weekly ? week.value : ""];
      const numbered = /^(.*?)(\d+)$/.exec(text);
      const group = every ? newAgendaId() : "";
      if (group) {
        agendaOpenGroups.delete(group);
      }
      const created = mondays.map((monday, index) => ({
        ...base,
        title: numbered && mondays.length > 1 ? `${numbered[1]}${Number(numbered[2]) + index}` : text,
        date: weekly ? addDays(monday, dueOffset) : base.date,
        status: "todo" as AgendaStatus,
        group,
      }));
      this.data.onAgendaChange({ add: created });
    });

    window.requestAnimationFrame(() => (fromDay ? course : title).focus());
  }

  /**
   * Edit a recurring group (series or labs added with "Every week") at once: its name and numbering, weekday,
   * time, details and which teaching weeks it covers. Only the fields that are changed are applied, so
   * per-item tweaks survive; statuses are kept.
   */
  private openAgendaGroupModal(groupId: string): void {
    const { items, layout } = this.data.agenda;
    const groupItems = sortAgendaItems(items.filter((item) => item.group === groupId));
    if (groupItems.length === 0) {
      return;
    }
    const template = groupItems[0];
    const description = describeAgendaGroup(groupItems, layout.weeks);
    const teachingWeeks = layout.weeks.filter((week) => week.number !== null);

    const { form, body, footer, close } = this.openAgendaModal(
      `Edit ${description.title}`,
      `${template.courseCode || "General"} · ${summarizeAgendaItems(groupItems)}, ${description.when}`,
    );

    const field = (label: string, control: HTMLElement, extraClass = ""): HTMLLabelElement => {
      const wrapper = document.createElement("label");
      wrapper.className = `agenda-field ${extraClass}`.trim();
      const caption = document.createElement("span");
      caption.textContent = label;
      wrapper.append(caption, control);
      return wrapper;
    };

    // Name + first number, when the titles are numbered ("Series 1", "Series 2", ...).
    const stem = numberedStem(groupItems);
    const name = document.createElement("input");
    name.type = "text";
    name.value = stem?.stem ?? "";
    const firstNumber = document.createElement("input");
    firstNumber.type = "number";
    firstNumber.min = "0";
    firstNumber.value = `${stem?.first ?? 1}`;

    const mostCommon = <T,>(values: T[]): T => {
      const counts = new Map<T, number>();
      values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    };
    const weekday = createSelect(WEEKDAYS.map((dayName, index) => ({ value: `${index}`, label: dayName })));
    const initialWeekday = `${mostCommon(groupItems.map((item) => (item.date ? weekdayIndex(item.date) : 6)))}`;
    weekday.value = initialWeekday;
    const time = document.createElement("input");
    time.type = "time";
    const initialTime = mostCommon(groupItems.map((item) => item.time));
    time.value = initialTime;
    const details = document.createElement("input");
    details.type = "text";
    const sameDetails = groupItems.every((item) => item.details === template.details);
    const initialDetails = sameDetails ? template.details : "";
    details.value = initialDetails;
    details.placeholder = sameDetails ? "Optional (room, chapters…)" : "Different for each: leave empty to keep them";

    const grid = document.createElement("div");
    grid.className = "agenda-form-grid";
    if (stem) {
      grid.append(field("Name", name), field("First number", firstNumber));
    }
    grid.append(field("Due on", weekday), field("Time", time), field("Details", details, "wide"));

    // Which teaching weeks the group covers: unticking deletes that week's item, ticking adds one.
    const weeksField = document.createElement("fieldset");
    weeksField.className = "agenda-week-picker";
    const legend = document.createElement("legend");
    legend.textContent = "Weeks";
    weeksField.appendChild(legend);
    const byMonday = new Map<string, AgendaItem[]>();
    groupItems.forEach((item) => {
      const itemWeek = item.date ? weekContaining(layout.weeks, item.date) : undefined;
      if (itemWeek) {
        byMonday.set(itemWeek.monday, [...(byMonday.get(itemWeek.monday) ?? []), item]);
      }
    });
    const checks = teachingWeeks.map((teachingWeek) => {
      const label = document.createElement("label");
      label.title = `${formatDay(teachingWeek.monday, false)} – ${formatDay(teachingWeek.sunday, false)}`;
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = byMonday.has(teachingWeek.monday);
      const text = document.createElement("span");
      text.textContent = `${teachingWeek.number}`;
      label.append(check, text);
      weeksField.appendChild(label);
      return { week: teachingWeek, check };
    });
    const weekShortcuts = document.createElement("div");
    weekShortcuts.className = "agenda-week-picker-shortcuts";
    const allWeeks = this.createAgendaFooterButton("All", "agenda-link");
    allWeeks.addEventListener("click", () => checks.forEach(({ check }) => {
      check.checked = true;
    }));
    const noWeeks = this.createAgendaFooterButton("None", "agenda-link");
    noWeeks.addEventListener("click", () => checks.forEach(({ check }) => {
      check.checked = false;
    }));
    weekShortcuts.append(allWeeks, noWeeks);
    weeksField.appendChild(weekShortcuts);

    const error = document.createElement("p");
    error.className = "course-edit-error";
    error.setAttribute("role", "alert");
    body.append(grid, weeksField, error);

    const removeAll = this.createAgendaFooterButton(`Delete all ${groupItems.length}`, "course-edit-reset");
    removeAll.addEventListener("click", () => {
      if (window.confirm(`Delete all ${groupItems.length} of ${description.title}?`)) {
        close();
        agendaOpenGroups.delete(groupId);
        this.data.onAgendaChange({ remove: groupItems.map((item) => item.id) });
      }
    });
    const cancel = this.createAgendaFooterButton("Cancel", "course-link-modal-close");
    cancel.addEventListener("click", close);
    footer.append(removeAll, cancel, this.createAgendaFooterButton("Save changes", "course-edit-save", "submit"));

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const first = Number(firstNumber.value);
      if (stem && (!Number.isInteger(first) || first < 0)) {
        error.textContent = "The first number must be a whole number.";
        firstNumber.focus();
        return;
      }
      const weekdayChanged = weekday.value !== initialWeekday;
      const timeChanged = time.value !== initialTime;
      const detailsChanged = details.value.trim() !== initialDetails;
      const dueOffset = Number(weekday.value);

      // Items of unticked weeks go; ticked weeks without an item get a new one.
      const remove: string[] = [];
      const kept: AgendaItem[] = [];
      groupItems.forEach((item) => {
        const itemWeek = item.date ? weekContaining(layout.weeks, item.date) : undefined;
        const match = itemWeek ? checks.find((candidate) => candidate.week.monday === itemWeek.monday) : undefined;
        if (match && !match.check.checked) {
          remove.push(item.id);
        } else {
          kept.push(item);
        }
      });
      if (kept.length === 0 && checks.every(({ check }) => !check.checked)) {
        if (!window.confirm(`No week is ticked: delete all ${groupItems.length} of ${description.title}?`)) {
          return;
        }
      }

      type Planned = { item?: AgendaItem; date: string; patch: Partial<Omit<AgendaItem, "id">> };
      const planned: Planned[] = kept.map((item) => {
        const patch: Partial<Omit<AgendaItem, "id">> = {};
        if (weekdayChanged && item.date) {
          patch.date = addDays(mondayOf(item.date), dueOffset);
        }
        if (timeChanged) {
          patch.time = time.value;
        }
        if (detailsChanged) {
          patch.details = details.value.trim();
        }
        return { item, date: patch.date ?? item.date, patch };
      });
      checks
        .filter(({ week: checkWeek, check }) => check.checked && !byMonday.has(checkWeek.monday))
        .forEach(({ week: checkWeek }) => planned.push({ date: addDays(checkWeek.monday, dueOffset), patch: {} }));

      // Numbered titles follow the order of the dates: Series 1, Series 2, ...
      planned.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
      const stemText = name.value.trim();
      const add: Array<Omit<AgendaItem, "id">> = [];
      const update: Array<{ id: string; patch: Partial<Omit<AgendaItem, "id">> }> = [];
      planned.forEach((plan, index) => {
        const numberedTitle = stem ? `${stemText} ${first + index}`.trim() : undefined;
        if (plan.item) {
          if (numberedTitle !== undefined && numberedTitle !== plan.item.title) {
            plan.patch.title = numberedTitle;
          }
          if (Object.keys(plan.patch).length > 0) {
            update.push({ id: plan.item.id, patch: plan.patch });
          }
        } else {
          add.push({
            type: template.type,
            semester: template.semester,
            courseCode: template.courseCode,
            courseName: template.courseName,
            title: numberedTitle ?? template.title,
            date: plan.date,
            time: timeChanged ? time.value : initialTime,
            status: "todo",
            details: detailsChanged ? details.value.trim() : initialDetails,
            group: groupId,
          });
        }
      });
      close();
      this.data.onAgendaChange({ remove, update, add });
    });
  }

  /** Share one course's workload (or the whole semester's) as JSON: copy it or download a file. */
  private openAgendaShareModal(courseCodes: string[] | null): void {
    const { items, semester, layout, academicYear, season } = this.data.agenda;
    const shared = courseCodes ? items.filter((item) => courseCodes.includes(item.courseCode)) : items;
    const json = exportAgenda(semester, layout.weeks, shared);
    const single = courseCodes?.length === 1 ? courseCodes[0] || "General" : null;

    const { form, body, footer, close } = this.openAgendaModal(
      single ? `Share ${single}` : "Share the semester's agenda",
      `${seasonLabel(season, academicYear)} · ${shared.length} item${shared.length === 1 ? "" : "s"}`,
    );
    const note = document.createElement("p");
    note.className = "studies-note";
    note.textContent = "Send this to classmates: they import it from the Agenda. Statuses aren't included, and series and labs are stored by teaching week, so it also works for next year's semester.";
    const text = document.createElement("textarea");
    text.className = "agenda-share-text";
    text.readOnly = true;
    text.rows = 12;
    text.value = json;
    text.addEventListener("focus", () => text.select());
    body.append(note, text);

    const download = this.createAgendaFooterButton("Download .json", "course-link-modal-close");
    download.addEventListener("click", () => {
      const blob = new Blob([json], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `agenda-${(single ?? "semester").replace(/[^\w-]+/g, "_")}-${semester}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
    const copy = this.createAgendaFooterButton("Copy", "course-edit-save", "submit");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const done = (): void => {
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy";
        }, 1500);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(json).then(done, () => {
          text.select();
          document.execCommand("copy");
          done();
        });
      } else {
        text.select();
        document.execCommand("copy");
        done();
      }
    });
    const cancel = this.createAgendaFooterButton("Close", "course-link-modal-close");
    cancel.addEventListener("click", close);
    footer.append(cancel, download, copy);
  }

  /** Import a shared workload into the semester shown, course by course, optionally replacing what is there. */
  private openAgendaImportModal(): void {
    const { items, semester, layout, courses, academicYear, season } = this.data.agenda;
    const targetLabel = seasonLabel(season, academicYear);
    const { form, body, footer, close } = this.openAgendaModal("Import a shared agenda", `Into ${targetLabel}`);

    const intro = document.createElement("p");
    intro.className = "studies-note";
    intro.textContent = "Choose the .json file a classmate shared, or paste its contents.";
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.className = "agenda-import-file";
    const paste = document.createElement("textarea");
    paste.className = "agenda-share-text";
    paste.rows = 5;
    paste.placeholder = '{ "format": "my-studies-agenda", ... }';
    const preview = document.createElement("div");
    preview.className = "agenda-import-preview";
    body.append(intro, file, paste, preview);

    const cancel = this.createAgendaFooterButton("Cancel", "course-link-modal-close");
    cancel.addEventListener("click", close);
    const submit = this.createAgendaFooterButton("Import", "course-edit-save", "submit");
    submit.disabled = true;
    footer.append(cancel, submit);

    // A shared course goes to the course with the same code, else the same code without the section
    // ("MATH-101(e)" -> "MATH-101(en)"), else it keeps its own code (a course not in the plan).
    const stripSection = (code: string): string => code.replace(/\([^)]*\)/g, "").trim();
    const targetOf = (shared: SharedAgendaCourse): { code: string; name: string; inPlan: boolean } => {
      const match = courses.find((course) => course.code === shared.code)
        ?? (shared.code ? courses.find((course) => stripSection(course.code) === stripSection(shared.code)) : undefined);
      return match ? { ...match, inPlan: true } : { code: shared.code, name: shared.name, inPlan: shared.code === "" };
    };

    let share: SharedAgenda | null = null;
    let rows: Array<{ course: SharedAgendaCourse; check: HTMLInputElement }> = [];
    const replace = document.createElement("input");
    replace.type = "checkbox";
    replace.checked = true;

    const refresh = (): void => {
      const count = rows.filter((row) => row.check.checked).reduce((sum, row) => sum + row.course.items.length, 0);
      submit.disabled = count === 0;
      submit.textContent = count > 0 ? `Import ${count} item${count === 1 ? "" : "s"}` : "Import";
    };

    const read = (text: string): void => {
      preview.replaceChildren();
      rows = [];
      share = null;
      if (!text.trim()) {
        refresh();
        return;
      }
      try {
        share = parseAgendaShare(text);
      } catch (problem) {
        const message = document.createElement("p");
        message.className = "course-edit-error";
        message.textContent = problem instanceof Error ? problem.message : "This file can't be read.";
        preview.appendChild(message);
        refresh();
        return;
      }
      const current = share;
      if (current.courses.length === 0) {
        const message = document.createElement("p");
        message.className = "course-edit-error";
        message.textContent = "There is nothing to import in this file.";
        preview.appendChild(message);
        refresh();
        return;
      }
      if (current.semester && current.semester !== semester) {
        const { academicYear: sourceYear, season: sourceSeason } = parseSemesterKey(current.semester);
        const note = document.createElement("p");
        note.className = "agenda-import-note";
        note.textContent = `Made for ${seasonLabel(sourceSeason, sourceYear)}: series, labs and exams are placed by teaching week in ${targetLabel}.`;
        preview.appendChild(note);
      }

      const list = document.createElement("ul");
      list.className = "agenda-import-list";
      current.courses.forEach((course) => {
        const target = targetOf(course);
        const existing = items.filter((item) => item.courseCode === target.code).length;
        const { skipped } = materializeShared(course, current, { semester, weeks: layout.weeks }, target);
        const row = document.createElement("li");
        const label = document.createElement("label");
        label.className = "course-edit-check";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = true;
        check.addEventListener("change", refresh);
        const caption = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = target.code || "General";
        caption.append(strong, target.code ? ` ${target.name}` : "");
        const meta = document.createElement("small");
        meta.textContent = [
          summarizeAgendaItems(course.items),
          target.code !== course.code ? `as ${target.code} (shared as ${course.code})` : "",
          target.inPlan ? "" : "not in your plan this semester",
          existing > 0 ? `you have ${existing} item${existing === 1 ? "" : "s"} there` : "",
          skipped > 0 ? `${skipped} dated item${skipped === 1 ? "" : "s"} from another semester skipped` : "",
        ].filter(Boolean).join(" · ");
        caption.appendChild(meta);
        label.append(check, caption);
        row.appendChild(label);
        list.appendChild(row);
        rows.push({ course, check });
      });
      preview.appendChild(list);

      const replaceLabel = document.createElement("label");
      replaceLabel.className = "course-edit-check";
      const replaceText = document.createElement("span");
      replaceText.textContent = "Replace what I already have for these courses (otherwise add alongside)";
      replaceLabel.append(replace, replaceText);
      preview.appendChild(replaceLabel);
      refresh();
    };

    paste.addEventListener("input", () => read(paste.value));
    file.addEventListener("change", () => {
      const chosen = file.files?.[0];
      if (chosen) {
        chosen.text().then((text) => {
          paste.value = text;
          read(text);
        });
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!share) {
        return;
      }
      const current = share;
      const remove: string[] = [];
      const add: Array<Omit<AgendaItem, "id">> = [];
      rows.filter((row) => row.check.checked).forEach(({ course }) => {
        const target = targetOf(course);
        if (replace.checked) {
          items.filter((item) => item.courseCode === target.code).forEach((item) => remove.push(item.id));
        }
        add.push(...materializeShared(course, current, { semester, weeks: layout.weeks }, target).items);
      });
      close();
      agendaView = "courses";
      this.data.onAgendaChange({ remove, add });
    });
  }

  private createAgendaSettings(): HTMLElement {
    const { items, courses, start, layout } = this.data.agenda;
    const card = document.createElement("section");
    card.className = "agenda-card";
    const heading = document.createElement("h3");
    heading.className = "studies-card-title";
    heading.innerHTML = '<i class="fa-solid fa-sliders" aria-hidden="true"></i>';
    heading.append("View");
    card.appendChild(heading);

    const body = document.createElement("div");
    body.className = "agenda-form";

    const filter = document.createElement("select");
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All courses";
    filter.appendChild(all);
    const codes = new Map<string, string>();
    courses.forEach((entry) => codes.set(entry.code, entry.name));
    items.forEach((item) => item.courseCode && codes.set(item.courseCode, item.courseName));
    codes.forEach((name, code) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = `${code} – ${name}`;
      filter.appendChild(option);
    });
    filter.value = codes.has(agendaCourseFilter) ? agendaCourseFilter : "";
    filter.addEventListener("change", () => {
      agendaCourseFilter = filter.value;
      this.rerenderAgenda();
    });
    const filterLabel = document.createElement("label");
    filterLabel.className = "agenda-field";
    const filterCaption = document.createElement("span");
    filterCaption.textContent = "Course";
    filterLabel.append(filterCaption, filter);

    const hideLabel = document.createElement("label");
    hideLabel.className = "course-edit-check";
    const hide = document.createElement("input");
    hide.type = "checkbox";
    hide.checked = agendaHideFinished;
    hide.addEventListener("change", () => {
      agendaHideFinished = hide.checked;
      this.rerenderAgenda();
    });
    const hideText = document.createElement("span");
    hideText.textContent = "Hide done and corrected items";
    hideLabel.append(hide, hideText);
    body.append(filterLabel, hideLabel);

    if (layout.source === "epfl") {
      // Weeks come from the academic calendar; nothing to set.
      const note = document.createElement("p");
      note.className = "studies-note";
      const breaks = layout.weeks.filter((week) => week.number === null);
      note.textContent = `Weeks follow the EPFL academic calendar: ${layout.weeks.filter((week) => week.number !== null).length} teaching weeks`
        + (breaks.length > 0 ? `, ${breaks.map((week) => `${week.breakName?.toLowerCase()} ${formatDay(week.monday, false)}`).join(", ")}` : "")
        + (layout.exams ? `, exams ${formatDay(layout.exams.from, false)} – ${formatDay(layout.exams.to, false)}.` : ".");
      body.appendChild(note);
    } else {
      // Not covered by the bundled calendar: 14 weeks from a start date the user can set.
      const startInput = document.createElement("input");
      startInput.type = "date";
      startInput.value = start;
      startInput.addEventListener("change", () => this.data.onAgendaSetStart(startInput.value || null));
      const startLabel = document.createElement("label");
      startLabel.className = "agenda-field";
      const startCaption = document.createElement("span");
      startCaption.textContent = "Week 1 starts on";
      startLabel.append(startCaption, startInput);

      const startNote = document.createElement("p");
      startNote.className = "studies-note";
      startNote.textContent = layout.source === "estimate"
        ? "Not in the bundled academic calendar, so this is an estimate: check it against the EPFL calendar."
        : "Set by you.";
      if (layout.source === "custom") {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "agenda-link";
        reset.textContent = "Use the estimate";
        reset.addEventListener("click", () => this.data.onAgendaSetStart(null));
        startNote.append(" ", reset);
      }
      body.append(startLabel, startNote);
    }

    card.appendChild(body);
    return card;
  }

  /** My studies: what's due this week (and anything overdue) from the current semester's agenda. */
  private createAgendaDashboardCard(): HTMLElement {
    const { items, courses, layout } = this.data.currentAgenda;
    const today = toIsoDate(new Date());
    const sunday = addDays(mondayOf(today), 6);
    const relevant = items
      .filter((item) => item.date && ((item.date >= today && item.date <= sunday) || (!isFinished(item) && item.date < today)))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

    const { card, body } = this.createDashboardCard("This week in your agenda", "fa-list-check");
    if (relevant.length === 0) {
      const empty = document.createElement("p");
      empty.className = "studies-all-clear";
      empty.innerHTML = items.length === 0
        ? '<i class="fa-solid fa-list-check" aria-hidden="true"></i> Track series, labs and exams in the Agenda.'
        : '<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Nothing due this week.';
      body.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "agenda-items compact";
      relevant.forEach((item) => list.appendChild(this.createAgendaRow(item, today, { courses, weeks: layout.weeks })));
      body.appendChild(list);
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "agenda-link";
    open.textContent = "Open the agenda";
    open.addEventListener("click", () => this.data.onChangeTab("agenda"));
    body.appendChild(open);
    return card;
  }

  /** Sidebar: the main study of each cycle and the year the user started, which places "today" in the plan. */
  private createStudySettings(): HTMLElement {
    const section = document.createElement("section");
    section.className = "sidebar-settings";
    section.setAttribute("aria-label", "Your studies");

    const title = document.createElement("h2");
    title.className = "sidebar-settings-title";
    title.textContent = "Your studies";
    section.appendChild(title);

    (["bachelor", "master"] as const).forEach((cycle) => {
      const { options, value } = this.data.mainStudies[cycle];
      const label = document.createElement("label");
      label.className = "sidebar-field";

      const caption = document.createElement("span");
      caption.textContent = CYCLE_LABELS[cycle];

      const select = document.createElement("select");
      select.className = "sidebar-select";
      options.forEach((option) => {
        const element = document.createElement("option");
        element.value = option;
        element.textContent = option;
        element.selected = option === value;
        select.appendChild(element);
      });
      select.addEventListener("change", () => {
        if (select.value && select.value !== value) {
          this.data.onChangeMainStudy(cycle, select.value);
        }
      });

      label.append(caption, select);
      section.appendChild(label);
    });

    const [minYear, maxYear] = this.data.startYearRange;
    const yearField = document.createElement("label");
    yearField.className = "sidebar-field";

    const yearHeader = document.createElement("span");
    yearHeader.className = "sidebar-field-row";
    const yearCaption = document.createElement("span");
    yearCaption.textContent = "Started in";
    const yearValue = document.createElement("output");
    yearValue.className = "sidebar-year-value";
    yearHeader.append(yearCaption, yearValue);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "sidebar-slider";
    slider.min = `${minYear}`;
    slider.max = `${maxYear}`;
    slider.step = "1";
    slider.value = `${Math.min(maxYear, Math.max(minYear, this.data.startYear))}`;
    slider.setAttribute("aria-label", "Year you started your bachelor (BA1 in autumn)");

    const describe = (year: number): string => {
      const position = studyPosition(year);
      if (position.status === "studying") {
        return `${year} · now ${position.semester}`;
      }
      return position.status === "upcoming" ? `${year} · not started` : `${year} · done`;
    };
    yearValue.textContent = describe(Number(slider.value));
    // Update the label while dragging; apply when released.
    slider.addEventListener("input", () => {
      yearValue.textContent = describe(Number(slider.value));
    });
    slider.addEventListener("change", () => this.data.onChangeStartYear(Number(slider.value)));

    const ticks = document.createElement("span");
    ticks.className = "sidebar-slider-ticks";
    ticks.innerHTML = `<span>${minYear}</span><span>${maxYear}</span>`;

    yearField.append(yearHeader, slider, ticks);
    section.appendChild(yearField);
    return section;
  }

  /** The Planner tab has two views of the same plan. */
  private createPlannerViewSwitch(): HTMLElement {
    const switcher = document.createElement("div");
    switcher.className = "view-switch";
    switcher.setAttribute("role", "tablist");
    switcher.setAttribute("aria-label", "Planner view");

    const views: Array<{ tab: AppTab; label: string; icon: string }> = [
      { tab: "planner", label: "Study plan", icon: "fa-table-cells-large" },
      { tab: "schedule", label: "Weekly schedule", icon: "fa-clock" },
    ];
    views.forEach((view) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "tab");
      const selected = this.data.activeTab === view.tab;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", `${selected}`);
      button.innerHTML = `<i class="fa-solid ${view.icon}" aria-hidden="true"></i><span>${view.label}</span>`;
      button.addEventListener("click", () => {
        if (!selected) {
          this.data.onChangeTab(view.tab);
        }
      });
      switcher.appendChild(button);
    });
    return switcher;
  }

  /** "My studies": the semester the user is in today (from the start year in the sidebar). */
  private createStudiesDashboard(periods: Period[], summary: ScheduleSummary): HTMLElement {
    const dashboard = document.createElement("div");
    dashboard.className = "studies-dashboard";
    const position = this.data.studyPosition;

    // --- Hero: where you are ---
    const hero = document.createElement("section");
    hero.className = "studies-hero";

    const eyebrow = document.createElement("p");
    eyebrow.className = "studies-hero-eyebrow";
    eyebrow.textContent = `${seasonLabel(position.season, position.academicYear)} · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`;

    const headline = document.createElement("h2");
    headline.className = "studies-hero-title";
    const detail = document.createElement("p");
    detail.className = "studies-hero-detail";

    if (position.status === "studying") {
      const cycle = cycleOf(position.semester);
      const year = Math.ceil(Number(position.semester.slice(2)) / 2);
      headline.textContent = position.semester;
      detail.textContent = `Year ${year} of your ${cycle} in ${this.data.mainStudies[cycle].value}`;
    } else if (position.status === "upcoming") {
      headline.textContent = "Not started yet";
      detail.textContent = `Your BA1 starts in autumn ${this.data.startYear}. Change the year in the sidebar if that's wrong.`;
    } else {
      headline.textContent = "All semesters done";
      detail.textContent = "Starting that year, you'd be past MA4. Change the year in the sidebar if you're still studying.";
    }

    const heroText = document.createElement("div");
    heroText.append(eyebrow, headline, detail);
    hero.appendChild(heroText);

    if (position.status === "studying") {
      const actions = document.createElement("div");
      actions.className = "studies-hero-actions";
      const toSchedule = document.createElement("button");
      toSchedule.type = "button";
      toSchedule.className = "view-link";
      toSchedule.innerHTML = '<i class="fa-solid fa-clock" aria-hidden="true"></i><span>Weekly schedule</span>';
      toSchedule.addEventListener("click", () => this.data.onOpenSemesterSchedule(position.semester));
      const toPlan = document.createElement("button");
      toPlan.type = "button";
      toPlan.className = "view-link";
      toPlan.innerHTML = '<i class="fa-solid fa-table-cells-large" aria-hidden="true"></i><span>Study plan</span>';
      toPlan.addEventListener("click", () => {
        pendingFocus = { semester: position.semester };
        this.data.onShowInPlan(position.semester);
      });
      actions.append(toSchedule, toPlan);
      hero.appendChild(actions);
    }
    dashboard.appendChild(hero);

    if (position.status !== "studying") {
      dashboard.appendChild(this.createProgressCard(null));
      return dashboard;
    }

    dashboard.appendChild(this.createSummaryStrip(summary));

    const columns = document.createElement("div");
    columns.className = "studies-columns";
    const left = document.createElement("div");
    left.className = "studies-column";
    const right = document.createElement("div");
    right.className = "studies-column";

    left.appendChild(this.createTodayCard(periods));
    left.appendChild(this.createSemesterCoursesCard(position.semester));
    right.appendChild(this.createAgendaDashboardCard());
    right.appendChild(this.createProgressCard(position.semester));
    right.appendChild(this.createHeadsUpCard(position.semester));

    columns.append(left, right);
    dashboard.appendChild(columns);
    return dashboard;
  }

  private createDashboardCard(title: string, icon: string): { card: HTMLElement; body: HTMLElement } {
    const card = document.createElement("section");
    card.className = "studies-card";
    const heading = document.createElement("h3");
    heading.className = "studies-card-title";
    heading.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
    const text = document.createElement("span");
    text.textContent = title;
    heading.appendChild(text);
    const body = document.createElement("div");
    body.className = "studies-card-body";
    card.append(heading, body);
    return { card, body };
  }

  /** Today's classes, or the next day that has some. Uses the regular weekly timetable. */
  private createTodayCard(periods: Period[]): HTMLElement {
    const now = new Date();
    const todayIndex = now.getDay() - 1; // 0 = Monday, -1/5 = weekend
    const byDay = (day: number) => this.data.plannedLectures
      .filter((planned) => planned.lecture.day === day)
      .sort((a, b) => a.lecture.timeStart - b.lecture.timeStart || a.lecture.timeEnd - b.lecture.timeEnd);

    let day = todayIndex >= 0 && todayIndex <= 4 ? todayIndex : -1;
    let lectures = day >= 0 ? byDay(day) : [];
    const isToday = lectures.length > 0;
    if (!isToday) {
      // Next weekday with classes, starting tomorrow (or Monday on weekends).
      for (let offset = 1; offset <= 5; offset += 1) {
        const candidate = ((day >= 0 ? day : -1) + offset) % 5;
        const found = byDay(candidate);
        if (found.length > 0) {
          day = candidate;
          lectures = found;
          break;
        }
      }
    }

    const dayName = day >= 0 ? this.config.days[day] : "";
    const { card, body } = this.createDashboardCard(
      isToday ? `Today · ${dayName}` : lectures.length > 0 ? `No classes today · next on ${dayName}` : "No classes this semester",
      "fa-calendar-day",
    );

    // Exam sessions and holidays have no lectures, but the planner only knows the weekly timetable.
    const month = now.getMonth();
    if ([0, 5, 6, 7].includes(month)) {
      const note = document.createElement("p");
      note.className = "studies-note";
      note.textContent = "Outside the teaching weeks: this is the regular weekly timetable.";
      body.appendChild(note);
    }

    if (lectures.length === 0) {
      body.appendChild(this.createPlaceholderContent("Add courses with a timetable to this semester in the Planner."));
      return card;
    }

    const list = document.createElement("ol");
    list.className = "studies-agenda";
    lectures.forEach((planned) => {
      const { lecture } = planned;
      const item = document.createElement("li");
      item.className = `studies-agenda-item ${lecture.type}`;
      const start = periods[lecture.timeStart]?.startLabel ?? "";
      const end = periods[Math.max(0, lecture.timeEnd - 1)]?.endLabel ?? "";

      const time = document.createElement("span");
      time.className = "studies-agenda-time";
      time.textContent = `${start}–${end}`;

      const what = document.createElement("button");
      what.type = "button";
      what.className = "studies-agenda-what";
      const code = document.createElement("strong");
      code.textContent = lecture.course.abbreviation;
      const name = document.createElement("span");
      name.textContent = lecture.course.name;
      what.append(code, name);
      const link = lecture.course.linkToCourse.trim();
      if (link) {
        what.addEventListener("click", () => this.openCourseModal(link, `${lecture.course.abbreviation} - ${lecture.course.name}`));
      }

      const where = document.createElement("span");
      where.className = "studies-agenda-where";
      const type = { course: "Lecture", exercise: "Exercise", lab: "Lab" }[lecture.type];
      where.textContent = [type, (lecture.room ?? []).join(", ")].filter(Boolean).join(" · ");

      item.append(time, what, where);
      list.appendChild(item);
    });
    body.appendChild(list);
    return card;
  }

  private createSemesterCoursesCard(semester: Semester): HTMLElement {
    const entries = this.data.plannerCourses.filter((entry) => entry.semester === semester);
    const enabled = entries.filter((entry) => entry.enabled);
    const { card, body } = this.createDashboardCard(`Courses in ${semester}`, "fa-book-open");

    if (enabled.length === 0) {
      body.appendChild(this.createPlaceholderContent(`No courses in ${semester} yet. Add some in the Planner.`));
      return card;
    }

    const list = document.createElement("ul");
    list.className = "studies-course-list";
    enabled.forEach((entry) => {
      const { course } = entry;
      const item = document.createElement("li");
      item.className = `studies-course kind-${entry.kind}`;

      const header = document.createElement("div");
      header.className = "studies-course-header";
      const code = document.createElement("button");
      code.type = "button";
      code.className = "plan-course-abbreviation";
      code.textContent = course.abbreviation;
      const link = course.linkToCourse.trim();
      if (link) {
        code.addEventListener("click", () => this.openCourseModal(link, `${course.abbreviation} - ${course.name}`));
      } else {
        code.disabled = true;
      }
      const credits = document.createElement("span");
      credits.className = "plan-course-credits";
      credits.textContent = `${course.credits ?? "–"} ECTS`;
      header.append(code, credits);

      const name = document.createElement("div");
      name.className = "plan-course-name";
      name.textContent = course.name;

      const meta = document.createElement("div");
      meta.className = "studies-course-meta";
      meta.textContent = [course.teacher, course.language].filter(Boolean).join(" · ");

      item.append(header, name, meta, this.createCourseTags(course, entry.kind, { showGroup: false }));
      list.appendChild(item);
    });
    body.appendChild(list);

    const leftOut = entries.length - enabled.length;
    if (leftOut > 0) {
      const note = document.createElement("p");
      note.className = "studies-note";
      note.textContent = `${leftOut} more ${leftOut === 1 ? "course is" : "courses are"} switched off in your plan.`;
      body.appendChild(note);
    }
    return card;
  }

  /** Credits per cycle: semesters before the current one count as done (assuming the courses were passed). */
  private createProgressCard(current: Semester | null): HTMLElement {
    const { card, body } = this.createDashboardCard("Progress", "fa-chart-simple");
    const position = this.data.studyPosition;
    const currentIndex = current ? ALL_SEMESTERS.indexOf(current) : position.status === "graduated" ? ALL_SEMESTERS.length : -1;
    const targets: Record<Cycle, number> = { bachelor: 180, master: 120 };

    (["bachelor", "master"] as const).forEach((cycle) => {
      let done = 0;
      let now = 0;
      let later = 0;
      this.data.plannerCourses.forEach((entry) => {
        if (!entry.enabled || entry.semester === null || cycleOf(entry.semester) !== cycle) {
          return;
        }
        const index = ALL_SEMESTERS.indexOf(entry.semester);
        const credits = entry.course.credits ?? 0;
        if (index < currentIndex) done += credits;
        else if (index === currentIndex) now += credits;
        else later += credits;
      });

      const target = targets[cycle];
      const scale = Math.max(target, done + now + later);
      const row = document.createElement("div");
      row.className = "studies-progress";

      const label = document.createElement("div");
      label.className = "studies-progress-label";
      const name = document.createElement("strong");
      name.textContent = `${CYCLE_LABELS[cycle]} · ${this.data.mainStudies[cycle].value}`;
      const figure = document.createElement("span");
      figure.textContent = `${done} / ${target} ECTS`;
      label.append(name, figure);

      const bar = document.createElement("div");
      bar.className = "studies-progress-bar";
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `${done} ECTS done, ${now} this semester, ${later} planned later, out of ${target}`);
      [["done", done], ["now", now], ["later", later]].forEach(([kind, value]) => {
        const segment = document.createElement("span");
        segment.className = `studies-progress-segment ${kind}`;
        segment.style.width = `${((value as number) / scale) * 100}%`;
        bar.appendChild(segment);
      });

      const legend = document.createElement("div");
      legend.className = "studies-progress-legend";
      legend.textContent = `${done} done · ${now} this semester · ${later} planned later`
        + (done + now + later < target ? ` · ${target - done - now - later} still to plan` : "");

      row.append(label, bar, legend);
      body.appendChild(row);
    });

    const note = document.createElement("p");
    note.className = "studies-note";
    note.textContent = "Earlier semesters count as passed with the courses in your plan.";
    body.appendChild(note);
    return card;
  }

  private createHeadsUpCard(semester: Semester): HTMLElement {
    const { card, body } = this.createDashboardCard("Heads-up", "fa-bell");
    const inSemester = this.data.plannerCourses.filter((entry) => entry.semester === semester);
    const items: Array<{ text: string; action?: { label: string; run: () => void } }> = [];

    const conflicts = this.data.conflictSlotBlocks.length;
    if (conflicts > 0) {
      items.push({
        text: `${conflicts} time ${conflicts === 1 ? "conflict" : "conflicts"} in your ${semester} schedule.`,
        action: { label: "See schedule", run: () => this.data.onOpenSemesterSchedule(semester) },
      });
    }
    const mandatoryOff = inSemester.filter((entry) => entry.kind === "mandatory" && !entry.enabled).length;
    if (mandatoryOff > 0) {
      items.push({
        text: `${mandatoryOff} mandatory ${mandatoryOff === 1 ? "course is" : "courses are"} switched off this semester.`,
        action: { label: "Open plan", run: () => { pendingFocus = { semester }; this.data.onShowInPlan(semester); } },
      });
    }
    const oldTimetables = inSemester.filter((entry) => entry.enabled && entry.course.timetableOutdated).length;
    if (oldTimetables > 0) {
      items.push({ text: `${oldTimetables} ${oldTimetables === 1 ? "course uses" : "courses use"} last year's timetable (not published yet).` });
    }
    const unplaced = this.data.plannerCourses.filter((entry) => entry.kind === "extra" && entry.semester === null).length;
    if (unplaced > 0) {
      items.push({
        text: `${unplaced} loaded ${unplaced === 1 ? "course is" : "courses are"} waiting to be placed in a semester.`,
        action: { label: "Open plan", run: () => this.data.onShowInPlan(semester) },
      });
    }

    if (items.length === 0) {
      const ok = document.createElement("p");
      ok.className = "studies-all-clear";
      ok.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i> All clear for this semester.';
      body.appendChild(ok);
      return card;
    }

    const list = document.createElement("ul");
    list.className = "studies-headsup";
    items.forEach((entry) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = entry.text;
      item.appendChild(text);
      if (entry.action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "studies-headsup-action";
        button.textContent = entry.action.label;
        button.addEventListener("click", entry.action.run);
        item.appendChild(button);
      }
      list.appendChild(item);
    });
    body.appendChild(list);
    return card;
  }

  private createSemesterTabs(): HTMLElement {
    const tabs = document.createElement("div");
    tabs.className = "semester-tabs";
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Semester");

    const enabledCountBySemester = new Map<Semester, number>();
    this.data.plannerCourses.forEach((entry) => {
      if (entry.enabled && entry.semester !== null) {
        enabledCountBySemester.set(entry.semester, (enabledCountBySemester.get(entry.semester) ?? 0) + 1);
      }
    });

    this.data.semesters.forEach((semester) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "semester-tab";
      tab.dataset.semester = semester;
      tab.setAttribute("aria-pressed", `${semester === this.data.activeSemester}`);

      const label = document.createElement("span");
      label.textContent = semester;
      tab.appendChild(label);

      const count = enabledCountBySemester.get(semester) ?? 0;
      if (count === 0) {
        tab.classList.add("empty");
      }
      tab.title = `${semester}: ${count} ${count === 1 ? "course" : "courses"}. Drop a course here to move it.`;

      if (semester === this.data.activeSemester) {
        tab.classList.add("active");
      }

      tab.addEventListener("click", () => {
        if (semester === this.data.activeSemester) {
          return;
        }

        this.data.onChangeSemester(semester);
      });

      this.makeSemesterDropTarget(tab, semester);
      tabs.appendChild(tab);
    });

    return tabs;
  }

  /** Lets a course card be dropped on this element to move the course to `semester`. */
  private makeSemesterDropTarget(target: HTMLElement, semester: Semester, scope?: CardScope): void {
    const accepts = (): boolean => {
      return draggedCourse !== null && draggedCourse.semester !== semester && draggedCourse.validSemesters.includes(semester);
    };

    target.addEventListener("dragover", (event) => {
      if (!accepts()) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      target.classList.add("drag-over");
    });
    target.addEventListener("dragleave", (event) => {
      if (!target.contains(event.relatedTarget as Node | null)) {
        target.classList.remove("drag-over");
      }
    });
    target.addEventListener("drop", (event) => {
      target.classList.remove("drag-over");
      if (!draggedCourse || !accepts()) {
        return;
      }
      event.preventDefault();
      const courseId = draggedCourse.id;
      if (scope) {
        pendingScrollAnchor = { key: draggedCourse.anchorKey, scope, top: event.clientY - 16 };
      }
      TimetableWidget.endCourseDrag();
      this.data.onMoveCourse(courseId, semester);
    });
  }

  private static rememberCard(card: HTMLElement): void {
    const { anchorKey, anchorScope } = card.dataset;
    if (anchorKey && anchorScope) {
      pendingScrollAnchor = { key: anchorKey, scope: anchorScope as CardScope, top: card.getBoundingClientRect().top };
    }
  }

  /** Called by the controller right after a re-render. */
  public static restoreScrollAnchor(root: ParentNode): void {
    if (pendingFocus) {
      TimetableWidget.applyFocus(root, pendingFocus);
      pendingFocus = null;
      pendingScrollAnchor = null;
      return;
    }

    const anchor = pendingScrollAnchor;
    pendingScrollAnchor = null;
    if (!anchor) {
      return;
    }

    const card = Array.from(root.querySelectorAll<HTMLElement>(`[data-anchor-scope="${anchor.scope}"]`))
      .find((element) => element.dataset.anchorKey === anchor.key);
    if (!card) {
      return;
    }

    // Scroll the inner pane first; whatever it can't absorb is taken by the page.
    const scroller = findScrollParent(card);
    if (scroller) {
      scroller.scrollTop += card.getBoundingClientRect().top - anchor.top;
    }
    const remaining = card.getBoundingClientRect().top - anchor.top;
    if (Math.abs(remaining) >= 1) {
      window.scrollBy(0, remaining);
    }
  }

  /** Scrolls the plan to a semester (or one of its course cards) and briefly highlights it. */
  private static applyFocus(root: ParentNode, focus: PendingFocus): void {
    const cell = root.querySelector<HTMLElement>(`.plan-semester[data-semester="${focus.semester}"]`);
    const card = focus.courseId && cell
      ? Array.from(cell.querySelectorAll<HTMLElement>(".plan-course-card"))
        .find((element) => (element.dataset.courseIds ?? "").split("\n").includes(focus.courseId ?? ""))
      : undefined;
    const target = card ?? cell;
    if (!target) {
      return;
    }

    target.scrollIntoView({ block: "center" });
    target.classList.add("flash");
    window.setTimeout(() => target.classList.remove("flash"), 1800);
  }

  private static startCourseDrag(entry: DraggedCourse): void {
    draggedCourse = entry;
    document.body.classList.add("course-dragging");
    document.querySelectorAll<HTMLElement>("[data-semester]").forEach((element) => {
      const semester = element.dataset.semester as Semester;
      const isValid = entry.validSemesters.includes(semester) && semester !== entry.semester;
      element.classList.toggle("drop-valid", isValid);
      element.classList.toggle("drop-invalid", !isValid && semester !== entry.semester);
    });
    document.querySelectorAll<HTMLElement>("[data-unplace-plan]").forEach((element) => {
      element.classList.toggle("drop-valid", TimetableWidget.canUnplaceInto(element.dataset.unplacePlan ?? ""));
    });
  }

  /** A placed extra course can be dragged back into the box of the plan it was loaded from. */
  private static canUnplaceInto(planKey: string): boolean {
    return draggedCourse !== null && draggedCourse.kind === "extra" && draggedCourse.semester !== null && draggedCourse.planKey === planKey;
  }

  private makeUnplaceTarget(target: HTMLElement, planKey: string): void {
    target.addEventListener("dragover", (event) => {
      if (!TimetableWidget.canUnplaceInto(planKey)) {
        return;
      }
      event.preventDefault();
      target.classList.add("drag-over");
    });
    target.addEventListener("dragleave", (event) => {
      if (!target.contains(event.relatedTarget as Node | null)) {
        target.classList.remove("drag-over");
      }
    });
    target.addEventListener("drop", (event) => {
      target.classList.remove("drag-over");
      if (!draggedCourse || !TimetableWidget.canUnplaceInto(planKey)) {
        return;
      }
      event.preventDefault();
      const courseId = draggedCourse.id;
      pendingScrollAnchor = { key: draggedCourse.anchorKey, scope: "box", top: event.clientY - 16 };
      TimetableWidget.endCourseDrag();
      this.data.onUnplaceCourse(courseId);
    });
  }

  private static endCourseDrag(): void {
    draggedCourse = null;
    document.body.classList.remove("course-dragging");
    document.querySelectorAll<HTMLElement>(".drop-valid, .drop-invalid, .drag-over").forEach((element) => {
      element.classList.remove("drop-valid", "drop-invalid", "drag-over");
    });
  }

  private createCurriculumSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "curriculum-section side-panel";
    section.setAttribute("aria-label", "Add courses");

    const optionalCount = this.data.plannerCourses.filter((entry) => entry.kind === "optional").length;
    const extraEntries = this.data.plannerCourses.filter((entry) => entry.kind === "extra");
    const unplacedCount = extraEntries.filter((entry) => entry.semester === null).length;
    const panes: Array<{
      key: CurriculumPaneKey;
      label: string;
      fullLabel: string;
      count: number;
      build: () => HTMLElement;
    }> = [
      {
        key: "optional",
        label: "Optional courses",
        fullLabel: `Optional courses of your ${CYCLE_LABELS[this.data.activeCycle].toLowerCase()} study (added)`,
        count: optionalCount,
        build: () => this.createOptionalCoursesContent(),
      },
      {
        key: "extra",
        label: "Other plans",
        fullLabel: unplacedCount > 0
          ? `Courses loaded from other study plans (${unplacedCount} waiting to be placed)`
          : "Courses loaded from other study plans",
        count: unplacedCount > 0 ? unplacedCount : extraEntries.length,
        build: () => this.createExtraCurriculumContent(),
      },
    ];

    const tabList = document.createElement("div");
    tabList.className = "curriculum-tabs";
    tabList.setAttribute("role", "tablist");

    const body = document.createElement("div");
    body.className = "curriculum-panel-body";
    body.setAttribute("role", "tabpanel");
    body.addEventListener(
        "scroll",
        () => this.data.onCurriculumPaneScroll(body.dataset.curriculumPaneKey ?? activeCurriculumPane, body.scrollTop),
        { passive: true },
    );

    const tabButtons = new Map<CurriculumPaneKey, HTMLButtonElement>();

    const showPane = (key: CurriculumPaneKey): void => {
      const pane = panes.find((entry) => entry.key === key) ?? panes[0];
      activeCurriculumPane = pane.key;
      body.dataset.curriculumPaneKey = pane.key;
      body.replaceChildren(pane.build());
      body.scrollTop = this.data.curriculumPaneScrollTop[pane.key] ?? 0;

      tabButtons.forEach((button, buttonKey) => {
        const selected = buttonKey === pane.key;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", `${selected}`);
        button.tabIndex = selected ? 0 : -1;
      });
    };

    panes.forEach((pane) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "curriculum-tab";
      button.setAttribute("role", "tab");
      button.title = pane.fullLabel;

      const label = document.createElement("span");
      label.textContent = pane.label;
      button.appendChild(label);

      if (pane.count > 0) {
        const badge = document.createElement("span");
        badge.className = "curriculum-tab-count";
        badge.textContent = `${pane.count}`;
        button.appendChild(badge);
        button.setAttribute("aria-label", `${pane.fullLabel}: ${pane.count}`);
      }

      button.addEventListener("click", () => showPane(pane.key));
      tabButtons.set(pane.key, button);
      tabList.appendChild(button);
    });

    showPane(activeCurriculumPane);

    section.appendChild(tabList);
    section.appendChild(body);
    return section;
  }

  /**
   * The whole curriculum at a glance: one row per study year, autumn semesters on the left and spring on the right.
   * Courses are only taught in one season, so dragging a course always stays within its column.
   */
  private createPlanBoard(): HTMLElement {
    const card = document.createElement("section");
    card.className = "plan-board-card";
    card.setAttribute("aria-label", "Study plan by semester");

    const header = document.createElement("div");
    header.className = "plan-board-header";

    header.appendChild(this.createCycleSwitch());

    const legend = document.createElement("ul");
    legend.className = "plan-board-legend";
    (["mandatory", "optional", "extra"] as const).forEach((kind) => {
      const item = document.createElement("li");
      item.className = `plan-legend-item kind-${kind}`;
      item.textContent = COURSE_KIND_LABELS[kind];
      legend.appendChild(item);
    });
    header.appendChild(legend);
    card.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "plan-grid";

    ["Autumn", "Spring"].forEach((season) => {
      const seasonHead = document.createElement("div");
      seasonHead.className = "plan-season-head";
      seasonHead.textContent = `${season} semesters`;
      grid.appendChild(seasonHead);
    });

    PLAN_YEARS.filter((year) => year.cycle === this.data.activeCycle).forEach((year) => {
      const yearLabel = document.createElement("div");
      yearLabel.className = "plan-year-label";
      yearLabel.textContent = year.label;
      grid.appendChild(yearLabel);

      year.semesters.forEach((semester) => grid.appendChild(this.createPlanSemesterCell(semester)));
    });

    card.appendChild(grid);
    return card;
  }

  /** Bachelor and master are planned separately; each tab shows its own credit total. */
  private createCycleSwitch(): HTMLElement {
    const switcher = document.createElement("div");
    switcher.className = "cycle-switch";
    switcher.setAttribute("role", "tablist");
    switcher.setAttribute("aria-label", "Study cycle");

    (["bachelor", "master"] as const).forEach((cycle) => {
      const credits = this.coursesInCycle(cycle)
        .filter((entry) => entry.enabled)
        .reduce((total, entry) => total + (entry.course.credits ?? 0), 0);
      const isActive = cycle === this.data.activeCycle;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "cycle-switch-option";
      button.classList.toggle("active", isActive);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", `${isActive}`);

      const label = document.createElement("span");
      label.className = "cycle-switch-label";
      label.textContent = CYCLE_LABELS[cycle];

      const meta = document.createElement("span");
      meta.className = "cycle-switch-meta";
      meta.textContent = `${credits} ECTS`;

      button.appendChild(label);
      button.appendChild(meta);
      button.addEventListener("click", () => this.data.onChangeCycle(cycle));
      switcher.appendChild(button);
    });

    return switcher;
  }

  private coursesInCycle(cycle: Cycle): PlannerCourse[] {
    const semesters = CYCLE_SEMESTERS[cycle];
    return this.data.plannerCourses.filter((entry) => entry.semester !== null && semesters.includes(entry.semester));
  }

  private createPlanSemesterCell(semester: Semester): HTMLElement {
    const kindOrder: Record<CourseKind, number> = { mandatory: 0, optional: 1, extra: 2 };
    const entries = this.data.plannerCourses
      .filter((entry) => entry.semester === semester)
      .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.course.abbreviation.localeCompare(b.course.abbreviation));
    const enabledEntries = entries.filter((entry) => entry.enabled);
    const credits = enabledEntries.reduce((total, entry) => total + (entry.course.credits ?? 0), 0);

    const cell = document.createElement("section");
    cell.className = "plan-semester";
    cell.dataset.semester = semester;
    cell.classList.toggle("empty", entries.length === 0);
    cell.setAttribute("aria-label", `${semester} courses`);
    this.makeSemesterDropTarget(cell, semester, "board");

    const header = document.createElement("header");
    header.className = "plan-semester-title";

    const name = document.createElement("span");
    name.className = "plan-semester-name";
    name.textContent = semester;

    const meta = document.createElement("span");
    meta.className = "plan-semester-meta";
    meta.textContent = entries.length === 0
      ? "No courses"
      : `${enabledEntries.length} ${enabledEntries.length === 1 ? "course" : "courses"} · ${credits} ECTS`;
    if (enabledEntries.length !== entries.length) {
      meta.title = `${entries.length - enabledEntries.length} left out`;
    }

    header.appendChild(name);
    header.appendChild(meta);

    const disabledMandatory = entries.filter((entry) => entry.kind === "mandatory" && !entry.enabled).length;
    if (disabledMandatory > 0) {
      const warning = document.createElement("span");
      warning.className = "plan-semester-warning";
      warning.title = `${disabledMandatory} mandatory ${disabledMandatory === 1 ? "course is" : "courses are"} left out`;
      warning.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>${disabledMandatory}`;
      header.appendChild(warning);
    }

    const scheduleButton = document.createElement("button");
    scheduleButton.type = "button";
    scheduleButton.className = "plan-semester-view";
    scheduleButton.title = `Open the weekly schedule of ${semester}`;
    scheduleButton.setAttribute("aria-label", `Weekly schedule of ${semester}`);
    scheduleButton.innerHTML = '<i class="fa-solid fa-clock" aria-hidden="true"></i><span>Schedule</span>';
    scheduleButton.addEventListener("click", () => this.data.onOpenSemesterSchedule(semester));
    header.appendChild(scheduleButton);

    const cards = document.createElement("div");
    cards.className = "plan-semester-cards";

    if (entries.length === 0) {
      const dropHint = document.createElement("div");
      dropHint.className = "plan-semester-drop-hint";
      dropHint.textContent = "Drop a course here";
      cards.appendChild(dropHint);
    }

    entries.forEach((entry) => cards.appendChild(this.createPlanCourseCard(entry, { compact: true })));

    cell.appendChild(header);
    cell.appendChild(cards);
    return cell;
  }

  /** Schedule tab side panel: the courses of the semester being shown, so they can be toggled while checking conflicts. */
  private createSemesterCoursesPanel(): HTMLElement {
    const semester = this.data.activeSemester;
    const entries = this.data.plannerCourses.filter((entry) => entry.semester === semester);

    const panel = document.createElement("section");
    panel.className = "semester-courses-panel side-panel";
    panel.dataset.semester = semester;
    this.makeSemesterDropTarget(panel, semester, "list");

    const heading = document.createElement("h3");
    heading.className = "timetable-tab-title";
    heading.innerHTML = '<i class="fa-solid fa-list-check panel-title-icon" aria-hidden="true"></i>';
    const headingText = document.createElement("span");
    headingText.textContent = `${semester} courses`;
    heading.appendChild(headingText);

    const body = document.createElement("div");
    body.className = "curriculum-panel-body";
    body.dataset.curriculumPaneKey = "schedule";
    body.addEventListener("scroll", () => this.data.onCurriculumPaneScroll("schedule", body.scrollTop), { passive: true });

    if (entries.length === 0) {
      body.appendChild(this.createPlaceholderContent(`No courses in ${semester}. Add or move some from the Study plan tab.`));
    } else {
      const list = document.createElement("div");
      list.className = "plan-semester-cards";
      entries.forEach((entry) => list.appendChild(this.createPlanCourseCard(entry)));
      body.appendChild(list);
    }

    panel.appendChild(heading);
    panel.appendChild(body);
    return panel;
  }

  /**
   * `compact` (plan board) keeps the name on one line and moves the group into the tooltip.
   * `inPlanBox` (other plans pane) also says where the course currently is.
   */
  private createPlanCourseCard(entry: PlannerCourse, options: { compact?: boolean; inPlanBox?: boolean } = {}): HTMLElement {
    const { course } = entry;
    const isUnplaced = entry.semester === null;
    const card = document.createElement("article");
    card.className = `plan-course-card kind-${entry.kind}`;
    card.classList.toggle("disabled", !entry.enabled && !isUnplaced);
    card.classList.toggle("unplaced", isUnplaced);
    const anchorKey = entry.variantGroupKey ?? entry.id;
    card.dataset.anchorKey = anchorKey;
    card.dataset.courseIds = [entry.id, ...(entry.variants ?? []).map((variant) => variant.id)].join("\n");
    card.dataset.anchorScope = options.inPlanBox ? "box" : options.compact ? "board" : "list";
    card.classList.toggle("compact", options.compact === true);
    if (options.compact) {
      card.title = `${course.name}\n${course.group}${course.teacher ? ` · ${course.teacher}` : ""}`;
    }

    const planColor = this.data.planColorByKey[this.toPlanKey(entry.studyPlan)];
    if (planColor) {
      card.style.setProperty("--plan-color", planColor);
    }

    const canMove = isUnplaced || entry.validSemesters.length > 1;
    if (canMove && !isCompactScreen()) {
      card.draggable = true;
      card.classList.add("draggable");
      card.addEventListener("dragstart", (event) => {
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", entry.id);
        }
        // Defer so the browser grabs the drag image before the card is faded out.
        window.requestAnimationFrame(() => card.classList.add("dragging"));
        TimetableWidget.startCourseDrag({ ...entry, anchorKey, planKey: this.toPlanKey(entry.studyPlan) });
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        TimetableWidget.endCourseDrag();
      });
    }

    // An unplaced course has nothing to switch on yet; show a handle inviting a drag instead.
    let toggle: HTMLElement;
    if (isUnplaced) {
      toggle = document.createElement("span");
      toggle.className = "plan-course-grip";
      toggle.title = isCompactScreen() ? "Pick a semester in the menu" : "Drag into a semester";
      toggle.innerHTML = '<i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>';
    } else {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "plan-course-toggle";
      checkbox.checked = entry.enabled;
      checkbox.title = entry.enabled ? "Included: untick to leave this course out" : "Left out: tick to include this course";
      checkbox.setAttribute("aria-label", `Include ${course.abbreviation} in ${entry.semester}`);
      checkbox.addEventListener("change", () => {
        TimetableWidget.rememberCard(card);
        this.data.onToggleCourseEnabled(entry.id);
      });
      toggle = checkbox;
    }

    const body = document.createElement("div");
    body.className = "plan-course-body";

    const header = document.createElement("div");
    header.className = "plan-course-header";

    const abbreviation = document.createElement("button");
    abbreviation.type = "button";
    abbreviation.className = "plan-course-abbreviation";
    abbreviation.textContent = course.abbreviation;
    const linkToCourse = course.linkToCourse.trim();
    if (linkToCourse.length > 0) {
      abbreviation.title = "Open the course page";
      abbreviation.addEventListener("click", () => {
        this.openCourseModal(linkToCourse, `${course.abbreviation} - ${course.name}`);
      });
    } else {
      abbreviation.disabled = true;
    }

    const credits = document.createElement("span");
    credits.className = "plan-course-credits";
    credits.textContent = `${course.credits ?? "–"} ECTS`;

    header.appendChild(abbreviation);
    header.appendChild(credits);

    const name = entry.variants ? this.createVariantPicker(entry, card) : document.createElement("div");
    if (!entry.variants) {
      name.className = "plan-course-name";
      name.textContent = course.name;
    }

    const tags = this.createCourseTags(course, entry.kind, { editedAt: this.data.courseEdits[entry.id]?.editedAt });
    if (options.inPlanBox) {
      const where = document.createElement("span");
      where.className = `course-tag placed${isUnplaced ? " waiting" : ""}`;
      where.textContent = isUnplaced ? "Not placed" : `in ${entry.semester}`;
      tags.appendChild(where);
    } else if (entry.kind !== "extra" && entry.semester !== entry.originSemester) {
      const moved = document.createElement("span");
      moved.className = "course-tag moved";
      moved.textContent = `from ${entry.originSemester}`;
      moved.title = `Its study plan lists it in ${entry.originSemester}`;
      tags.appendChild(moved);
    }
    if (entry.kind === "extra" && !options.inPlanBox) {
      const origin = document.createElement("span");
      origin.className = "course-tag origin";
      origin.textContent = `${entry.studyPlan.semester} ${entry.studyPlan.name}`;
      origin.title = `Loaded from ${entry.studyPlan.semester} - ${entry.studyPlan.name}`;
      tags.appendChild(origin);
    }

    body.appendChild(header);
    body.appendChild(name);
    body.appendChild(tags);

    if (entry.kind === "mandatory" && !entry.enabled) {
      const warning = document.createElement("div");
      warning.className = "plan-course-warning";
      warning.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>Mandatory for your main study</span>';
      body.appendChild(warning);
    }

    const actions = document.createElement("div");
    actions.className = "plan-course-actions";

    if (canMove) {
      const select = document.createElement("select");
      select.className = "plan-course-semester";
      select.setAttribute("aria-label", `Semester of ${course.abbreviation}`);
      select.title = "Move to another semester";
      if (entry.kind === "extra") {
        const none = document.createElement("option");
        none.value = "";
        none.textContent = "—";
        none.title = "Not placed";
        none.selected = isUnplaced;
        select.appendChild(none);
      }
      entry.validSemesters.forEach((semester) => {
        const option = document.createElement("option");
        option.value = semester;
        option.textContent = semester;
        option.selected = semester === entry.semester;
        select.appendChild(option);
      });
      select.addEventListener("change", () => {
        TimetableWidget.rememberCard(card);
        if (select.value) {
          this.data.onMoveCourse(entry.id, select.value as Semester);
        } else {
          this.data.onUnplaceCourse(entry.id);
        }
      });
      actions.appendChild(select);
    }

    actions.appendChild(this.createEditButton(entry.id, course, () => TimetableWidget.rememberCard(card)));

    if (entry.kind !== "mandatory") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "plan-course-remove";
      remove.title = "Remove from plan";
      remove.setAttribute("aria-label", `Remove ${course.abbreviation} from plan`);
      remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      remove.addEventListener("click", () => this.data.onRemoveCourse(entry.id));
      actions.appendChild(remove);
    }

    card.appendChild(toggle);
    card.appendChild(body);
    card.appendChild(actions);
    return card;
  }

  /** One card for all sections of a course; the dropdown picks which section is taken. */
  private createVariantPicker(entry: PlannerCourse, card: HTMLElement): HTMLElement {
    const select = document.createElement("select");
    select.className = "plan-course-variant";
    const choice = entry.course.choice;
    select.title = choice
      ? `${choice.label}: choose one of ${entry.variants?.length ?? 0} courses`
      : `${entry.variants?.length ?? 0} sections of ${baseCourseCode(entry.course)}: choose yours`;
    select.setAttribute("aria-label", choice ? `Course for ${choice.label}` : `Section of ${baseCourseCode(entry.course)}`);

    const variants = [...(entry.variants ?? [])];
    if (choice) {
      variants.sort((a, b) => a.course.name.localeCompare(b.course.name));
    }
    variants.forEach((variant) => {
      const option = document.createElement("option");
      option.value = variant.id;
      if (choice) {
        const language = variant.course.language ? ` · ${variant.course.language}` : "";
        option.textContent = `${variant.course.name} (${variant.course.abbreviation}${language})`;
      } else {
        const suffix = variant.course.abbreviation.slice(baseCourseCode(variant.course).length);
        option.textContent = `${variant.course.name} ${suffix}`.trim();
      }
      option.selected = variant.id === entry.id;
      select.appendChild(option);
    });

    select.addEventListener("change", () => {
      if (entry.variantGroupKey) {
        TimetableWidget.rememberCard(card);
        this.data.onChooseVariant(entry.variantGroupKey, select.value);
      }
    });
    // Let the dropdown open without starting a drag of the whole card.
    select.addEventListener("pointerdown", (event) => event.stopPropagation());
    return select;
  }

  /** Kind (mandatory/optional/extra), group and weekly lecture mix of a course. */
  private createCourseTags(course: Course, kind: CourseKind, options: { showGroup?: boolean; editedAt?: string } = {}): HTMLElement {
    const tags = document.createElement("div");
    tags.className = "course-tags";

    const kindTag = document.createElement("span");
    kindTag.className = `course-tag kind kind-${kind}`;
    kindTag.textContent = COURSE_KIND_LABELS[kind];
    tags.appendChild(kindTag);

    if (course.group && options.showGroup !== false) {
      const group = document.createElement("span");
      group.className = "course-tag group";
      group.textContent = course.group;
      group.title = course.group;
      tags.appendChild(group);
    }

    const mix = document.createElement("span");
    mix.className = "course-tag mix";
    mix.textContent = describeLectureMix(course);
    tags.appendChild(mix);

    if (course.choice) {
      const slot = document.createElement("span");
      slot.className = "course-tag choice";
      slot.textContent = "SHS";
      slot.title = `${course.choice.label}: pick one course`;
      tags.insertBefore(slot, tags.children[1] ?? null);
    }

    if (course.timetableOutdated) {
      const outdated = document.createElement("span");
      outdated.className = "course-tag outdated";
      outdated.textContent = "old timetable";
      outdated.title = "This year's timetable isn't published yet; showing the one from the previous scrape.";
      tags.appendChild(outdated);
    }

    if (options.editedAt) {
      const edited = document.createElement("span");
      edited.className = "course-tag edited";
      edited.textContent = "Edited";
      edited.title = `Corrected by hand on ${new Date(options.editedAt).toLocaleDateString()}`;
      tags.appendChild(edited);
    }

    return tags;
  }

  /** Optional courses of the main study: by semester first, then by group. Tick to add, or drag into a semester. */
  private createOptionalCoursesContent(): HTMLElement {
    if (this.data.optionalSemesterGroups.length === 0) {
      return this.createPlaceholderContent(`No optional courses in your ${CYCLE_LABELS[this.data.activeCycle].toLowerCase()} study plan.`);
    }

    const placedById = new Map(
      this.data.plannerCourses.filter((entry) => entry.kind === "optional").map((entry) => [entry.id, entry]),
    );
    const collapsed = new Set(this.data.collapsedOptionalSemesters);

    const wrapper = document.createElement("div");
    wrapper.className = "optional-courses-grid";

    const hint = document.createElement("p");
    hint.className = "panel-hint";
    hint.textContent = isCompactScreen()
      ? "Tick a course to add it to the semester its plan lists; change the semester from its card afterwards."
      : "Tick a course to add it to the semester its plan lists, or drag it straight into any semester of the same season.";
    wrapper.appendChild(hint);

    this.data.optionalSemesterGroups.forEach((semesterGroup) => {
      const section = document.createElement("details");
      section.className = "optional-group optional-semester";
      const initiallyOpen = !collapsed.has(semesterGroup.semester);
      section.open = initiallyOpen;
      // Setting `open` while rendering also fires "toggle"; only report real changes.
      section.addEventListener("toggle", () => {
        if (section.open !== initiallyOpen) {
          this.data.onToggleOptionalSemesterOpen(semesterGroup.semester, section.open);
        }
      });

      const allCourses = semesterGroup.groups.flatMap((group) => group.courses);
      const added = allCourses.filter((entry) => placedById.has(entry.id));
      const addedCredits = added.reduce((total, entry) => total + (entry.course.credits ?? 0), 0);

      const title = document.createElement("summary");
      title.className = "optional-group-title";

      const titleText = document.createElement("span");
      titleText.className = "optional-group-title-text";
      titleText.textContent = `${semesterGroup.semester} · ${allCourses.length} options`;

      const badge = document.createElement("span");
      badge.className = "optional-group-selected-credits";
      badge.textContent = added.length > 0 ? `${added.length} added · ${addedCredits} ECTS` : "none added";

      title.appendChild(titleText);
      title.appendChild(badge);
      section.appendChild(title);

      semesterGroup.groups.forEach((group) => {
        const subgroup = document.createElement("div");
        subgroup.className = "optional-subgroup";

        const subgroupTitle = document.createElement("div");
        subgroupTitle.className = "optional-subgroup-title";
        subgroupTitle.textContent = group.groupName;
        subgroupTitle.title = group.groupName;
        subgroup.appendChild(subgroupTitle);

        const cards = document.createElement("div");
        cards.className = "optional-group-cards";
        group.courses.forEach((entry) => cards.appendChild(this.createOptionalCourseCard(entry, placedById.get(entry.id))));
        subgroup.appendChild(cards);

        section.appendChild(subgroup);
      });

      wrapper.appendChild(section);
    });

    return wrapper;
  }

  private createOptionalCourseCard(entry: CurriculumCourse, placed: PlannerCourse | undefined): HTMLElement {
    const { course } = entry;
    const originSemester = entry.studyPlans[0]?.semester ?? "BA1";
    const card = document.createElement("article");
    card.className = "optional-course-card";
    card.classList.toggle("selected", placed !== undefined);
    card.dataset.anchorKey = entry.id;
    card.dataset.anchorScope = "optional";

    // Dragging an optional course into a semester adds it there directly (not on phones).
    card.draggable = !isCompactScreen();
    card.classList.toggle("draggable", card.draggable);
    card.addEventListener("dragstart", (event) => {
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", entry.id);
      }
      window.requestAnimationFrame(() => card.classList.add("dragging"));
      TimetableWidget.startCourseDrag({
        id: entry.id,
        anchorKey: entry.id,
        kind: "optional",
        semester: placed?.semester ?? null,
        validSemesters: getPlacementSemesters(originSemester, "optional"),
        planKey: entry.studyPlans[0] ? this.toPlanKey(entry.studyPlans[0]) : "",
      });
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      TimetableWidget.endCourseDrag();
    });

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "optional-course-toggle";
    toggle.checked = placed !== undefined;
    toggle.setAttribute("aria-label", `Add ${course.abbreviation} to the plan`);
    toggle.addEventListener("change", () => {
      TimetableWidget.rememberCard(card);
      this.data.onToggleOptionalCourse(entry.id);
    });

    const content = document.createElement("button");
    content.type = "button";
    content.className = "optional-course-content";
    const linkToCourse = course.linkToCourse.trim();
    if (linkToCourse.length > 0) {
      content.title = "Open the course page";
      content.addEventListener("click", () => this.openCourseModal(linkToCourse, `${course.abbreviation} - ${course.name}`));
    }

    const header = document.createElement("div");
    header.className = "optional-course-header";

    const abbreviation = document.createElement("span");
    abbreviation.className = "optional-course-abbreviation";
    abbreviation.textContent = course.abbreviation;

    const credits = document.createElement("span");
    credits.className = "optional-course-credits";
    credits.textContent = `${course.credits ?? "–"} ECTS`;

    header.appendChild(abbreviation);
    header.appendChild(credits);

    const name = document.createElement("div");
    name.className = "optional-course-name";
    name.textContent = course.name;

    const tags = this.createCourseTags(course, "optional", { showGroup: false, editedAt: this.data.courseEdits[entry.id]?.editedAt });
    if (placed?.semester) {
      const where = document.createElement("span");
      where.className = `course-tag placed${placed.semester !== originSemester ? " moved" : ""}`;
      where.textContent = `in ${placed.semester}${placed.enabled ? "" : " (off)"}`;
      tags.appendChild(where);
    }

    content.appendChild(header);
    content.appendChild(name);
    content.appendChild(tags);

    card.appendChild(toggle);
    card.appendChild(content);
    card.appendChild(this.createEditButton(entry.id, course, () => TimetableWidget.rememberCard(card)));
    return card;
  }

  private createExtraCurriculumContent(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "extra-curriculum-content";

    const addRow = document.createElement("div");
    addRow.className = "extra-curriculum-add-row";

    const addLabel = document.createElement("label");
    addLabel.className = "extra-curriculum-add-label";
    addLabel.setAttribute("for", "extra-curriculum-dropdown");
    addLabel.textContent = "Load a course or study plan";

    const combo = document.createElement("div");
    combo.className = "extra-curriculum-combobox";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "extra-curriculum-dropdown";
    input.id = "extra-curriculum-dropdown";
    input.placeholder = "Search course or study plan...";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");

    const optionsList = document.createElement("div");
    optionsList.className = "extra-curriculum-options";
    optionsList.setAttribute("role", "listbox");

    let isOpen = false;
    let activeIndex = -1;
    let filtered = [...this.data.extraCurriculumAddOptions];
    let isPositioned = false;

    const ensureOptionsMounted = (): void => {
      if (!document.body.contains(optionsList)) {
        document.body.appendChild(optionsList);
      }
    };

    const detachOptions = (): void => {
      if (document.body.contains(optionsList)) {
        optionsList.remove();
      }
    };

    const updateOptionsPosition = (): void => {
      const rect = input.getBoundingClientRect();
      optionsList.style.left = `${rect.left}px`;
      optionsList.style.top = `${rect.bottom + 4}px`;
      optionsList.style.width = `${rect.width}px`;
    };

    const bindFloatingListeners = (): void => {
      if (isPositioned) {
        return;
      }
      isPositioned = true;
      window.addEventListener("resize", updateOptionsPosition);
      window.addEventListener("scroll", updateOptionsPosition, true);
    };

    const unbindFloatingListeners = (): void => {
      if (!isPositioned) {
        return;
      }
      isPositioned = false;
      window.removeEventListener("resize", updateOptionsPosition);
      window.removeEventListener("scroll", updateOptionsPosition, true);
    };

    const renderOptions = (): void => {
      optionsList.replaceChildren();

      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "extra-curriculum-option-empty";
        empty.textContent = "No matching course or plan";
        optionsList.appendChild(empty);
        return;
      }

      let lastPrefix = "";
      filtered.forEach((option, index) => {
        const prefix = option.label.startsWith("Plan:") ? "Plans" : "Courses";
        if (prefix !== lastPrefix) {
          const header = document.createElement("div");
          header.className = "extra-curriculum-option-group";
          header.textContent = prefix;
          optionsList.appendChild(header);
          lastPrefix = prefix;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "extra-curriculum-option";
        if (index === activeIndex) {
          button.classList.add("active");
        }
        button.textContent = option.label;

        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          input.value = "";
          this.data.onAddExtraCurriculumItem(option.key);
        });

        optionsList.appendChild(button);
      });
    };

    const openOptions = (): void => {
      isOpen = true;
      combo.classList.add("open");
      optionsList.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      ensureOptionsMounted();
      updateOptionsPosition();
      bindFloatingListeners();
      renderOptions();
    };

    const closeOptions = (): void => {
      isOpen = false;
      combo.classList.remove("open");
      optionsList.classList.remove("open");
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
      unbindFloatingListeners();
      detachOptions();
    };

    const updateFilter = (): void => {
      filtered = TimetableWidget.filterOptions(this.data.extraCurriculumAddOptions, input.value);
      activeIndex = filtered.length > 0 ? 0 : -1;
      if (isOpen) {
        renderOptions();
      }
    };

    input.addEventListener("focus", () => {
      updateFilter();
      openOptions();
    });

    input.addEventListener("input", () => {
      updateFilter();
      openOptions();
    });

    input.addEventListener("keydown", (event) => {
      if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        updateFilter();
        openOptions();
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filtered.length > 0) {
          activeIndex = (activeIndex + 1 + filtered.length) % filtered.length;
          renderOptions();
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length > 0) {
          activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
          renderOptions();
        }
      } else if (event.key === "Enter") {
        if (isOpen && activeIndex >= 0 && filtered[activeIndex]) {
          event.preventDefault();
          input.value = "";
          this.data.onAddExtraCurriculumItem(filtered[activeIndex].key);
        }
      } else if (event.key === "Escape") {
        closeOptions();
      }
    });

    combo.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!combo.contains(document.activeElement) && !optionsList.contains(document.activeElement)) {
          closeOptions();
        }
      }, 0);
    });

    combo.appendChild(input);
    combo.appendChild(optionsList);

    addRow.appendChild(addLabel);
    addRow.appendChild(combo);
    wrapper.appendChild(addRow);

    const extraEntries = this.data.plannerCourses.filter((entry) => entry.kind === "extra");
    if (extraEntries.length === 0) {
      wrapper.appendChild(
        this.createPlaceholderContent(
          "Nothing loaded yet. Search above to load a whole study plan or a single course, then drag its courses into the semesters you want.",
        ),
      );
      return wrapper;
    }

    const entriesByPlan = new Map<string, PlannerCourse[]>();
    extraEntries.forEach((entry) => {
      const planKey = this.toPlanKey(entry.studyPlan);
      const bucket = entriesByPlan.get(planKey) ?? [];
      bucket.push(entry);
      entriesByPlan.set(planKey, bucket);
    });

    const groupedByStudyPlan = document.createElement("div");
    groupedByStudyPlan.className = "extra-curriculum-groups";

    const orderedPlanKeys = Array.from(entriesByPlan.keys()).sort((a, b) => {
      const planA = entriesByPlan.get(a)?.[0]?.studyPlan;
      const planB = entriesByPlan.get(b)?.[0]?.studyPlan;
      if (!planA || !planB) {
        return a.localeCompare(b);
      }

      const bySemester = TimetableWidget.semesterRank(planA.semester) - TimetableWidget.semesterRank(planB.semester);
      return bySemester !== 0 ? bySemester : planA.name.localeCompare(planB.name);
    });

    orderedPlanKeys.forEach((planKey) => {
      const entries = entriesByPlan.get(planKey) ?? [];
      const studyPlan = entries[0]?.studyPlan;
      if (!studyPlan) {
        return;
      }

      // Each loaded plan is a box: courses wait here until dragged into a semester, and can be dragged back.
      const section = document.createElement("section");
      section.className = "extra-curriculum-group plan-box";
      section.dataset.unplacePlan = planKey;
      this.makeUnplaceTarget(section, planKey);

      const title = document.createElement("div");
      title.className = "extra-curriculum-group-header";

      const titleText = document.createElement("div");
      titleText.className = "extra-curriculum-group-title";

      const dot = document.createElement("span");
      dot.className = "extra-curriculum-group-dot";
      dot.style.background = this.data.planColorByKey[planKey] ?? "var(--line-strong)";
      dot.setAttribute("aria-hidden", "true");

      const titleLabel = document.createElement("span");
      titleLabel.className = "extra-curriculum-group-title-text";
      titleLabel.textContent = `${studyPlan.semester} - ${studyPlan.name}`;

      const placedCount = entries.filter((entry) => entry.semester !== null).length;
      const count = document.createElement("span");
      count.className = "extra-curriculum-group-count";
      count.textContent = `${placedCount}/${entries.length} placed`;

      titleText.appendChild(dot);
      titleText.appendChild(titleLabel);
      titleText.appendChild(count);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "extra-curriculum-group-remove";
      removeButton.textContent = entries.length > 1 ? "Remove all" : "Remove";
      removeButton.addEventListener("click", () => this.data.onRemoveStudyPlan(planKey));

      const courses = document.createElement("div");
      courses.className = "extra-curriculum-courses";
      entries
        .sort((a, b) => baseCourseCode(a.course).localeCompare(baseCourseCode(b.course)) || a.course.abbreviation.localeCompare(b.course.abbreviation))
        .forEach((entry) => courses.appendChild(this.createPlanCourseCard(entry, { compact: true, inPlanBox: true })));

      const dropHint = document.createElement("div");
      dropHint.className = "plan-box-drop-hint";
      dropHint.textContent = "Drop here to take it out of its semester";

      title.appendChild(titleText);
      title.appendChild(removeButton);
      section.appendChild(title);
      section.appendChild(courses);
      section.appendChild(dropHint);
      groupedByStudyPlan.appendChild(section);
    });

    wrapper.appendChild(groupedByStudyPlan);
    return wrapper;
  }

  private createPlaceholderContent(text: string): HTMLElement {
    const placeholder = document.createElement("div");
    placeholder.className = "curriculum-placeholder";
    placeholder.textContent = text;
    return placeholder;
  }

  private createConflictSlotOverlay(block: ConflictSlotBlock, grid: TimetableGrid): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "conflict-slot-overlay";
    overlay.style.gridColumn = grid.getGridColumn(block.day);
    overlay.style.gridRow = `${grid.getGridRowStart(block.start)} / span ${Math.max(1, block.end - block.start)}`;

    return overlay;
  }

  private resolvePlanColor(studyPlans: StudyPlan[]): string | null {
    for (let index = 0; index < studyPlans.length; index += 1) {
      const key = this.toPlanKey(studyPlans[index]);
      const color = this.data.planColorByKey[key];
      if (color) {
        return color;
      }
    }

    return null;
  }

  private resolvePlanBorder(studyPlans: StudyPlan[]): string | null {
    const colors = Array.from(
        new Set(
            studyPlans
                .map((studyPlan) => this.data.planColorByKey[this.toPlanKey(studyPlan)])
                .filter((color): color is string => Boolean(color)),
        ),
    );

    if (colors.length === 0) {
      return null;
    }

    if (colors.length === 1) {
      return colors[0];
    }

    const segmentSize = 100 / colors.length;
    const stops = colors
        .map((color, index) => {
          const start = (index * segmentSize).toFixed(2);
          const end = ((index + 1) * segmentSize).toFixed(2);
          return `${color} ${start}%, ${color} ${end}%`;
        })
        .join(", ");

    return `linear-gradient(180deg, ${stops})`;
  }

  private toPlanKey(studyPlan: StudyPlan): string {
    return `${studyPlan.semester}:${studyPlan.name}`;
  }
}
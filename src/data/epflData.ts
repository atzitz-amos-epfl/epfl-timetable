import rawData from "../../py/epfl_data.json";
import { ALL_SEMESTERS, type Course, type DayIndex, type LectureType, type Semester, type StudyPlan } from "../types";

// Shape written by py/scraper.py (schemaVersion 2). Courses are stored once and referenced by key from plans.
interface RawLecture {
  type: string;
  day: number;
  start: number;
  end: number;
  rooms?: string[];
}

interface RawCourse {
  code: string;
  name: string;
  section: string;
  teachers: string[];
  language: string;
  credits: number | null;
  link: string;
  prerequisites: string;
  lectures: RawLecture[];
  // "current": scraped from this year's coursebook; "previous": carried over (not published yet); "none".
  timetable: string;
}

/** A plan line: either a course, or an SHS-style choice ("take one of these"). Name/credits override the course's. */
interface RawEntry {
  course?: string;
  choice?: string;
  group: string;
  optional: boolean;
  name?: string;
  credits?: number | null;
}

interface RawChoice {
  label: string;
  semester: string;
  credits: number | null;
  options: string[];
}

interface RawPlan {
  id: string;
  title: string;
  // false for course pools like the SHS programme: loadable, but not a degree to pick as main study.
  mainStudy?: boolean;
  semesters: Record<string, RawEntry[]>;
}

interface RawData {
  schemaVersion: number;
  scrapedAt: string;
  courses: Record<string, RawCourse>;
  choices: Record<string, RawChoice>;
  plans: Record<string, RawPlan>;
}

const data = rawData as unknown as RawData;

export const dataScrapedAt = data.scrapedAt;

/** Plans that can be loaded as "other plans" but are not degrees. */
export const nonMainStudyPlanIds: ReadonlySet<string> = new Set(
  Object.values(data.plans).filter((plan) => plan.mainStudy === false).map((plan) => plan.id),
);

const LECTURE_TYPES: readonly LectureType[] = ["course", "exercise", "lab"];

const toSemester = (value: string): Semester | null => {
  const upper = value.toUpperCase() as Semester;
  return ALL_SEMESTERS.includes(upper) ? upper : null;
};

const makeCourse = (raw: RawCourse, entry: RawEntry, choice?: { id: string; label: string }): Course => {
  const course: Course = {
    abbreviation: raw.code,
    name: entry.name ?? raw.name,
    teacher: raw.teachers.join(", "),
    // Some study plans list no credits; the app treats that as 0.
    credits: (entry.credits !== undefined ? entry.credits : raw.credits) as number,
    group: entry.group,
    isOptional: entry.optional,
    prerequisite: raw.prerequisites.split(/[,;]+/).map((item) => item.trim()).filter(Boolean),
    linkToCourse: raw.link,
    language: raw.language || undefined,
    timetableOutdated: raw.timetable === "previous",
    choice,
    lectures: [],
  };

  course.lectures = raw.lectures.map((lecture) => ({
    course,
    type: LECTURE_TYPES.includes(lecture.type as LectureType) ? (lecture.type as LectureType) : "course",
    day: Math.max(0, Math.min(4, Math.floor(lecture.day))) as DayIndex,
    timeStart: Math.max(0, Math.floor(lecture.start)),
    timeEnd: Math.max(0, Math.floor(lecture.end)),
    room: Array.from(new Set((lecture.rooms ?? []).map((room) => room.trim()).filter(Boolean))),
  }));

  return course;
};

/**
 * Builds one StudyPlan per (plan, semester), with fresh Course objects on every call so separate views
 * (planner, timetable catalog) don't share mutable state.
 * `expandChoices`: list every option of an SHS choice in the plan (the planner merges them into one
 * pick-one card); without it choices are skipped (their courses live in the SHS plan).
 */
export const buildStudyPlans = (options: { expandChoices: boolean }): StudyPlan[] => {
  const plans: StudyPlan[] = [];

  Object.values(data.plans).forEach((plan) => {
    Object.entries(plan.semesters).forEach(([semesterKey, entries]) => {
      const semester = toSemester(semesterKey);
      if (!semester) {
        return;
      }

      const courses: Course[] = [];
      entries.forEach((entry) => {
        if (entry.course) {
          const raw = data.courses[entry.course];
          if (raw) {
            courses.push(makeCourse(raw, entry));
          }
          return;
        }

        const choice = entry.choice ? data.choices[entry.choice] : undefined;
        if (!choice || !options.expandChoices || !entry.choice) {
          return;
        }
        const choiceRef = { id: entry.choice, label: choice.label };
        choice.options.forEach((key) => {
          const raw = data.courses[key];
          if (raw) {
            // Every option fills the same slot, so it is listed under the slot's group.
            courses.push(makeCourse(raw, { ...entry, credits: raw.credits ?? entry.credits }, choiceRef));
          }
        });
      });

      plans.push({ name: plan.id, semester, courses });
    });
  });

  return plans;
};

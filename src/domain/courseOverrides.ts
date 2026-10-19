import type { Course, Lecture } from "../types";

const STORAGE_KEY = "studies-planner-course-edits-v1";

/** One timetable slot as the user edits it (no back-reference to the course). */
export interface LectureSlot {
  type: Lecture["type"];
  day: Lecture["day"];
  timeStart: Lecture["timeStart"];
  timeEnd: Lecture["timeEnd"];
  room: string[];
}

/**
 * Everything the course editor can change. Code and name are left out on purpose: they identify the course
 * in every saved selection.
 */
export interface EditableCourseValues {
  teacher: string;
  credits: number;
  lectures: LectureSlot[];
  group: string;
  isOptional: boolean;
}

// The coursebook page is shared by every plan listing the course, so these fields are corrected once for all plans...
type CourseLevel = Pick<EditableCourseValues, "teacher" | "credits" | "lectures">;
// ...while the group and whether it is optional depend on the plan (CS-200 is mandatory in info, an option in syscom).
type PlanLevel = Pick<EditableCourseValues, "group" | "isOptional">;

type Stored<T> = T & { editedAt: string };

export interface CourseEditInfo {
  editedAt: string;
  // True when the timetable/teacher/credits correction also applies to this course in other plans.
  sharedWithOtherPlans: boolean;
}

const LECTURE_TYPES: ReadonlyArray<Lecture["type"]> = ["course", "exercise", "lab"];

/** Plans list the same course under the same code and name. */
export const courseIdentity = (course: Course): string => `${course.abbreviation}|${course.name}`;

const copySlots = (slots: LectureSlot[]): LectureSlot[] => slots.map((slot) => ({ ...slot, room: [...slot.room] }));

const readCourseLevel = (course: Course): CourseLevel => ({
  teacher: course.teacher,
  credits: course.credits,
  lectures: course.lectures.map((lecture) => ({
    type: lecture.type,
    day: lecture.day,
    timeStart: lecture.timeStart,
    timeEnd: lecture.timeEnd,
    room: [...(lecture.room ?? [])],
  })),
});

const readPlanLevel = (course: Course): PlanLevel => ({ group: course.group, isOptional: course.isOptional });

const writeCourseLevel = (course: Course, values: CourseLevel): void => {
  course.teacher = values.teacher;
  course.credits = values.credits;
  course.lectures = copySlots(values.lectures).map((slot) => ({ ...slot, course }));
};

const writePlanLevel = (course: Course, values: PlanLevel): void => {
  course.group = values.group;
  course.isOptional = values.isOptional;
};

const sameCourseLevel = (left: CourseLevel, right: CourseLevel): boolean =>
  left.teacher === right.teacher && left.credits === right.credits && JSON.stringify(left.lectures) === JSON.stringify(right.lectures);

const samePlanLevel = (left: PlanLevel, right: PlanLevel): boolean =>
  left.group === right.group && left.isOptional === right.isOptional;

const parseSlots = (value: unknown): LectureSlot[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const slots: LectureSlot[] = [];
  for (const entry of value) {
    const { type, day, timeStart, timeEnd, room } = (entry ?? {}) as Record<string, unknown>;
    if (!LECTURE_TYPES.includes(type as Lecture["type"]) || typeof day !== "number" || day < 0 || day > 4
      || typeof timeStart !== "number" || typeof timeEnd !== "number" || timeEnd <= timeStart) {
      return null;
    }
    slots.push({
      type: type as Lecture["type"],
      day: day as Lecture["day"],
      timeStart,
      timeEnd,
      room: Array.isArray(room) ? room.filter((item): item is string => typeof item === "string") : [],
    });
  }
  return slots;
};

const parseCourseLevel = (value: unknown): Stored<CourseLevel> | null => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const lectures = parseSlots(raw.lectures);
  if (typeof raw.teacher !== "string" || typeof raw.credits !== "number" || !lectures) {
    return null;
  }
  return { teacher: raw.teacher, credits: raw.credits, lectures, editedAt: `${raw.editedAt ?? ""}` };
};

const parsePlanLevel = (value: unknown): Stored<PlanLevel> | null => {
  const raw = (value ?? {}) as Record<string, unknown>;
  if (typeof raw.group !== "string" || typeof raw.isOptional !== "boolean") {
    return null;
  }
  return { group: raw.group, isOptional: raw.isOptional, editedAt: `${raw.editedAt ?? ""}` };
};

export interface CourseCopies {
  /** Both in-memory copies (planner data and timetable catalog) of the course with this selection id. */
  ofPlanCourse: (courseId: string) => Course[];
  /** Every copy of the course in every plan, for a course identity (see `courseIdentity`). */
  ofCourse: (identity: string) => Course[];
}

/**
 * Manual corrections layered over the bundled (scraped) data, saved in this browser.
 * Scraped values are snapshotted per course object, so a correction can always be reset.
 */
export class CourseEditStore {
  private readonly courseEdits = new Map<string, Stored<CourseLevel>>();
  private readonly planEdits = new Map<string, Stored<PlanLevel>>();
  private readonly scraped = new Map<Course, { course: CourseLevel; plan: PlanLevel }>();

  public constructor(
    private readonly copies: CourseCopies,
    private readonly onCourseChanged: (course: Course) => void = () => {},
  ) {
    this.load();
    this.courseEdits.forEach((edit, identity) => this.applyCourseLevel(identity, edit));
    this.planEdits.forEach((edit, courseId) => this.applyPlanLevel(courseId, edit));
  }

  /** Whether this course (as listed by this plan) has any correction, and when it was made. */
  public info(courseId: string): CourseEditInfo | undefined {
    const course = this.copies.ofPlanCourse(courseId)[0];
    const courseEdit = course ? this.courseEdits.get(courseIdentity(course)) : undefined;
    const planEdit = this.planEdits.get(courseId);
    if (!courseEdit && !planEdit) {
      return undefined;
    }

    const editedAt = [courseEdit?.editedAt ?? "", planEdit?.editedAt ?? ""].sort().pop() ?? "";
    const otherPlans = course ? this.copies.ofCourse(courseIdentity(course)).length > this.copies.ofPlanCourse(courseId).length : false;
    return { editedAt, sharedWithOtherPlans: courseEdit !== undefined && otherPlans };
  }

  public editedIds(allCourseIds: Iterable<string>): string[] {
    return Array.from(allCourseIds).filter((courseId) => this.info(courseId) !== undefined);
  }

  /** Saves what differs from the scraped data; saving the scraped values again removes the correction. */
  public save(courseId: string, values: EditableCourseValues): void {
    const course = this.copies.ofPlanCourse(courseId)[0];
    if (!course) {
      return;
    }

    const original = this.scrapedValues(course);
    const identity = courseIdentity(course);
    const editedAt = new Date().toISOString();
    const courseLevel: CourseLevel = { teacher: values.teacher, credits: values.credits, lectures: copySlots(values.lectures) };
    const planLevel: PlanLevel = { group: values.group, isOptional: values.isOptional };

    if (sameCourseLevel(courseLevel, original.course)) {
      this.resetCourseLevel(identity);
    } else {
      const edit = { ...courseLevel, editedAt };
      this.courseEdits.set(identity, edit);
      this.applyCourseLevel(identity, edit);
    }

    if (samePlanLevel(planLevel, original.plan)) {
      this.resetPlanLevel(courseId);
    } else {
      const edit = { ...planLevel, editedAt };
      this.planEdits.set(courseId, edit);
      this.applyPlanLevel(courseId, edit);
    }

    this.persist();
  }

  /** Drops both the shared (course-level) and this plan's corrections. */
  public reset(courseId: string): void {
    const course = this.copies.ofPlanCourse(courseId)[0];
    if (course) {
      this.resetCourseLevel(courseIdentity(course));
    }
    this.resetPlanLevel(courseId);
    this.persist();
  }

  private scrapedValues(course: Course): { course: CourseLevel; plan: PlanLevel } {
    return this.scraped.get(course) ?? { course: readCourseLevel(course), plan: readPlanLevel(course) };
  }

  private remember(course: Course): void {
    if (!this.scraped.has(course)) {
      this.scraped.set(course, { course: readCourseLevel(course), plan: readPlanLevel(course) });
    }
  }

  private applyCourseLevel(identity: string, edit: CourseLevel): void {
    this.copies.ofCourse(identity).forEach((course) => {
      this.remember(course);
      writeCourseLevel(course, edit);
      this.onCourseChanged(course);
    });
  }

  private applyPlanLevel(courseId: string, edit: PlanLevel): void {
    this.copies.ofPlanCourse(courseId).forEach((course) => {
      this.remember(course);
      writePlanLevel(course, edit);
    });
  }

  private resetCourseLevel(identity: string): void {
    if (!this.courseEdits.delete(identity)) {
      return;
    }
    this.copies.ofCourse(identity).forEach((course) => {
      const original = this.scraped.get(course);
      if (original) {
        writeCourseLevel(course, original.course);
        this.onCourseChanged(course);
      }
    });
  }

  private resetPlanLevel(courseId: string): void {
    if (!this.planEdits.delete(courseId)) {
      return;
    }
    this.copies.ofPlanCourse(courseId).forEach((course) => {
      const original = this.scraped.get(course);
      if (original) {
        writePlanLevel(course, original.plan);
      }
    });
  }

  private load(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object" || parsed.version !== 2) {
        return;
      }

      Object.entries((parsed.courses ?? {}) as Record<string, unknown>).forEach(([identity, value]) => {
        const edit = parseCourseLevel(value);
        if (edit) {
          this.courseEdits.set(identity, edit);
        }
      });
      Object.entries((parsed.plans ?? {}) as Record<string, unknown>).forEach(([courseId, value]) => {
        const edit = parsePlanLevel(value);
        if (edit) {
          this.planEdits.set(courseId, edit);
        }
      });
    } catch {
      // Unreadable storage: start without edits.
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        courses: Object.fromEntries(this.courseEdits),
        plans: Object.fromEntries(this.planEdits),
      }));
    } catch {
      // Ignore storage write errors (private mode, quota issues, etc.).
    }
  }
}

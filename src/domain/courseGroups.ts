import { ALL_SEMESTERS, type Course, type CourseKind, type Cycle, type LectureType, type Semester } from "../types";

const semesterNumber = (semester: Semester): number => Number.parseInt(semester.slice(2), 10);

/** A course can only be taken in semesters of the same season (autumn = odd, spring = even). */
export const getValidSemesters = (originSemester: Semester): Semester[] => {
  const parity = semesterNumber(originSemester) % 2;
  return ALL_SEMESTERS.filter((semester) => semesterNumber(semester) % 2 === parity);
};

export const cycleOf = (semester: Semester): Cycle => (semester.startsWith("MA") ? "master" : "bachelor");

export const CYCLE_SEMESTERS: Record<Cycle, Semester[]> = {
  bachelor: ALL_SEMESTERS.filter((semester) => cycleOf(semester) === "bachelor"),
  master: ALL_SEMESTERS.filter((semester) => cycleOf(semester) === "master"),
};

/**
 * Where a course may be placed. Main-study courses stay within their own cycle;
 * courses loaded from other plans can go anywhere in the right season (e.g. a master course in BA5).
 */
export const getPlacementSemesters = (originSemester: Semester, kind: CourseKind): Semester[] => {
  const sameSeason = getValidSemesters(originSemester);
  return kind === "extra" ? sameSeason : sameSeason.filter((semester) => cycleOf(semester) === cycleOf(originSemester));
};

/** Section variants share a code apart from the parenthesised part: MATH-101(e), MATH-101(en), MATH-101(pi)... */
export const baseCourseCode = (course: Course): string => course.abbreviation.replace(/\([^)]*\)/g, "").trim();

const LECTURE_TYPE_LABELS: Record<LectureType, string> = {
  course: "Lecture",
  exercise: "Exercise",
  lab: "Lab",
};

/** Weekly periods per lecture type, e.g. "Lecture 2h · Exercise 1h". */
export const describeLectureMix = (course: Course): string => {
  const periodsByType = new Map<LectureType, number>();
  course.lectures.forEach((lecture) => {
    const periods = Math.max(0, lecture.timeEnd - lecture.timeStart);
    periodsByType.set(lecture.type, (periodsByType.get(lecture.type) ?? 0) + periods);
  });

  const parts = (["course", "exercise", "lab"] as const)
    .filter((type) => (periodsByType.get(type) ?? 0) > 0)
    .map((type) => `${LECTURE_TYPE_LABELS[type]} ${periodsByType.get(type)}h`);

  return parts.length > 0 ? parts.join(" · ") : "No timetable";
};

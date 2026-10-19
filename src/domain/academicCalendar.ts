import { ALL_SEMESTERS, type Semester } from "../types";

export type Season = "autumn" | "spring";

/**
 * EPFL academic years start in September. The autumn semester (with its January exams) is taken to run
 * August to January, the spring semester February to July.
 */
export const academicYearOf = (date: Date): number => (date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1);

export const seasonOf = (date: Date): Season => {
  const month = date.getMonth();
  return month >= 7 || month === 0 ? "autumn" : "spring";
};

/** "Autumn 2026–27" */
export const seasonLabel = (season: Season, academicYear: number): string =>
  `${season === "autumn" ? "Autumn" : "Spring"} ${academicYear}–${String((academicYear + 1) % 100).padStart(2, "0")}`;

export type StudyPosition =
  | { status: "upcoming"; startsIn: number; season: Season; academicYear: number }
  | { status: "studying"; semester: Semester; season: Season; academicYear: number }
  | { status: "graduated"; season: Season; academicYear: number };

/**
 * Where a student who started BA1 in autumn `startYear` is today, assuming one semester after the other
 * (BA1 ... BA6, then MA1 ... MA4) without breaks.
 */
export const studyPosition = (startYear: number, date: Date = new Date()): StudyPosition => {
  const academicYear = academicYearOf(date);
  const season = seasonOf(date);
  const index = (academicYear - startYear) * 2 + (season === "spring" ? 1 : 0);

  if (index < 0) {
    return { status: "upcoming", startsIn: startYear - academicYear, season, academicYear };
  }
  if (index >= ALL_SEMESTERS.length) {
    return { status: "graduated", season, academicYear };
  }
  return { status: "studying", semester: ALL_SEMESTERS[index], season, academicYear };
};

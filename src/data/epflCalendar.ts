/**
 * EPFL academic calendar 2025-26 (spring) to 2027-28 (autumn), read from the official "Academic Calendar" PDF.
 * Days off inside a semester are bank holidays or break weeks; the exam session follows the last course day.
 * Key: academic year + season, like the agenda's semester keys ("2026-autumn" = autumn 2026-27).
 */
export interface SemesterCalendar {
  // First and last day with courses (YYYY-MM-DD).
  firstDay: string;
  lastDay: string;
  // Weekdays without courses during the semester.
  daysOff: Array<{ from: string; to: string; name: string }>;
  // Exam session, when published.
  exams: { from: string; to: string } | null;
}

export const EPFL_CALENDAR: Record<string, SemesterCalendar> = {
  "2025-spring": {
    firstDay: "2026-02-16",
    lastDay: "2026-05-29",
    daysOff: [
      { from: "2026-04-03", to: "2026-04-03", name: "Good Friday" },
      { from: "2026-04-06", to: "2026-04-10", name: "Easter break" },
      { from: "2026-05-14", to: "2026-05-14", name: "Ascension" },
      { from: "2026-05-25", to: "2026-05-25", name: "Whit Monday" },
    ],
    exams: { from: "2026-06-15", to: "2026-07-04" },
  },
  "2026-autumn": {
    firstDay: "2026-09-07",
    lastDay: "2026-12-18",
    daysOff: [
      { from: "2026-09-21", to: "2026-09-21", name: "Federal Fast Monday" },
      { from: "2026-10-19", to: "2026-10-23", name: "Break week" },
    ],
    exams: { from: "2027-01-11", to: "2027-01-30" },
  },
  "2026-spring": {
    firstDay: "2027-02-22",
    lastDay: "2027-06-04",
    daysOff: [
      { from: "2027-03-26", to: "2027-03-26", name: "Good Friday" },
      { from: "2027-03-29", to: "2027-04-02", name: "Easter break" },
      { from: "2027-05-06", to: "2027-05-06", name: "Ascension" },
      { from: "2027-05-17", to: "2027-05-17", name: "Whit Monday" },
    ],
    exams: { from: "2027-06-21", to: "2027-07-10" },
  },
  "2027-autumn": {
    firstDay: "2027-09-13",
    lastDay: "2027-12-24",
    daysOff: [
      { from: "2027-09-20", to: "2027-09-20", name: "Federal Fast Monday" },
      { from: "2027-10-18", to: "2027-10-22", name: "Break week" },
    ],
    exams: null,
  },
};

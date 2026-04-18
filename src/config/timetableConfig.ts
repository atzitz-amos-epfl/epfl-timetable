export interface TimetableClockConfig {
  startMinutes: number;
  endMinutes: number;
  lectureDurationMinutes: number;
  breakDurationMinutes: number;
}

export interface TimetableLayoutConfig {
  timeColumnWidthPx: number;
  dayColumnMinWidthPx: number;
  headerRowHeightPx: number;
  periodRowHeightPx: number;
}

export interface TimetableConfig {
  title: string;
  subtitleTemplate: (totalCourses: number) => string;
  days: readonly string[];
  clock: TimetableClockConfig;
  layout: TimetableLayoutConfig;
}

export const timetableConfig: TimetableConfig = {
  title: "University Timetable",
  subtitleTemplate: (totalCourses) =>
    `${totalCourses} courses loaded. Slots run from 08:15 to 19:00 in 45+15 minute cycles.`,
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  clock: {
    startMinutes: 8 * 60 + 15,
    endMinutes: 19 * 60,
    lectureDurationMinutes: 45,
    breakDurationMinutes: 15,
  },
  layout: {
    timeColumnWidthPx: 110,
    dayColumnMinWidthPx: 140,
    headerRowHeightPx: 46,
    periodRowHeightPx: 72,
  },
};


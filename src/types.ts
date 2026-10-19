export type LectureType = "exercise" | "course" | "lab";
export type DayIndex = 0 | 1 | 2 | 3 | 4;
export type Semester = "BA1" | "BA2" | "BA3" | "BA4" | "BA5" | "BA6" | "MA1" | "MA2" | "MA3" | "MA4";
export const ALL_SEMESTERS: readonly Semester[] = ["BA1", "BA2", "BA3", "BA4", "BA5", "BA6", "MA1", "MA2", "MA3", "MA4"];
// "planner" and "schedule" are the two views of the Planner tab; "timetable" is the Explore tab.
export type AppTab = "studies" | "planner" | "schedule" | "agenda" | "timetable";
// Bachelor (BA1-BA6) and master (MA1-MA4) are planned separately, each with its own main study.
export type Cycle = "bachelor" | "master";
// How a course relates to the main study: required by it, an option of it, or loaded from another plan.
export type CourseKind = "mandatory" | "optional" | "extra";

// SchoolHour is a timetable slot index, where 0 is 08:15-09:00.
export type SchoolHour = number;

export interface Course {
  abbreviation: string;
  name: string;
  teacher: string;
  credits: number;
  group: string;
  isOptional: boolean;
  prerequisite: string[];
  linkToCourse: string;
  lectures: Lecture[];
  // Teaching language from the study plan ("FR", "EN", "FR/EN"...).
  language?: string;
  // The coursebook has no timetable yet (spring courses during autumn): these lectures are from the previous scrape.
  timetableOutdated?: boolean;
  // Set on the options of a "take one of these" slot, like the SHS course of a semester.
  choice?: { id: string; label: string };
}

export interface Lecture {
  course: Course;
  type: LectureType;
  day: DayIndex;
  timeStart: SchoolHour;
  timeEnd: SchoolHour;
  room?: string[];
}

export interface StudyPlan {
  name: string;
  semester: Semester;
  courses: Course[];
}

export interface PlannedLecture {
  id: string;
  lecture: Lecture;
  studyPlans: StudyPlan[];
  isMandatory: boolean;
  kind?: CourseKind;
}

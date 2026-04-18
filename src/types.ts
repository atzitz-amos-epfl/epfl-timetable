export type LectureType = "exercise" | "course" | "lab";
export type DayIndex = 0 | 1 | 2 | 3 | 4;
export type Semester = "BA1" | "BA2" | "BA3" | "BA4" | "BA5" | "BA6";

// SchoolHour is a timetable slot index, where 0 is 08:15-09:00.
export type SchoolHour = number;

export interface Course {
  abbreviation: string;
  name: string;
  lectures: Lecture[];
}

export interface Lecture {
  course: Course;
  type: LectureType;
  day: DayIndex;
  timeStart: SchoolHour;
  timeEnd: SchoolHour;
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
}


import rawStudyPlans from "../py/epfl_courses.json";
import type { Course, DayIndex, LectureType, SchoolHour, Semester, StudyPlan } from "./types";

type RawLecture = {
  type: string;
  day: number;
  timeStart: number;
  timeEnd: number;
};

type RawCourse = {
  courseName: string;
  courseAbbreviation: string;
  teacher: string;
  credits: number;
  group: string;
  lectures: RawLecture[];
  linkToCourse: string;
};

type RawStudyPlan = {
  semester: string;
  name: string;
  courses: RawCourse[];
};

const SEMESTER_VALUES: readonly Semester[] = ["BA1", "BA2", "BA3", "BA4", "BA5", "BA6"];
const LECTURE_TYPE_VALUES: readonly LectureType[] = ["course", "exercise", "lab"];
const OPTIONAL_GROUP_LABEL = 'Groupe "Options"';

const normalizeSemester = (value: string): Semester => {
  const upper = value.toUpperCase();
  if (SEMESTER_VALUES.includes(upper as Semester)) {
    return upper as Semester;
  }

  return "BA1";
};

const normalizeLectureType = (value: string): LectureType => {
  if (LECTURE_TYPE_VALUES.includes(value as LectureType)) {
    return value as LectureType;
  }

  return "course";
};

const normalizeDay = (value: number): DayIndex => {
  const safe = Math.max(0, Math.min(4, Math.floor(value)));
  return safe as DayIndex;
};

const normalizeHour = (value: number): SchoolHour => {
  return Math.max(0, Math.floor(value));
};

const mapCourse = (rawCourse: RawCourse): Course => {
  const course: Course = {
    abbreviation: rawCourse.courseAbbreviation,
    name: rawCourse.courseName,
    teacher: rawCourse.teacher,
    credits: rawCourse.credits,
    group: rawCourse.group,
    isOptional: rawCourse.group === OPTIONAL_GROUP_LABEL,
    linkToCourse: rawCourse.linkToCourse,
    lectures: [],
  };

  course.lectures = rawCourse.lectures.map((lecture) => ({
    course,
    type: normalizeLectureType(lecture.type),
    day: normalizeDay(lecture.day),
    timeStart: normalizeHour(lecture.timeStart),
    timeEnd: normalizeHour(lecture.timeEnd),
  }));

  return course;
};

const mapStudyPlan = (rawStudyPlan: RawStudyPlan): StudyPlan => ({
  name: rawStudyPlan.name,
  semester: normalizeSemester(rawStudyPlan.semester),
  courses: rawStudyPlan.courses.map(mapCourse),
});

export const sampleStudyPlans: StudyPlan[] = (rawStudyPlans as RawStudyPlan[]).map(mapStudyPlan);


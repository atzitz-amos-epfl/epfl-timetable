import epflCoursesRaw from "../py/epfl_courses.json";
import type { Course, Lecture, Semester, StudyPlan } from "./types";

interface RawLecture {
  type: Lecture["type"];
  day: Lecture["day"];
  timeStart: Lecture["timeStart"];
  timeEnd: Lecture["timeEnd"];
  rooms?: string[];
}

interface RawCourse {
  courseName: string;
  courseAbbreviation: string;
  teacher: string;
  credits: number;
  group: string;
  prerequisites: string;
  lectures: RawLecture[];
  linkToCourse: string;
}

interface RawStudyPlan {
  semester: string;
  name: string;
  courses: RawCourse[];
}

const normalizeSemester = (value: string): Semester | null => {
  const normalized = value.toUpperCase();
  if (normalized === "BA1" || normalized === "BA2" || normalized === "BA3" || normalized === "BA4" || normalized === "BA5" || normalized === "BA6") {
    return normalized;
  }

  return null;
};

const normalizePrerequisites = (value: string): string[] => {
  return value
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeRoomList = (value?: string[]): string[] => {
  if (!value) {
    return [];
  }

  const cleaned = value.map((entry) => entry.trim()).filter(Boolean);
  return Array.from(new Set(cleaned));
};

const rawPlans = epflCoursesRaw as RawStudyPlan[];

export const epflStudyPlans: StudyPlan[] = rawPlans
  .map((plan) => {
    const semester = normalizeSemester(plan.semester);
    if (!semester) {
      return null;
    }

    const mappedCourses: Course[] = plan.courses.map((course) => {
      const mappedCourse: Course = {
        abbreviation: course.courseAbbreviation,
        name: course.courseName,
        teacher: course.teacher,
        credits: course.credits,
        group: course.group,
        isOptional: false,
        prerequisite: normalizePrerequisites(course.prerequisites),
        linkToCourse: course.linkToCourse,
        lectures: course.lectures.map((lecture) => ({
          course: {} as Course,
          type: lecture.type,
          day: lecture.day,
          timeStart: lecture.timeStart,
          timeEnd: lecture.timeEnd,
          room: normalizeRoomList(lecture.rooms),
        })),
      };

      mappedCourse.lectures.forEach((lecture) => {
        lecture.course = mappedCourse;
      });

      return mappedCourse;
    });

    return {
      name: plan.name,
      semester,
      courses: mappedCourses,
    } satisfies StudyPlan;
  })
  .filter((plan): plan is StudyPlan => plan !== null);

export const buildEpflPlanKey = (plan: StudyPlan): string => `${plan.semester}:${plan.name}`;
export const buildEpflCourseId = (plan: StudyPlan, course: Course): string => {
  return `${buildEpflPlanKey(plan)}|${course.abbreviation}|${course.name}`;
};

export const epflPlanByKey = new Map<string, StudyPlan>();
export const epflCourseById = new Map<string, Course>();
export const epflAddOptions: Array<{ key: string; label: string }> = [];
export const epflRoomLecturesByRoom = new Map<string, Array<{ lecture: Lecture; studyPlan: StudyPlan }>>();
export const epflRoomAddOptions: Array<{ key: string; label: string }> = [];
export const epflLabelByKey = new Map<string, string>();

const sortedPlans = [...epflStudyPlans].sort((a, b) => a.semester.localeCompare(b.semester) || a.name.localeCompare(b.name));

sortedPlans.forEach((plan) => {
  const planKey = buildEpflPlanKey(plan);
  epflPlanByKey.set(planKey, plan);

  const planOption = {
    key: `plan:${planKey}`,
    label: `Plan: ${plan.semester} - ${plan.name}`,
  };
  epflAddOptions.push(planOption);
  epflLabelByKey.set(planOption.key, planOption.label);

  const sortedCourses = [...plan.courses].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  sortedCourses.forEach((course) => {
    const courseId = buildEpflCourseId(plan, course);
    epflCourseById.set(courseId, course);

    course.lectures.forEach((lecture) => {
      const rooms = lecture.room ?? [];
      rooms.forEach((room) => {
        const bucket = epflRoomLecturesByRoom.get(room) ?? [];
        bucket.push({ lecture, studyPlan: plan });
        epflRoomLecturesByRoom.set(room, bucket);
      });
    });

    const courseOption = {
      key: `course:${courseId}`,
      label: `Course: ${course.abbreviation} - ${course.name} (${plan.semester} - ${plan.name})`,
    };
    epflAddOptions.push(courseOption);
    epflLabelByKey.set(courseOption.key, courseOption.label);
  });
});

const sortedRooms = Array.from(epflRoomLecturesByRoom.keys()).sort((a, b) => a.localeCompare(b));
sortedRooms.forEach((room) => {
  const roomOption = {
    key: `room:${room}`,
    label: `Room: ${room}`,
  };
  epflRoomAddOptions.push(roomOption);
  epflLabelByKey.set(roomOption.key, roomOption.label);
});

export const epflTimetableAddOptions = [...epflAddOptions, ...epflRoomAddOptions];


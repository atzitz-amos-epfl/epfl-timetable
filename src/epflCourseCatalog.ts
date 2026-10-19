import { buildStudyPlans } from "./data/epflData";
import type { Course, Lecture, StudyPlan } from "./types";

export const epflStudyPlans: StudyPlan[] = buildStudyPlans({ expandChoices: false });

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

/** Re-files a course's lectures under their rooms after its slots were edited (see CourseEditStore). */
export const reindexCourseRooms = (courseId: string, course: Course): void => {
  const studyPlan = epflPlanByKey.get(courseId.split("|")[0] ?? "");
  if (!studyPlan) {
    return;
  }

  epflRoomLecturesByRoom.forEach((entries, room) => {
    const kept = entries.filter((entry) => entry.lecture.course !== course);
    if (kept.length !== entries.length) {
      epflRoomLecturesByRoom.set(room, kept);
    }
  });

  course.lectures.forEach((lecture) => {
    (lecture.room ?? []).forEach((room) => {
      const bucket = epflRoomLecturesByRoom.get(room) ?? [];
      bucket.push({ lecture, studyPlan });
      epflRoomLecturesByRoom.set(room, bucket);
    });
  });
};

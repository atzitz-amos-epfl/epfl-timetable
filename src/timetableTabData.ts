import type { StudyPlan } from "./types";

export const timetableTabMainStudy = "Standalone Timetable";

export const timetableTabStudyPlans: StudyPlan[] = [
  {
    name: timetableTabMainStudy,
    semester: "BA3",
    courses: [
      {
        abbreviation: "TT101",
        name: "Standalone Planning",
        teacher: "TBD",
        credits: 3,
        group: "Timetable",
        isOptional: false,
        prerequisite: [],
        linkToCourse: "",
        lectures: [
          {
            course: {} as StudyPlan["courses"][number],
            type: "course",
            day: 1,
            timeStart: 2,
            timeEnd: 4,
          },
        ],
      },
      {
        abbreviation: "TT202",
        name: "Separate UI Labs",
        teacher: "TBD",
        credits: 2,
        group: "Timetable",
        isOptional: false,
        prerequisite: [],
        linkToCourse: "",
        lectures: [
          {
            course: {} as StudyPlan["courses"][number],
            type: "lab",
            day: 3,
            timeStart: 6,
            timeEnd: 8,
          },
        ],
      },
    ],
  },
];

// Fill course back-references so lecture.course points to the owning course.
for (const plan of timetableTabStudyPlans) {
  for (const course of plan.courses) {
    course.lectures.forEach((lecture) => {
      lecture.course = course;
    });
  }
}


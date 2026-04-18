import type { Course, DayIndex, LectureType, SchoolHour, Semester, StudyPlan } from "./types";

type LectureInput = {
  type: LectureType;
  day: DayIndex;
  timeStart: SchoolHour;
  timeEnd: SchoolHour;
};

class CourseFactory {
  public static createCourse(
    abbreviation: string,
    name: string,
    teacher: string,
    credits: number,
    group: string,
    linkToCourse: string,
    lectureInputs: LectureInput[],
  ): Course {
    const course: Course = {
      abbreviation,
      name,
      teacher,
      credits,
      group,
      linkToCourse,
      lectures: [],
    };

    course.lectures = lectureInputs.map((lectureInput) => ({
      ...lectureInput,
      course,
    }));

    return course;
  }
}

class StudyPlanFactory {
  public static create(name: string, semester: Semester, courses: Course[]): StudyPlan {
    return {
      name,
      semester,
      courses,
    };
  }
}

class SampleStudyPlansFactory {
  public static create(): StudyPlan[] {
    const calculus = CourseFactory.createCourse("MATH101", "Calculus I", "Dr. Newton", 6, "Core", "https://example.edu/courses/math101", [
      { type: "course", day: 0, timeStart: 0, timeEnd: 2 },
      { type: "exercise", day: 2, timeStart: 3, timeEnd: 5 },
    ]);

    const introProgramming = CourseFactory.createCourse(
      "CS102",
      "Programming Fundamentals",
      "Prof. Ada",
      7,
      "Core",
      "https://example.edu/courses/cs102",
      [
      { type: "course", day: 1, timeStart: 1, timeEnd: 3 },
      { type: "lab", day: 3, timeStart: 6, timeEnd: 9 },
      ],
    );

    const physics = CourseFactory.createCourse("PHY110", "Physics", "Dr. Faraday", 6, "Core", "https://example.edu/courses/phy110", [
      { type: "course", day: 0, timeStart: 5, timeEnd: 7 },
      { type: "exercise", day: 4, timeStart: 2, timeEnd: 4 },
    ]);

    const history = CourseFactory.createCourse("HIS120", "Modern History", "Prof. Herodotus", 4, "Humanities", "https://example.edu/courses/his120", [
      { type: "course", day: 2, timeStart: 7, timeEnd: 9 },
    ]);

    const dataStructures = CourseFactory.createCourse(
      "CS201",
      "Data Structures",
      "Dr. Knuth",
      6,
      "Core",
      "https://example.edu/courses/cs201",
      [
      { type: "course", day: 0, timeStart: 1, timeEnd: 3 },
      { type: "exercise", day: 3, timeStart: 6, timeEnd: 8 },
      ],
    );

    const linearAlgebra = CourseFactory.createCourse(
      "MATH210",
      "Linear Algebra",
      "Prof. Euler",
      5,
      "Core",
      "https://example.edu/courses/math210",
      [
      { type: "course", day: 2, timeStart: 0, timeEnd: 1 },
      { type: "exercise", day: 4, timeStart: 2, timeEnd: 4 },
      ],
    );

    return [
      StudyPlanFactory.create("Computer Science - Year 1", "BA1", [calculus, introProgramming, physics]),
      StudyPlanFactory.create("History + Math Minor - Year 1", "BA1", [calculus, history]),
      StudyPlanFactory.create("Computer Science - Year 2", "BA2", [dataStructures, linearAlgebra]),
    ];
  }
}

export const sampleStudyPlans = SampleStudyPlansFactory.create();


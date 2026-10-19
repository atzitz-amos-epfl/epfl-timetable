import { timetableConfig, type TimetableConfig } from "./config/timetableConfig";
import { COMPACT_SCREEN_QUERY, TimetableWidget, type OptionalCourseGroup, type PlannerCourse, type TimetableWidgetData } from "./components/timetableWidget";
import { academicYearOf, studyPosition } from "./domain/academicCalendar";
import { EPFL_CALENDAR } from "./data/epflCalendar";
import type { CloudSync } from "./sync/cloudSync";
import { AgendaStore, currentSemesterKey, parseSemesterKey, semesterLayout, shiftSemesterKey, type AgendaChange, type AgendaItem } from "./domain/agenda";
import { CYCLE_SEMESTERS, baseCourseCode, cycleOf, getPlacementSemesters } from "./domain/courseGroups";
import { nonMainStudyPlanIds } from "./data/epflData";
import { CourseEditStore, courseIdentity, type EditableCourseValues } from "./domain/courseOverrides";
import { TimetableModel } from "./domain/timetableModel";
import {
  epflCourseById,
  epflLabelByKey,
  epflPlanByKey,
  epflRoomLecturesByRoom,
  epflTimetableAddOptions,
  reindexCourseRooms,
} from "./epflCourseCatalog";
import {
  ALL_SEMESTERS,
  type AppTab,
  type Course,
  type CourseKind,
  type Cycle,
  type PlannedLecture,
  type Semester,
  type StudyPlan,
} from "./types";

const STORAGE_KEY = "studies-planner-state-v1";

type StoredState = {
  version: 2 | 3;
  // Version 2 had a single main study for both cycles.
  activeMainStudy?: string;
  mainStudyByCycle?: Partial<Record<Cycle, string>>;
  activeSemester?: Semester;
  activeTab?: AppTab;
  // Autumn of the year the user started BA1, for "My studies".
  startYear?: number;
  addedCourseIds?: string[];
  // Called semesterOverrides in version 2.
  semesterOverrides?: Record<string, Semester>;
  placements?: Record<string, Semester>;
  disabledCourseIds?: string[];
  variantChoices?: Record<string, string>;
  openedOptionalGroups?: string[];
  collapsedOptionalSemesters?: string[];
  timetableTabSelectedPlanKeys?: string[];
  timetableTabSelectedCourseIds?: string[];
  timetableTabSelectedRoomKeys?: string[];
};

// Shape written by the previous version, where optional/extra selections were tracked separately.
type LegacyStoredState = {
  version: 1;
  activeMainStudy?: string;
  activeSemester?: Semester;
  activeTab?: AppTab;
  selectedOptionalCourseIds?: string[];
  selectedExtraCourseIds?: string[];
  openedOptionalGroups?: string[];
  timetableTabSelectedPlanKeys?: string[];
  timetableTabSelectedCourseIds?: string[];
  timetableTabSelectedRoomKeys?: string[];
};

const filterStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const migrateLegacyState = (legacy: LegacyStoredState): StoredState => ({
  version: 2,
  activeMainStudy: legacy.activeMainStudy,
  activeSemester: legacy.activeSemester,
  activeTab: legacy.activeTab,
  addedCourseIds: [
    ...filterStringArray(legacy.selectedOptionalCourseIds),
    ...filterStringArray(legacy.selectedExtraCourseIds),
  ],
  openedOptionalGroups: legacy.openedOptionalGroups,
  timetableTabSelectedPlanKeys: legacy.timetableTabSelectedPlanKeys,
  timetableTabSelectedCourseIds: legacy.timetableTabSelectedCourseIds,
  timetableTabSelectedRoomKeys: legacy.timetableTabSelectedRoomKeys,
});

const loadStoredState = (): StoredState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (parsed.version === 1) {
      return migrateLegacyState(parsed as LegacyStoredState);
    }
    if (parsed.version !== 2 && parsed.version !== 3) {
      return null;
    }
    return parsed as StoredState;
  } catch {
    return null;
  }
};

const saveStoredState = (state: StoredState): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write errors (private mode, quota issues, etc.).
  }
};

const PLAN_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#0f766e",
  "#ea580c",
  "#4f46e5",
];

const TAB_SEMESTERS: Semester[] = [...ALL_SEMESTERS];

const buildPlanKey = (studyPlan: StudyPlan): string => `${studyPlan.semester}:${studyPlan.name}`;
const buildCourseSelectionId = (studyPlan: StudyPlan, course: Course): string => {
  return `${buildPlanKey(studyPlan)}|${course.abbreviation}|${course.name}`;
};
const planKeyFromCourseId = (courseId: string): string => courseId.split("|")[0] ?? "";
const buildLectureKey = (lecture: PlannedLecture["lecture"]): string => {
  return [
    lecture.course.abbreviation,
    lecture.course.name,
    lecture.type,
    lecture.day,
    lecture.timeStart,
    lecture.timeEnd,
  ].join("|");
};

const buildPlannedLecturesFromCourses = (plannerCourses: PlannerCourse[]): PlannedLecture[] => {
  const mergedLectures = new Map<string, PlannedLecture>();

  plannerCourses.forEach((entry) => {
    entry.course.lectures.forEach((lecture) => {
      const lectureKey = buildLectureKey(lecture);
      const existing = mergedLectures.get(lectureKey);

      if (!existing) {
        mergedLectures.set(lectureKey, {
          id: lectureKey,
          lecture,
          studyPlans: [entry.studyPlan],
          isMandatory: entry.kind === "mandatory",
          kind: entry.kind,
        });
        return;
      }

      existing.studyPlans.push(entry.studyPlan);
      existing.isMandatory = existing.isMandatory || entry.kind === "mandatory";
    });
  });

  return Array.from(mergedLectures.values());
};

const buildPlannedLecturesFromPlans = (studyPlans: StudyPlan[]): PlannedLecture[] => {
  const mergedLectures = new Map<string, PlannedLecture>();

  studyPlans.forEach((studyPlan) => {
    studyPlan.courses.forEach((course) => {
      course.lectures.forEach((lecture) => {
        const lectureKey = buildLectureKey(lecture);
        const existing = mergedLectures.get(lectureKey);

        if (!existing) {
          mergedLectures.set(lectureKey, {
            id: lectureKey,
            lecture,
            studyPlans: [studyPlan],
            isMandatory: false,
          });
          return;
        }

        existing.studyPlans.push(studyPlan);
      });
    });
  });

  return Array.from(mergedLectures.values());
};

const buildPlannedLecturesFromRooms = (
  roomKeys: Set<string>,
  existingLectures: PlannedLecture[],
): PlannedLecture[] => {
  const mergedLectures = new Map(existingLectures.map((lecture) => [lecture.id, lecture]));

  roomKeys.forEach((room) => {
    const entries = epflRoomLecturesByRoom.get(room) ?? [];
    entries.forEach(({ lecture, studyPlan }) => {
      const lectureKey = buildLectureKey(lecture);
      const existing = mergedLectures.get(lectureKey);
      if (!existing) {
        mergedLectures.set(lectureKey, {
          id: lectureKey,
          lecture,
          studyPlans: [studyPlan],
          isMandatory: false,
        });
        return;
      }

      if (!existing.studyPlans.some((plan) => buildPlanKey(plan) === buildPlanKey(studyPlan))) {
        existing.studyPlans.push(studyPlan);
      }
    });
  });

  return Array.from(mergedLectures.values());
};

const buildPlanColorByKeyFromPlans = (studyPlans: StudyPlan[]): Record<string, string> => {
  return Object.fromEntries(
    studyPlans.map((studyPlan, index) => [buildPlanKey(studyPlan), PLAN_COLORS[index % PLAN_COLORS.length]]),
  );
};

const buildTimetableTabStudyPlans = (
  selectedPlanKeys: Set<string>,
  selectedCourseIds: Set<string>,
): StudyPlan[] => {
  const plans: StudyPlan[] = [];
  const partialCoursesByPlan = new Map<string, StudyPlan["courses"]>();

  selectedPlanKeys.forEach((planKey) => {
    const plan = epflPlanByKey.get(planKey);
    if (plan) {
      plans.push(plan);
    }
  });

  selectedCourseIds.forEach((courseId) => {
    const planKey = planKeyFromCourseId(courseId);
    if (selectedPlanKeys.has(planKey)) {
      return;
    }

    const course = epflCourseById.get(courseId);
    if (!course) {
      return;
    }

    const bucket = partialCoursesByPlan.get(planKey) ?? [];
    bucket.push(course);
    partialCoursesByPlan.set(planKey, bucket);
  });

  partialCoursesByPlan.forEach((courses, planKey) => {
    const plan = epflPlanByKey.get(planKey);
    if (!plan) {
      return;
    }

    plans.push({
      name: plan.name,
      semester: plan.semester,
      courses,
    });
  });

  return plans;
};

interface IndexedCourse {
  course: Course;
  studyPlan: StudyPlan;
}

const CYCLES: readonly Cycle[] = ["bachelor", "master"];

export class Timetable {
  private readonly model: TimetableModel;
  private readonly studyPlans: StudyPlan[];
  private readonly courseIndex: Map<string, IndexedCourse>;
  // Manual corrections of outdated scraped data, applied on top of it.
  private readonly courseEdits: CourseEditStore;
  // Series, labs, exams and notes per semester.
  private readonly agenda = new AgendaStore();
  // Semester shown in the Agenda tab (not saved: it reopens on the current semester).
  private agendaSemester = currentSemesterKey();
  // Planner state is stored as deltas on top of the main studies, so mandatory courses follow the main study.
  // Optional and extra courses the user loaded, in the order they were added.
  private readonly addedCourseIds: Set<string>;
  // Semester chosen for a course. Main-study courses default to the semester their plan lists;
  // courses loaded from other plans stay unplaced (in their plan's box) until given one.
  private readonly placements: Map<string, Semester>;
  private readonly disabledCourseIds: Set<string>;
  // Chosen section for merged variants (e.g. MATH-101(en) instead of MATH-101(e)), by variant group key.
  private readonly variantChoices: Map<string, string>;
  // Semesters the user folded in the optional-courses pane (all start open).
  private readonly collapsedOptionalSemesters: Set<string>;
  private readonly curriculumPaneScrollTop: Record<string, number>;
  private readonly timetableTabSelectedPlanKeys: Set<string>;
  private readonly timetableTabSelectedCourseIds: Set<string>;
  private readonly timetableTabSelectedRoomKeys: Set<string>;
  private readonly mainStudyByCycle: Record<Cycle, string>;
  // Last semester shown per cycle, so switching Bachelor/Master comes back where you were.
  private readonly lastSemesterByCycle: Record<Cycle, Semester>;
  private activeSemester: Semester;
  private activeTab: AppTab;
  private startYear: number;
  private container: HTMLElement | null = null;
  // Account sync (Supabase), when set up: told about every save.
  private cloudSync: CloudSync | null = null;

  public constructor(
    studyPlans: StudyPlan[],
    private readonly config: TimetableConfig = timetableConfig,
  ) {
    this.model = new TimetableModel(this.config);
    this.studyPlans = studyPlans;
    this.courseIndex = new Map();
    this.studyPlans.forEach((studyPlan) => {
      studyPlan.courses.forEach((course) => {
        this.courseIndex.set(buildCourseSelectionId(studyPlan, course), { course, studyPlan });
      });
    });
    // The planner data and the timetable catalog hold separate copies of each course, and a course listed by
    // several plans has a copy per plan: corrections are kept in sync across all of them.
    const copiesByIdentity = new Map<string, Course[]>();
    const catalogIdByCourse = new Map<Course, string>();
    const addCopy = (course: Course): void => {
      const identity = courseIdentity(course);
      copiesByIdentity.set(identity, [...(copiesByIdentity.get(identity) ?? []), course]);
    };
    this.courseIndex.forEach(({ course }) => addCopy(course));
    epflCourseById.forEach((course, courseId) => {
      addCopy(course);
      catalogIdByCourse.set(course, courseId);
    });
    this.courseEdits = new CourseEditStore(
      {
        ofPlanCourse: (courseId) => [this.courseIndex.get(courseId)?.course, epflCourseById.get(courseId)]
          .filter((course): course is Course => course !== undefined),
        ofCourse: (identity) => copiesByIdentity.get(identity) ?? [],
      },
      (course) => {
        // Keep the timetable tab's room search in line with edited slots.
        const catalogId = catalogIdByCourse.get(course);
        if (catalogId) {
          reindexCourseRooms(catalogId, course);
        }
      },
    );
    this.addedCourseIds = new Set();
    this.placements = new Map();
    this.disabledCourseIds = new Set();
    this.variantChoices = new Map();
    this.collapsedOptionalSemesters = new Set();
    this.curriculumPaneScrollTop = {
      optional: 0,
      extra: 0,
      schedule: 0,
    };
    this.timetableTabSelectedPlanKeys = new Set();
    this.timetableTabSelectedCourseIds = new Set();
    this.timetableTabSelectedRoomKeys = new Set();

    const bachelorDefault = this.getMainStudyOptions("bachelor")[0] ?? "";
    const masterOptions = this.getMainStudyOptions("master");
    this.mainStudyByCycle = {
      bachelor: bachelorDefault,
      master: masterOptions.includes(bachelorDefault) ? bachelorDefault : masterOptions[0] ?? "",
    };
    this.lastSemesterByCycle = { bachelor: CYCLE_SEMESTERS.bachelor[0], master: CYCLE_SEMESTERS.master[0] };
    this.activeSemester = TAB_SEMESTERS[0];
    this.activeTab = "studies";
    this.startYear = academicYearOf(new Date());

    const storedState = loadStoredState();
    if (storedState) {
      this.applyStoredState(storedState);
    } else {
      // First visit: open the planner on the semester the user is in.
      const position = studyPosition(this.startYear);
      if (position.status === "studying") {
        this.activeSemester = position.semester;
      }
    }
  }

  public setCloudSync(sync: CloudSync): void {
    this.cloudSync = sync;
  }

  public attach(container: HTMLElement): void {
    this.container = container;
    window.matchMedia(COMPACT_SCREEN_QUERY).addEventListener("change", () => this.renderIntoContainer());
    this.renderIntoContainer();
  }

  /** The cycle being planned always follows the semester being shown. */
  private get activeCycle(): Cycle {
    return cycleOf(this.activeSemester);
  }

  public render(): HTMLElement {
    const plannerCourses = this.getPlannerCourses();
    const optionalSemesterGroups = this.getOptionalSemesterGroups();

    const position = studyPosition(this.startYear);
    const shownSemester = this.activeTab === "studies"
      ? (position.status === "studying" ? position.semester : null)
      : this.activeSemester;
    const activeSemesterCourses = plannerCourses.filter((entry) => entry.enabled && entry.semester === shownSemester);
    const plannerPlannedLectures = buildPlannedLecturesFromCourses(activeSemesterCourses);
    const timetableTabStudyPlans = buildTimetableTabStudyPlans(this.timetableTabSelectedPlanKeys, this.timetableTabSelectedCourseIds);
    const timetableTabLectures = buildPlannedLecturesFromRooms(
      this.timetableTabSelectedRoomKeys,
      buildPlannedLecturesFromPlans(timetableTabStudyPlans),
    );
    // The plan board and the weekly schedule both show the user's plan; the timetable tab is a free catalog.
    const isPlanner = this.activeTab !== "timetable";
    const plannedLectures = isPlanner ? plannerPlannedLectures : timetableTabLectures;
    const conflictSlotBlocks = this.model.buildConflictSlotBlocks(plannedLectures);
    const planColorByKey = isPlanner
      ? this.getPlanColorByKey(plannerCourses)
      : buildPlanColorByKeyFromPlans(timetableTabStudyPlans);

    const timetableTabSelectedItems = [
      ...Array.from(this.timetableTabSelectedPlanKeys).map((planKey) => `plan:${planKey}`),
      ...Array.from(this.timetableTabSelectedCourseIds).map((courseId) => `course:${courseId}`),
      ...Array.from(this.timetableTabSelectedRoomKeys).map((room) => `room:${room}`),
    ]
      .map((key) => ({ key, label: epflLabelByKey.get(key) ?? key }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const data: TimetableWidgetData = {
      activeCycle: this.activeCycle,
      mainStudies: {
        bachelor: { options: this.getMainStudyOptions("bachelor"), value: this.mainStudyByCycle.bachelor },
        master: { options: this.getMainStudyOptions("master"), value: this.mainStudyByCycle.master },
      },
      startYear: this.startYear,
      startYearRange: [academicYearOf(new Date()) - 7, academicYearOf(new Date()) + 1],
      studyPosition: position,
      semesters: TAB_SEMESTERS,
      activeSemester: this.activeSemester,
      activeTab: this.activeTab,
      plannerCourses,
      summaryCourses: isPlanner ? activeSemesterCourses.map((entry) => entry.course) : undefined,
      extraCurriculumAddOptions: this.getExtraCurriculumAddOptions(),
      timetableTabAddOptions: epflTimetableAddOptions,
      timetableTabSelectedItems,
      optionalSemesterGroups,
      collapsedOptionalSemesters: Array.from(this.collapsedOptionalSemesters),
      curriculumPaneScrollTop: this.curriculumPaneScrollTop,
      plannedLectures,
      conflictSlotBlocks,
      planColorByKey,
      onChangeMainStudy: (cycle: Cycle, mainStudyName: string) => this.changeMainStudy(cycle, mainStudyName),
      onChangeStartYear: (year: number) => {
        this.startYear = year;
        this.renderIntoContainer();
      },
      onChangeCycle: (cycle: Cycle) => this.changeCycle(cycle),
      onChangeSemester: (semester: Semester) => this.changeSemester(semester),
      onChangeTab: (tab: AppTab) => this.changeTab(tab),
      onAddExtraCurriculumItem: (itemKey: string) => this.addExtraCurriculumItem(itemKey),
      onAddTimetableTabItem: (itemKey: string) => this.addTimetableTabItem(itemKey),
      onRemoveTimetableTabItem: (itemKey: string) => this.removeTimetableTabItem(itemKey),
      onToggleOptionalCourse: (courseId: string) => this.toggleOptionalCourse(courseId),
      onToggleCourseEnabled: (courseId: string) => this.toggleCourseEnabled(courseId),
      onMoveCourse: (courseId: string, semester: Semester) => this.moveCourse(courseId, semester),
      onUnplaceCourse: (courseId: string) => this.unplaceCourse(courseId),
      onRemoveCourse: (courseId: string) => this.removeCourse(courseId),
      onChooseVariant: (groupKey: string, courseId: string) => this.chooseVariant(groupKey, courseId),
      courseEdits: Object.fromEntries(
        this.courseEdits.editedIds(new Set([...this.courseIndex.keys(), ...epflCourseById.keys()]))
          .map((id) => [id, this.courseEdits.info(id)!]),
      ),
      onSaveCourseEdit: (courseId: string, values: EditableCourseValues) => {
        this.courseEdits.save(courseId, values);
        this.renderIntoContainer();
      },
      onResetCourseEdit: (courseId: string) => {
        this.courseEdits.reset(courseId);
        this.renderIntoContainer();
      },
      onRemoveStudyPlan: (planKey: string) => this.removeStudyPlan(planKey),
      onOpenSemesterSchedule: (semester: Semester) => this.openSemesterSchedule(semester),
      cloudSync: this.cloudSync,
      agenda: this.buildAgendaData(this.agendaSemester),
      currentAgenda: this.buildAgendaData(currentSemesterKey()),
      onAgendaAdd: (items: Array<Omit<AgendaItem, "id">>) => {
        this.agenda.add(items);
        this.renderIntoContainer();
      },
      onAgendaUpdate: (id: string, patch: Partial<Omit<AgendaItem, "id">>) => {
        this.agenda.update(id, patch);
        this.renderIntoContainer();
      },
      onAgendaRemove: (id: string) => {
        this.agenda.remove(id);
        this.renderIntoContainer();
      },
      onAgendaChange: (change: AgendaChange) => {
        this.agenda.apply(change);
        this.renderIntoContainer();
      },
      onAgendaSetStart: (iso: string | null) => {
        this.agenda.setSemesterStart(this.agendaSemester, iso);
        this.renderIntoContainer();
      },
      onAgendaShiftSemester: (offset: number) => {
        this.agendaSemester = shiftSemesterKey(this.agendaSemester, offset);
        this.renderIntoContainer();
      },
      onShowInPlan: (semester: Semester) => {
        this.activeTab = "planner";
        this.changeSemester(semester);
      },
      onToggleOptionalSemesterOpen: (semester: Semester, open: boolean) => this.toggleOptionalSemesterOpen(semester, open),
      onCurriculumPaneScroll: (paneKey: string, scrollTop: number) => this.updateCurriculumPaneScroll(paneKey, scrollTop),
    };

    return new TimetableWidget(data, this.model, this.config).render();
  }

  /**
   * Everything the Agenda needs for one semester. Its courses come from the plan semester the user is in
   * during that season (from the start year), so the course picker lists what they actually take.
   */
  private buildAgendaData(semesterKey: string): TimetableWidgetData["agenda"] {
    const { academicYear, season } = parseSemesterKey(semesterKey);
    const index = (academicYear - this.startYear) * 2 + (season === "spring" ? 1 : 0);
    const planSemester = index >= 0 && index < ALL_SEMESTERS.length ? ALL_SEMESTERS[index] : null;
    const courses = planSemester
      ? this.getPlannerCourses()
        .filter((entry) => entry.enabled && entry.semester === planSemester)
        .map((entry) => ({ code: entry.course.abbreviation, name: entry.course.name }))
      : [];

    return {
      semester: semesterKey,
      academicYear,
      season,
      planSemester,
      start: this.agenda.semesterStart(semesterKey),
      isDefaultStart: this.agenda.isDefaultStart(semesterKey),
      // Weeks from the EPFL academic calendar when it covers this semester, else 14 weeks from the start date.
      layout: semesterLayout(EPFL_CALENDAR[semesterKey], this.agenda.semesterStart(semesterKey), !this.agenda.isDefaultStart(semesterKey)),
      items: this.agenda.itemsOf(semesterKey),
      courses,
    };
  }

  /** Mandatory/optional when the course comes from the main study of its plan's cycle, extra otherwise. */
  private kindOf(indexed: IndexedCourse): CourseKind {
    const cycle = cycleOf(indexed.studyPlan.semester);
    if (indexed.studyPlan.name !== this.mainStudyByCycle[cycle]) {
      return "extra";
    }

    return indexed.course.isOptional ? "optional" : "mandatory";
  }

  /**
   * Every course in the plan. Mandatory courses of both main studies come first,
   * then optional/extra courses in the order they were added. Extras without a placement have `semester: null`.
   * Section variants of one course in the same plan (MATH-101(e), MATH-101(en)...) become a single entry.
   */
  private getPlannerCourses(): PlannerCourse[] {
    const candidates: Array<{ courseId: string; indexed: IndexedCourse; kind: CourseKind }> = [];
    const seenCourses = new Set<string>();

    const pushCandidate = (courseId: string, indexed: IndexedCourse, kind: CourseKind): void => {
      // The same course can be listed by several plans; keep only its first occurrence.
      // An SHS course can be offered in several semesters: it is a separate option in each semester's choice.
      const choicePrefix = indexed.course.choice ? `${indexed.course.choice.id}|` : "";
      const courseKey = `${choicePrefix}${indexed.course.abbreviation}|${indexed.course.name}`;
      if (seenCourses.has(courseKey)) {
        return;
      }
      seenCourses.add(courseKey);
      candidates.push({ courseId, indexed, kind });
    };

    CYCLES.forEach((cycle) => {
      this.getMainStudyPlans(cycle).forEach((studyPlan) => {
        studyPlan.courses.forEach((course) => {
          if (!course.isOptional) {
            pushCandidate(buildCourseSelectionId(studyPlan, course), { course, studyPlan }, "mandatory");
          }
        });
      });
    });

    this.addedCourseIds.forEach((courseId) => {
      const indexed = this.courseIndex.get(courseId);
      if (!indexed) {
        return;
      }

      const kind = this.kindOf(indexed);
      if (kind !== "mandatory") {
        pushCandidate(courseId, indexed, kind);
      }
    });

    const groups = new Map<string, typeof candidates>();
    candidates.forEach((candidate) => {
      const groupKey = this.variantGroupKey(candidate.indexed, candidate.kind) ?? `id:${candidate.courseId}`;
      const members = groups.get(groupKey) ?? [];
      members.push(candidate);
      groups.set(groupKey, members);
    });

    const entries: PlannerCourse[] = [];
    groups.forEach((members, groupKey) => {
      const chosen = this.pickVariant(groupKey, members);
      const { course, studyPlan } = chosen.indexed;
      const validSemesters = getPlacementSemesters(studyPlan.semester, chosen.kind);
      const placement = this.placements.get(chosen.courseId);
      let semester: Semester | null = chosen.kind === "extra" ? null : studyPlan.semester;
      if (placement && validSemesters.includes(placement)) {
        semester = placement;
      }

      entries.push({
        id: chosen.courseId,
        course,
        studyPlan,
        kind: chosen.kind,
        originSemester: studyPlan.semester,
        semester,
        validSemesters,
        enabled: !this.disabledCourseIds.has(chosen.courseId),
        ...(members.length > 1
          ? {
              variantGroupKey: groupKey,
              variants: members.map((member) => ({ id: member.courseId, course: member.indexed.course })),
            }
          : {}),
      });
    });

    return entries;
  }

  /**
   * Variants are grouped per plan and kind: the options of one choice (the SHS course of a semester),
   * otherwise sections sharing a course code without its parenthesised suffix.
   */
  private variantGroupKey(indexed: IndexedCourse, kind: CourseKind): string | null {
    if (indexed.course.choice) {
      return `${buildPlanKey(indexed.studyPlan)}|${kind}|choice:${indexed.course.choice.id}`;
    }
    const code = baseCourseCode(indexed.course);
    return code ? `${buildPlanKey(indexed.studyPlan)}|${kind}|${code}` : null;
  }

  /** The user's pick, otherwise the plainest section: "Analyse I" over "Analyse I (anglais)". */
  private pickVariant<T extends { courseId: string; indexed: IndexedCourse }>(groupKey: string, members: T[]): T {
    const chosenId = this.variantChoices.get(groupKey);
    const chosen = members.find((member) => member.courseId === chosenId);
    if (chosen) {
      return chosen;
    }

    return [...members].sort(
      (a, b) =>
        a.indexed.course.name.length - b.indexed.course.name.length ||
        a.indexed.course.abbreviation.localeCompare(b.indexed.course.abbreviation),
    )[0];
  }

  /** Switches section; the placement and on/off state move over to the new variant. */
  private chooseVariant(groupKey: string, courseId: string): void {
    const entry = this.getPlannerCourses().find((candidate) => candidate.variantGroupKey === groupKey);
    if (!entry || entry.id === courseId || !entry.variants?.some((variant) => variant.id === courseId)) {
      return;
    }

    // The new section takes over the current state exactly. It may still carry flags saved before the sections were
    // merged (e.g. the user had unticked it as an unwanted duplicate), which must not resurface.
    const placement = this.placements.get(entry.id);
    this.placements.delete(entry.id);
    if (placement) {
      this.placements.set(courseId, placement);
    } else {
      this.placements.delete(courseId);
    }
    const wasDisabled = this.disabledCourseIds.delete(entry.id);
    if (wasDisabled) {
      this.disabledCourseIds.add(courseId);
    } else {
      this.disabledCourseIds.delete(courseId);
    }
    this.variantChoices.set(groupKey, courseId);

    this.renderIntoContainer();
  }

  /** Ids of every section of this course in the same plan (including itself). */
  private variantSiblingIds(courseId: string): string[] {
    const indexed = this.courseIndex.get(courseId);
    const choiceId = indexed?.course.choice?.id;
    const code = indexed ? baseCourseCode(indexed.course) : "";
    if (!indexed || (!code && !choiceId)) {
      return [courseId];
    }

    return indexed.studyPlan.courses
      .filter((course) => (choiceId ? course.choice?.id === choiceId : !course.choice && baseCourseCode(course) === code))
      .map((course) => buildCourseSelectionId(indexed.studyPlan, course));
  }

  /** Loaded courses land unplaced in their plan's box; the user drags them into a semester. */
  private addExtraCurriculumItem(itemKey: string): void {
    if (itemKey.startsWith("plan:")) {
      const plan = this.studyPlans.find((studyPlan) => buildPlanKey(studyPlan) === itemKey.slice("plan:".length));
      if (!plan) {
        return;
      }

      plan.courses.forEach((course) => this.addCourse(buildCourseSelectionId(plan, course)));
      this.renderIntoContainer();
      return;
    }

    if (itemKey.startsWith("course:")) {
      this.addCourse(itemKey.slice("course:".length));
      this.renderIntoContainer();
    }
  }

  private addCourse(courseId: string): void {
    if (!this.courseIndex.has(courseId)) {
      return;
    }

    this.addedCourseIds.add(courseId);
    this.disabledCourseIds.delete(courseId);
  }

  private addTimetableTabItem(itemKey: string): void {
    if (itemKey.startsWith("plan:")) {
      const planKey = itemKey.slice("plan:".length);
      this.timetableTabSelectedPlanKeys.add(planKey);

      this.timetableTabSelectedCourseIds.forEach((courseId) => {
        if (courseId.startsWith(`${planKey}|`)) {
          this.timetableTabSelectedCourseIds.delete(courseId);
        }
      });

      this.renderIntoContainer();
      return;
    }

    if (itemKey.startsWith("course:")) {
      const courseId = itemKey.slice("course:".length);
      const planKey = planKeyFromCourseId(courseId);
      if (!this.timetableTabSelectedPlanKeys.has(planKey)) {
        this.timetableTabSelectedCourseIds.add(courseId);
      }

      this.renderIntoContainer();
      return;
    }

    if (itemKey.startsWith("room:")) {
      const roomKey = itemKey.slice("room:".length);
      if (roomKey) {
        this.timetableTabSelectedRoomKeys.add(roomKey);
      }

      this.renderIntoContainer();
    }
  }

  private removeTimetableTabItem(itemKey: string): void {
    if (itemKey.startsWith("plan:")) {
      const planKey = itemKey.slice("plan:".length);
      this.timetableTabSelectedPlanKeys.delete(planKey);
      this.timetableTabSelectedCourseIds.forEach((courseId) => {
        if (courseId.startsWith(`${planKey}|`)) {
          this.timetableTabSelectedCourseIds.delete(courseId);
        }
      });

      this.renderIntoContainer();
      return;
    }

    if (itemKey.startsWith("course:")) {
      const courseId = itemKey.slice("course:".length);
      this.timetableTabSelectedCourseIds.delete(courseId);
      this.renderIntoContainer();
      return;
    }

    if (itemKey.startsWith("room:")) {
      const roomKey = itemKey.slice("room:".length);
      this.timetableTabSelectedRoomKeys.delete(roomKey);
      this.renderIntoContainer();
    }
  }

  private toggleOptionalCourse(courseId: string): void {
    if (this.addedCourseIds.has(courseId)) {
      this.forgetCourse(courseId);
    } else {
      this.addCourse(courseId);
    }

    this.renderIntoContainer();
  }

  private toggleCourseEnabled(courseId: string): void {
    if (this.disabledCourseIds.has(courseId)) {
      this.disabledCourseIds.delete(courseId);
    } else {
      this.disabledCourseIds.add(courseId);
    }

    this.renderIntoContainer();
  }

  /** Places a course in a semester, adding it to the plan first if it came straight from the catalog. */
  private moveCourse(courseId: string, semester: Semester): void {
    const indexed = this.courseIndex.get(courseId);
    if (!indexed) {
      return;
    }

    const kind = this.kindOf(indexed);
    if (!getPlacementSemesters(indexed.studyPlan.semester, kind).includes(semester)) {
      return;
    }

    if (kind !== "mandatory") {
      this.addCourse(courseId);
    }

    if (kind !== "extra" && semester === indexed.studyPlan.semester) {
      this.placements.delete(courseId);
    } else {
      this.placements.set(courseId, semester);
    }

    this.renderIntoContainer();
  }

  /** Extras go back to their plan's box; main-study courses go back to the semester their plan lists. */
  private unplaceCourse(courseId: string): void {
    this.placements.delete(courseId);
    this.renderIntoContainer();
  }

  private removeCourse(courseId: string): void {
    // A merged card stands for all its sections, so remove them together.
    this.variantSiblingIds(courseId).forEach((id) => this.forgetCourse(id));
    this.renderIntoContainer();
  }

  private removeStudyPlan(planKey: string): void {
    Array.from(this.addedCourseIds).forEach((courseId) => {
      if (planKeyFromCourseId(courseId) === planKey) {
        this.forgetCourse(courseId);
      }
    });

    this.renderIntoContainer();
  }

  private forgetCourse(courseId: string): void {
    this.addedCourseIds.delete(courseId);
    this.placements.delete(courseId);
    this.disabledCourseIds.delete(courseId);
  }

  private openSemesterSchedule(semester: Semester): void {
    this.activeTab = "schedule";
    this.changeSemester(semester);
  }

  private toggleOptionalSemesterOpen(semester: Semester, open: boolean): void {
    if (open) {
      this.collapsedOptionalSemesters.delete(semester);
    } else {
      this.collapsedOptionalSemesters.add(semester);
    }
    this.saveState();
  }

  private updateCurriculumPaneScroll(paneKey: string, scrollTop: number): void {
    this.curriculumPaneScrollTop[paneKey] = scrollTop;
  }

  /** Switching the main study of one cycle resets that study's choices; the other cycle and loaded plans are kept. */
  private changeMainStudy(cycle: Cycle, mainStudyName: string): void {
    const previous = this.mainStudyByCycle[cycle];
    if (!this.getMainStudyOptions(cycle).includes(mainStudyName) || mainStudyName === previous) {
      return;
    }

    const belongsToPrevious = (courseId: string): boolean => {
      const plan = this.courseIndex.get(courseId)?.studyPlan;
      return plan !== undefined && plan.name === previous && cycleOf(plan.semester) === cycle;
    };
    [this.addedCourseIds, this.disabledCourseIds].forEach((ids) => {
      Array.from(ids).forEach((courseId) => {
        if (belongsToPrevious(courseId)) {
          ids.delete(courseId);
        }
      });
    });
    Array.from(this.placements.keys()).forEach((courseId) => {
      if (belongsToPrevious(courseId)) {
        this.placements.delete(courseId);
      }
    });

    this.mainStudyByCycle[cycle] = mainStudyName;

    this.renderIntoContainer();
  }

  private changeCycle(cycle: Cycle): void {
    if (cycle === this.activeCycle) {
      return;
    }

    this.changeSemester(this.lastSemesterByCycle[cycle]);
  }

  private changeSemester(semester: Semester): void {
    this.activeSemester = semester;
    this.lastSemesterByCycle[cycleOf(semester)] = semester;

    this.renderIntoContainer();
  }

  private changeTab(tab: AppTab): void {
    this.activeTab = tab;

    this.renderIntoContainer();
  }

  private renderIntoContainer(): void {
    if (!this.container) {
      return;
    }

    this.captureCurriculumPaneScrollFromDom(this.container);
    const nextRoot = this.render();
    this.container.replaceChildren(nextRoot);
    this.restoreCurriculumPaneScrollToDom(nextRoot);
    TimetableWidget.restoreScrollAnchor(nextRoot);
    this.saveState();
    this.cloudSync?.notifyLocalChange();
  }

  private captureCurriculumPaneScrollFromDom(root: ParentNode): void {
    root.querySelectorAll<HTMLElement>(".curriculum-panel-body[data-curriculum-pane-key]").forEach((pane) => {
      const paneKey = pane.dataset.curriculumPaneKey;
      if (!paneKey) {
        return;
      }

      this.curriculumPaneScrollTop[paneKey] = pane.scrollTop;
    });
  }

  // Runs right after the new tree is attached (not in a later frame) so the scroll anchor can be applied on top of it.
  private restoreCurriculumPaneScrollToDom(root: ParentNode): void {
    root.querySelectorAll<HTMLElement>(".curriculum-panel-body[data-curriculum-pane-key]").forEach((pane) => {
      const paneKey = pane.dataset.curriculumPaneKey;
      if (!paneKey) {
        return;
      }

      pane.scrollTop = this.curriculumPaneScrollTop[paneKey] ?? 0;
    });
  }

  /** Extra courses are coloured by the plan they were loaded from; main-study courses keep the neutral edge. */
  private getPlanColorByKey(plannerCourses: PlannerCourse[]): TimetableWidgetData["planColorByKey"] {
    const colors: Record<string, string> = {};
    let colorIndex = 0;

    plannerCourses.forEach((entry) => {
      if (entry.kind !== "extra") {
        return;
      }

      const planKey = buildPlanKey(entry.studyPlan);
      if (!colors[planKey]) {
        colors[planKey] = PLAN_COLORS[colorIndex % PLAN_COLORS.length];
        colorIndex += 1;
      }
    });

    return colors;
  }

  private getExtraCurriculumAddOptions(): TimetableWidgetData["extraCurriculumAddOptions"] {
    const otherPlans = this.studyPlans
      .filter((studyPlan) => studyPlan.name !== this.mainStudyByCycle[cycleOf(studyPlan.semester)])
      .sort((a, b) => a.semester.localeCompare(b.semester) || a.name.localeCompare(b.name));

    const options: TimetableWidgetData["extraCurriculumAddOptions"] = [];

    otherPlans.forEach((studyPlan) => {
      const planKey = buildPlanKey(studyPlan);
      options.push({
        key: `plan:${planKey}`,
        label: `Plan: ${studyPlan.semester} - ${studyPlan.name}`,
      });

      const sortedCourses = [...studyPlan.courses].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
      sortedCourses.forEach((course) => {
        options.push({
          key: `course:${buildCourseSelectionId(studyPlan, course)}`,
          label: `Course: ${course.abbreviation} - ${course.name} (${studyPlan.semester} - ${studyPlan.name})`,
        });
      });
    });

    return options;
  }

  private getMainStudyPlans(cycle: Cycle): StudyPlan[] {
    return this.studyPlans
      .filter((studyPlan) => studyPlan.name === this.mainStudyByCycle[cycle] && cycleOf(studyPlan.semester) === cycle)
      .sort((a, b) => ALL_SEMESTERS.indexOf(a.semester) - ALL_SEMESTERS.indexOf(b.semester));
  }

  private getMainStudyOptions(cycle: Cycle): string[] {
    const names = this.studyPlans
      .filter((studyPlan) => cycleOf(studyPlan.semester) === cycle && !nonMainStudyPlanIds.has(studyPlan.name))
      .map((studyPlan) => studyPlan.name);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }

  /** Optional courses of the active cycle's main study, by the semester their plan lists, then by group. */
  private getOptionalSemesterGroups(): TimetableWidgetData["optionalSemesterGroups"] {
    return this.getMainStudyPlans(this.activeCycle)
      .map((studyPlan) => {
        const groups = new Map<string, OptionalCourseGroup>();
        studyPlan.courses.forEach((course) => {
          if (!course.isOptional) {
            return;
          }

          const bucket = groups.get(course.group) ?? { groupName: course.group, courses: [] };
          const id = buildCourseSelectionId(studyPlan, course);
          if (!bucket.courses.some((entry) => entry.id === id)) {
            bucket.courses.push({ id, course, studyPlans: [studyPlan] });
          }
          groups.set(course.group, bucket);
        });

        return {
          semester: studyPlan.semester,
          groups: Array.from(groups.values())
            .map((group) => ({
              groupName: group.groupName,
              courses: group.courses.sort((a, b) => a.course.abbreviation.localeCompare(b.course.abbreviation)),
            }))
            .sort((a, b) => a.groupName.localeCompare(b.groupName)),
        };
      })
      .filter((entry) => entry.groups.length > 0);
  }

  private applyStoredState(state: StoredState): void {
    CYCLES.forEach((cycle) => {
      const stored = state.mainStudyByCycle?.[cycle] ?? state.activeMainStudy;
      if (typeof stored === "string" && this.getMainStudyOptions(cycle).includes(stored)) {
        this.mainStudyByCycle[cycle] = stored;
      }
    });
    if (state.activeSemester && TAB_SEMESTERS.includes(state.activeSemester)) {
      this.activeSemester = state.activeSemester;
      this.lastSemesterByCycle[cycleOf(state.activeSemester)] = state.activeSemester;
    }
    if (["studies", "planner", "schedule", "agenda", "timetable"].includes(state.activeTab ?? "")) {
      this.activeTab = state.activeTab as AppTab;
    }
    if (typeof state.startYear === "number" && Number.isInteger(state.startYear)) {
      this.startYear = state.startYear;
    }

    this.addedCourseIds.clear();
    filterStringArray(state.addedCourseIds).forEach((id) => {
      if (this.courseIndex.has(id)) {
        this.addedCourseIds.add(id);
      }
    });

    this.placements.clear();
    const storedPlacements = state.placements ?? state.semesterOverrides;
    if (storedPlacements && typeof storedPlacements === "object") {
      Object.entries(storedPlacements).forEach(([id, semester]) => {
        if (this.courseIndex.has(id) && ALL_SEMESTERS.includes(semester)) {
          this.placements.set(id, semester);
        }
      });
    }
    // Before version 3, loaded courses were placed in their plan's semester automatically; keep them there.
    if (state.version < 3) {
      this.addedCourseIds.forEach((id) => {
        const indexed = this.courseIndex.get(id);
        if (indexed && !this.placements.has(id)) {
          this.placements.set(id, indexed.studyPlan.semester);
        }
      });
    }

    this.disabledCourseIds.clear();
    filterStringArray(state.disabledCourseIds).forEach((id) => {
      if (this.courseIndex.has(id)) {
        this.disabledCourseIds.add(id);
      }
    });

    this.variantChoices.clear();
    if (state.variantChoices && typeof state.variantChoices === "object") {
      Object.entries(state.variantChoices).forEach(([groupKey, id]) => {
        if (typeof id === "string" && this.courseIndex.has(id)) {
          this.variantChoices.set(groupKey, id);
        }
      });
    }

    this.collapsedOptionalSemesters.clear();
    filterStringArray(state.collapsedOptionalSemesters).forEach((key) => this.collapsedOptionalSemesters.add(key));

    this.timetableTabSelectedPlanKeys.clear();
    filterStringArray(state.timetableTabSelectedPlanKeys).forEach((key) => {
      if (epflPlanByKey.has(key)) {
        this.timetableTabSelectedPlanKeys.add(key);
      }
    });

    this.timetableTabSelectedCourseIds.clear();
    filterStringArray(state.timetableTabSelectedCourseIds).forEach((id) => {
      if (epflCourseById.has(id)) {
        this.timetableTabSelectedCourseIds.add(id);
      }
    });

    this.timetableTabSelectedRoomKeys.clear();
    filterStringArray(state.timetableTabSelectedRoomKeys).forEach((key) => {
      if (epflRoomLecturesByRoom.has(key)) {
        this.timetableTabSelectedRoomKeys.add(key);
      }
    });
  }

  private saveState(): void {
    const payload: StoredState = {
      version: 3,
      mainStudyByCycle: { ...this.mainStudyByCycle },
      activeSemester: this.activeSemester,
      activeTab: this.activeTab,
      startYear: this.startYear,
    };

    if (this.addedCourseIds.size > 0) {
      payload.addedCourseIds = Array.from(this.addedCourseIds);
    }
    if (this.placements.size > 0) {
      payload.placements = Object.fromEntries(this.placements);
    }
    if (this.disabledCourseIds.size > 0) {
      payload.disabledCourseIds = Array.from(this.disabledCourseIds);
    }
    if (this.variantChoices.size > 0) {
      payload.variantChoices = Object.fromEntries(this.variantChoices);
    }
    if (this.collapsedOptionalSemesters.size > 0) {
      payload.collapsedOptionalSemesters = Array.from(this.collapsedOptionalSemesters);
    }
    if (this.timetableTabSelectedPlanKeys.size > 0) {
      payload.timetableTabSelectedPlanKeys = Array.from(this.timetableTabSelectedPlanKeys);
    }
    if (this.timetableTabSelectedCourseIds.size > 0) {
      payload.timetableTabSelectedCourseIds = Array.from(this.timetableTabSelectedCourseIds);
    }
    if (this.timetableTabSelectedRoomKeys.size > 0) {
      payload.timetableTabSelectedRoomKeys = Array.from(this.timetableTabSelectedRoomKeys);
    }

    saveStoredState(payload);
  }
}

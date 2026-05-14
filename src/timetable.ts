import { timetableConfig, type TimetableConfig } from "./config/timetableConfig";
import { TimetableWidget, type TimetableWidgetData } from "./components/timetableWidget";
import { TimetableModel } from "./domain/timetableModel";
import {
  epflAddOptions,
  epflCourseById,
  epflLabelByKey,
  epflPlanByKey,
  epflRoomLecturesByRoom,
  epflTimetableAddOptions,
} from "./epflCourseCatalog";
import type { AppTab, PlannedLecture, Semester, StudyPlan } from "./types";

const STORAGE_KEY = "studies-planner-state-v1";

type StoredState = {
  version: 1;
  activeMainStudy?: string;
  activeSemester?: Semester;
  activeTab?: AppTab;
  selectedPlans?: Array<{ key: string; enabled: boolean }>;
  selectedOptionalCourseIds?: string[];
  selectedExtraCourseIds?: string[];
  openedMandatoryGroups?: string[];
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
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
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

interface SelectedStudyPlan {
  studyPlan: StudyPlan;
  enabled: boolean;
}

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

const TAB_SEMESTERS: Semester[] = ["BA3", "BA4", "BA5", "BA6"];

const semesterNumber = (semester: Semester): number => Number.parseInt(semester.replace("BA", ""), 10);
const isSemesterCompatible = (candidate: Semester, active: Semester): boolean => {
  return semesterNumber(candidate) % 2 === semesterNumber(active) % 2;
};

const buildPlanKey = (studyPlan: StudyPlan): string => `${studyPlan.semester}:${studyPlan.name}`;
const buildCourseSelectionId = (studyPlan: StudyPlan, course: StudyPlan["courses"][number]): string => {
  return `${buildPlanKey(studyPlan)}|${course.abbreviation}|${course.name}`;
};
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

const buildPlannedLectures = (
  studyPlans: StudyPlan[],
  mainStudyName: string,
  selectedOptionalIds: Set<string>,
  selectedExtraIds: Set<string>,
): PlannedLecture[] => {
  const mergedLectures = new Map<string, PlannedLecture>();

  studyPlans.forEach((studyPlan) => {
    const isMainPlan = studyPlan.name === mainStudyName;
    studyPlan.courses.forEach((course) => {
      const courseSelectionId = buildCourseSelectionId(studyPlan, course);
      if (isMainPlan) {
        if (course.isOptional && !selectedOptionalIds.has(courseSelectionId)) {
          return;
        }
      } else if (!selectedExtraIds.has(courseSelectionId)) {
        return;
      }

      course.lectures.forEach((lecture) => {
        const lectureKey = buildLectureKey(lecture);
        const existing = mergedLectures.get(lectureKey);

        if (!existing) {
          mergedLectures.set(lectureKey, {
            id: lectureKey,
            lecture,
            studyPlans: [studyPlan],
            isMandatory: isMainPlan && !course.isOptional,
          });
          return;
        }

        existing.studyPlans.push(studyPlan);
        existing.isMandatory = existing.isMandatory || (isMainPlan && !course.isOptional);
      });
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
    const planKey = courseId.split("|")[0] ?? "";
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

export class Timetable {
  private readonly model: TimetableModel;
  private readonly studyPlans: StudyPlan[];
  private readonly selectedPlans: Map<string, SelectedStudyPlan>;
  private readonly selectedOptionalCourseIds: Set<string>;
  private readonly selectedExtraCourseIds: Set<string>;
  private readonly openedMandatoryGroups: Set<string>;
  private readonly openedOptionalGroups: Set<string>;
  private hasStoredMandatoryGroupState = false;
  private hasStoredOptionalGroupState = false;
  private readonly curriculumPaneScrollTop: Record<string, number>;
  private readonly timetableTabSelectedPlanKeys: Set<string>;
  private readonly timetableTabSelectedCourseIds: Set<string>;
  private readonly timetableTabSelectedRoomKeys: Set<string>;
  private activeMainStudy: string;
  private activeSemester: Semester;
  private activeTab: AppTab;
  private container: HTMLElement | null = null;

  public constructor(
    studyPlans: StudyPlan[],
    private readonly config: TimetableConfig = timetableConfig,
  ) {
    this.model = new TimetableModel(this.config);
    this.studyPlans = studyPlans;
    this.selectedPlans = new Map();
    this.selectedOptionalCourseIds = new Set();
    this.selectedExtraCourseIds = new Set();
    this.openedMandatoryGroups = new Set();
    this.openedOptionalGroups = new Set();
    this.curriculumPaneScrollTop = {
      mandatory: 0,
      optional: 0,
      extra: 0,
    };
    this.timetableTabSelectedPlanKeys = new Set();
    this.timetableTabSelectedCourseIds = new Set();
    this.timetableTabSelectedRoomKeys = new Set();
    this.activeMainStudy = this.getMainStudyOptions()[0] ?? "";
    this.activeSemester = TAB_SEMESTERS[0];
    this.activeTab = "planner";

    const storedState = loadStoredState();
    if (storedState) {
      this.applyStoredState(storedState);
    }
  }

  public attach(container: HTMLElement): void {
    this.container = container;
    this.renderIntoContainer();
  }

  public render(): HTMLElement {
    const selectedStudyPlans = this.getSelectedStudyPlans();
    const mainStudyPlan = this.getMainStudyPlan(this.activeSemester);
    const visibleStudyPlans = [
      ...(mainStudyPlan ? [mainStudyPlan] : []),
      ...selectedStudyPlans
        .filter((selectedPlan) => selectedPlan.enabled)
        .filter((selectedPlan) => isSemesterCompatible(selectedPlan.studyPlan.semester, this.activeSemester))
        .map((selectedPlan) => selectedPlan.studyPlan),
    ];
    const mandatoryCourseGroups = this.getMandatoryCourseGroups();
    this.syncMandatoryGroupOpenState(mandatoryCourseGroups);
    const optionalCourseGroups = this.getOptionalCourseGroups();
    this.syncOptionalGroupOpenState(optionalCourseGroups);
    const plannerPlannedLectures = this.getPlannedLectures(visibleStudyPlans, this.selectedOptionalCourseIds, this.selectedExtraCourseIds);
    const timetableTabStudyPlans = buildTimetableTabStudyPlans(this.timetableTabSelectedPlanKeys, this.timetableTabSelectedCourseIds);
    const timetableTabLectures = buildPlannedLecturesFromRooms(
      this.timetableTabSelectedRoomKeys,
      buildPlannedLecturesFromPlans(timetableTabStudyPlans),
    );
    const plannedLectures = this.activeTab === "planner" ? plannerPlannedLectures : timetableTabLectures;
    const conflictSlotBlocks = this.model.buildConflictSlotBlocks(plannedLectures);
    const planColorByKey = this.activeTab === "planner"
      ? this.getPlanColorByKey(selectedStudyPlans)
      : buildPlanColorByKeyFromPlans(timetableTabStudyPlans);

    const timetableTabSelectedItems = [
      ...Array.from(this.timetableTabSelectedPlanKeys).map((planKey) => `plan:${planKey}`),
      ...Array.from(this.timetableTabSelectedCourseIds).map((courseId) => `course:${courseId}`),
      ...Array.from(this.timetableTabSelectedRoomKeys).map((room) => `room:${room}`),
    ]
      .map((key) => ({ key, label: epflLabelByKey.get(key) ?? key }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const data: TimetableWidgetData = {
      mainStudyOptions: this.getMainStudyOptions(),
      activeMainStudy: this.activeMainStudy,
      semesters: TAB_SEMESTERS,
      activeSemester: this.activeSemester,
      activeTab: this.activeTab,
      selectedStudyPlans,
      availableStudyPlans: this.getAvailableStudyPlans(this.activeSemester),
      extraCurriculumAddOptions: this.getExtraCurriculumAddOptions(this.activeSemester),
      timetableTabAddOptions: epflTimetableAddOptions,
      timetableTabSelectedItems,
      mandatoryCourseGroups,
      openedMandatoryGroupKeys: Array.from(this.openedMandatoryGroups),
      optionalCourseGroups,
      selectedOptionalCourseIds: Array.from(this.selectedOptionalCourseIds),
      selectedExtraCourseIds: Array.from(this.selectedExtraCourseIds),
      optionalOpenGroupNames: Array.from(this.openedOptionalGroups),
      curriculumPaneScrollTop: this.curriculumPaneScrollTop,
      plannedLectures,
      conflictSlotBlocks,
      planColorByKey,
      onChangeMainStudy: (mainStudyName: string) => this.changeMainStudy(mainStudyName),
      onChangeSemester: (semester: Semester) => this.changeSemester(semester),
      onChangeTab: (tab: AppTab) => this.changeTab(tab),
      onAddStudyPlan: (planKey: string) => this.addStudyPlan(planKey),
      onAddExtraCurriculumItem: (itemKey: string) => this.addExtraCurriculumItem(itemKey),
      onAddTimetableTabItem: (itemKey: string) => this.addTimetableTabItem(itemKey),
      onRemoveTimetableTabItem: (itemKey: string) => this.removeTimetableTabItem(itemKey),
      onToggleStudyPlanEnabled: (planKey: string) => this.toggleStudyPlanEnabled(planKey),
      onRemoveStudyPlan: (planKey: string) => this.removeStudyPlan(planKey),
      onToggleOptionalCourse: (courseId: string) => this.toggleOptionalCourse(courseId),
      onToggleExtraCourse: (courseId: string) => this.toggleExtraCourse(courseId),
      onToggleMandatoryGroupOpen: (groupKey: string, open: boolean) => this.toggleMandatoryGroupOpen(groupKey, open),
      onToggleOptionalGroupOpen: (groupName: string, open: boolean) => this.toggleOptionalGroupOpen(groupName, open),
      onCurriculumPaneScroll: (paneKey: string, scrollTop: number) => this.updateCurriculumPaneScroll(paneKey, scrollTop),
    };

    return new TimetableWidget(data, this.model, this.config).render();
  }

  private addStudyPlan(planKey: string): void {
    const added = this.ensureStudyPlanSelected(planKey, { requireCompatibleSemester: true });
    if (!added) {
      return;
    }

    this.renderIntoContainer();
  }

  private addExtraCurriculumItem(itemKey: string): void {
    if (itemKey.startsWith("plan:")) {
      const planKey = itemKey.slice("plan:".length);
      const planAdded = this.ensureStudyPlanSelected(planKey, { requireCompatibleSemester: false });
      if (!planAdded) {
        return;
      }

      const selectedPlan = this.selectedPlans.get(planKey);
      if (!selectedPlan) {
        return;
      }

      selectedPlan.studyPlan.courses.forEach((course) => {
        this.selectedExtraCourseIds.add(this.toCourseSelectionId(selectedPlan.studyPlan, course));
      });
      this.renderIntoContainer();
      return;
    }

    if (itemKey.startsWith("course:")) {
      const courseId = itemKey.slice("course:".length);
      const planKey = courseId.split("|")[0] ?? "";
      const planAdded = this.ensureStudyPlanSelected(planKey, { requireCompatibleSemester: false });
      if (!planAdded) {
        return;
      }

      this.selectedExtraCourseIds.add(courseId);
      this.renderIntoContainer();
    }
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
      const planKey = courseId.split("|")[0] ?? "";
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

  private toggleStudyPlanEnabled(planKey: string): void {
    const existing = this.selectedPlans.get(planKey);
    if (!existing) {
      return;
    }

    this.selectedPlans.set(planKey, {
      studyPlan: existing.studyPlan,
      enabled: !existing.enabled,
    });

    this.renderIntoContainer();
  }

  private removeStudyPlan(planKey: string): void {
    this.selectedPlans.delete(planKey);

    this.renderIntoContainer();
  }

  private toggleOptionalCourse(courseId: string): void {
    if (this.selectedOptionalCourseIds.has(courseId)) {
      this.selectedOptionalCourseIds.delete(courseId);
    } else {
      this.selectedOptionalCourseIds.add(courseId);
    }

    this.renderIntoContainer();
  }

  private toggleExtraCourse(courseId: string): void {
    if (this.selectedExtraCourseIds.has(courseId)) {
      this.selectedExtraCourseIds.delete(courseId);
    } else {
      this.selectedExtraCourseIds.add(courseId);
    }

    this.renderIntoContainer();
  }

  private toggleMandatoryGroupOpen(groupKey: string, open: boolean): void {
    this.hasStoredMandatoryGroupState = true;
    if (open) {
      this.openedMandatoryGroups.add(groupKey);
    } else {
      this.openedMandatoryGroups.delete(groupKey);
    }
    this.saveState();
  }

  private toggleOptionalGroupOpen(groupName: string, open: boolean): void {
    this.hasStoredOptionalGroupState = true;
    if (open) {
      this.openedOptionalGroups.add(groupName);
    } else {
      this.openedOptionalGroups.delete(groupName);
    }
    this.saveState();
  }

  private updateCurriculumPaneScroll(paneKey: string, scrollTop: number): void {
    this.curriculumPaneScrollTop[paneKey] = scrollTop;
  }

  private changeMainStudy(mainStudyName: string): void {
    this.activeMainStudy = mainStudyName;
    this.selectedOptionalCourseIds.clear();
    this.selectedExtraCourseIds.clear();
    this.openedMandatoryGroups.clear();
    this.openedOptionalGroups.clear();
    this.hasStoredMandatoryGroupState = false;
    this.hasStoredOptionalGroupState = false;
    Array.from(this.selectedPlans.keys()).forEach((planKey) => {
      const plan = this.selectedPlans.get(planKey);
      if (plan?.studyPlan.name === mainStudyName) {
        this.selectedPlans.delete(planKey);
      }
    });

    this.renderIntoContainer();
  }

  private changeSemester(semester: Semester): void {
    this.activeSemester = semester;

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
    this.saveState();
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

  private restoreCurriculumPaneScrollToDom(root: ParentNode): void {
    window.requestAnimationFrame(() => {
      root.querySelectorAll<HTMLElement>(".curriculum-panel-body[data-curriculum-pane-key]").forEach((pane) => {
        const paneKey = pane.dataset.curriculumPaneKey;
        if (!paneKey) {
          return;
        }

        pane.scrollTop = this.curriculumPaneScrollTop[paneKey] ?? 0;
      });
    });
  }

  private getSelectedStudyPlans(): TimetableWidgetData["selectedStudyPlans"] {
    return Array.from(this.selectedPlans.entries()).map(([planKey, selectedPlan], index) => ({
      key: planKey,
      studyPlan: selectedPlan.studyPlan,
      enabled: selectedPlan.enabled,
      color: PLAN_COLORS[index % PLAN_COLORS.length],
    }));
  }

  private getPlanColorByKey(selectedStudyPlans: TimetableWidgetData["selectedStudyPlans"]): TimetableWidgetData["planColorByKey"] {
    return Object.fromEntries(selectedStudyPlans.map((selectedPlan) => [selectedPlan.key, selectedPlan.color]));
  }

  private getAvailableStudyPlans(semester: Semester): TimetableWidgetData["availableStudyPlans"] {
    return this.studyPlans
      .filter((studyPlan) => isSemesterCompatible(studyPlan.semester, semester))
      .filter((studyPlan) => studyPlan.name !== this.activeMainStudy)
      .filter((studyPlan) => !this.selectedPlans.has(this.toPlanKey(studyPlan)))
      .map((studyPlan) => ({
        key: this.toPlanKey(studyPlan),
        studyPlan,
      }));
  }

  private getExtraCurriculumAddOptions(_semester: Semester): TimetableWidgetData["extraCurriculumAddOptions"] {
    const compatiblePlans = this.studyPlans
      .filter((studyPlan) => studyPlan.name !== this.activeMainStudy)
      .sort((a, b) => a.semester.localeCompare(b.semester) || a.name.localeCompare(b.name));

    const options: TimetableWidgetData["extraCurriculumAddOptions"] = [];

    compatiblePlans.forEach((studyPlan) => {
      const planKey = this.toPlanKey(studyPlan);
      options.push({
        key: `plan:${planKey}`,
        label: `Plan: ${studyPlan.semester} - ${studyPlan.name}`,
      });

      const sortedCourses = [...studyPlan.courses].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
      sortedCourses.forEach((course) => {
        options.push({
          key: `course:${this.toCourseSelectionId(studyPlan, course)}`,
          label: `Course: ${course.abbreviation} - ${course.name} (${studyPlan.semester} - ${studyPlan.name})`,
        });
      });
    });

    return options;
  }

  private ensureStudyPlanSelected(
    planKey: string,
    options: { requireCompatibleSemester: boolean },
  ): boolean {
    const existing = this.selectedPlans.get(planKey);
    if (existing) {
      existing.enabled = true;
      this.selectedPlans.set(planKey, existing);
      return true;
    }

    const matchingPlan = this.studyPlans.find((studyPlan) => {
      if (this.toPlanKey(studyPlan) !== planKey) {
        return false;
      }

      if (!options.requireCompatibleSemester) {
        return true;
      }

      return isSemesterCompatible(studyPlan.semester, this.activeSemester);
    });
    if (!matchingPlan || matchingPlan.name === this.activeMainStudy) {
      return false;
    }

    this.selectedPlans.set(planKey, { studyPlan: matchingPlan, enabled: true });
    return true;
  }

  private getMainStudyPlan(semester: Semester): StudyPlan | undefined {
    return this.studyPlans.find((studyPlan) => studyPlan.semester === semester && studyPlan.name === this.activeMainStudy);
  }

  private getMainStudyOptions(): string[] {
    return Array.from(new Set(this.studyPlans.map((studyPlan) => studyPlan.name))).sort((a, b) => a.localeCompare(b));
  }

  private getPlannedLectures(
    studyPlans: StudyPlan[],
    selectedOptionalIds: Set<string>,
    selectedExtraIds: Set<string>,
  ): PlannedLecture[] {
    return buildPlannedLectures(studyPlans, this.activeMainStudy, selectedOptionalIds, selectedExtraIds);
  }

  private getMandatoryCourseGroups(): TimetableWidgetData["mandatoryCourseGroups"] {
    const mainStudyPlans = this.studyPlans.filter((studyPlan) => studyPlan.name === this.activeMainStudy);

    return (["BA1", "BA2", "BA3", "BA4", "BA5", "BA6"] as const)
      .map((semester) => {
        const mergedCourses = new Map<string, TimetableWidgetData["mandatoryCourseGroups"][number]["courses"][number]>();
        const semesterPlans = mainStudyPlans.filter((studyPlan) => studyPlan.semester === semester);

        semesterPlans.forEach((studyPlan) => {
          studyPlan.courses.forEach((course) => {
            if (course.isOptional) {
              return;
            }

            const courseKey = `${course.abbreviation}|${course.name}`;
            const existing = mergedCourses.get(courseKey);
            if (!existing) {
              mergedCourses.set(courseKey, {
                id: courseKey,
                course,
                studyPlans: [studyPlan],
              });
              return;
            }

            if (!existing.studyPlans.some((existingPlan) => this.toPlanKey(existingPlan) === this.toPlanKey(studyPlan))) {
              existing.studyPlans.push(studyPlan);
            }
          });
        });

        return {
          semester,
          courses: Array.from(mergedCourses.values()).sort((a, b) => a.course.abbreviation.localeCompare(b.course.abbreviation)),
        };
      })
      .filter((group) => group.courses.length > 0);
  }

  private getOptionalCourseGroups(): TimetableWidgetData["optionalCourseGroups"] {
    const groups = new Map<string, TimetableWidgetData["optionalCourseGroups"][number]>();
    const mainStudyPlans = this.studyPlans.filter((studyPlan) => studyPlan.name === this.activeMainStudy);

    mainStudyPlans.forEach((studyPlan) => {
      studyPlan.courses.forEach((course) => {
        if (!course.isOptional) {
          return;
        }

        const groupName = course.group;
        const bucket = groups.get(groupName) ?? { groupName, courses: [] };
        const id = this.toCourseSelectionId(studyPlan, course);
        const existing = bucket.courses.find((entry) => entry.id === id);
        if (!existing) {
          bucket.courses.push({ id, course, studyPlans: [studyPlan] });
        }
        groups.set(groupName, bucket);
      });
    });

    return Array.from(groups.values())
      .map((group) => ({
        groupName: group.groupName,
        courses: group.courses.sort((a, b) => a.course.abbreviation.localeCompare(b.course.abbreviation)),
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName));
  }

  private syncOptionalGroupOpenState(groups: TimetableWidgetData["optionalCourseGroups"]): void {
    const names = new Set(groups.map((group) => group.groupName));

    Array.from(this.openedOptionalGroups).forEach((name) => {
      if (!names.has(name)) {
        this.openedOptionalGroups.delete(name);
      }
    });

    if (this.hasStoredOptionalGroupState) {
      return;
    }

    groups.forEach((group) => {
      if (!this.openedOptionalGroups.has(group.groupName)) {
        this.openedOptionalGroups.add(group.groupName);
      }
    });
  }

  private syncMandatoryGroupOpenState(groups: TimetableWidgetData["mandatoryCourseGroups"]): void {
    const keys = new Set(groups.map((group) => group.semester));

    Array.from(this.openedMandatoryGroups).forEach((key) => {
      if (!keys.has(key as Semester)) {
        this.openedMandatoryGroups.delete(key);
      }
    });

    if (this.hasStoredMandatoryGroupState) {
      return;
    }

    groups.forEach((group) => {
      if (!this.openedMandatoryGroups.has(group.semester)) {
        this.openedMandatoryGroups.add(group.semester);
      }
    });
  }

  private toPlanKey(studyPlan: StudyPlan): string {
    return buildPlanKey(studyPlan);
  }

  private toCourseSelectionId(studyPlan: StudyPlan, course: StudyPlan["courses"][number]): string {
    return buildCourseSelectionId(studyPlan, course);
  }

  private toLectureKey(lecture: PlannedLecture["lecture"]): string {
    return buildLectureKey(lecture);
  }

  private applyStoredState(state: StoredState): void {
    const mainStudyOptions = this.getMainStudyOptions();
    if (typeof state.activeMainStudy === "string" && mainStudyOptions.includes(state.activeMainStudy)) {
      this.activeMainStudy = state.activeMainStudy;
    }
    if (state.activeSemester && TAB_SEMESTERS.includes(state.activeSemester)) {
      this.activeSemester = state.activeSemester;
    }
    if (state.activeTab === "planner" || state.activeTab === "timetable") {
      this.activeTab = state.activeTab;
    }

    const planByKey = new Map(this.studyPlans.map((studyPlan) => [this.toPlanKey(studyPlan), studyPlan]));
    if (Array.isArray(state.selectedPlans)) {
      this.selectedPlans.clear();
      state.selectedPlans.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }
        const key = (entry as { key?: unknown }).key;
        const enabled = (entry as { enabled?: unknown }).enabled;
        if (typeof key !== "string") {
          return;
        }
        const plan = planByKey.get(key);
        if (!plan || plan.name === this.activeMainStudy) {
          return;
        }
        this.selectedPlans.set(key, { studyPlan: plan, enabled: typeof enabled === "boolean" ? enabled : true });
      });
    }

    const allCourseIds = new Set<string>();
    this.studyPlans.forEach((studyPlan) => {
      studyPlan.courses.forEach((course) => {
        allCourseIds.add(this.toCourseSelectionId(studyPlan, course));
      });
    });

    const optionalCourseIds = new Set<string>();
    this.studyPlans
      .filter((studyPlan) => studyPlan.name === this.activeMainStudy)
      .forEach((studyPlan) => {
        studyPlan.courses.forEach((course) => {
          if (course.isOptional) {
            optionalCourseIds.add(this.toCourseSelectionId(studyPlan, course));
          }
        });
      });

    this.selectedOptionalCourseIds.clear();
    filterStringArray(state.selectedOptionalCourseIds).forEach((id) => {
      if (optionalCourseIds.has(id)) {
        this.selectedOptionalCourseIds.add(id);
      }
    });

    this.selectedExtraCourseIds.clear();
    filterStringArray(state.selectedExtraCourseIds).forEach((id) => {
      if (allCourseIds.has(id)) {
        this.selectedExtraCourseIds.add(id);
      }
    });

    this.openedMandatoryGroups.clear();
    filterStringArray(state.openedMandatoryGroups).forEach((key) => this.openedMandatoryGroups.add(key));
    this.hasStoredMandatoryGroupState = state.openedMandatoryGroups !== undefined;

    this.openedOptionalGroups.clear();
    filterStringArray(state.openedOptionalGroups).forEach((key) => this.openedOptionalGroups.add(key));
    this.hasStoredOptionalGroupState = state.openedOptionalGroups !== undefined;

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
      version: 1,
      activeMainStudy: this.activeMainStudy,
      activeSemester: this.activeSemester,
      activeTab: this.activeTab,
    };

    if (this.selectedPlans.size > 0) {
      payload.selectedPlans = Array.from(this.selectedPlans.entries()).map(([key, { enabled }]) => ({ key, enabled }));
    }
    if (this.selectedOptionalCourseIds.size > 0) {
      payload.selectedOptionalCourseIds = Array.from(this.selectedOptionalCourseIds);
    }
    if (this.selectedExtraCourseIds.size > 0) {
      payload.selectedExtraCourseIds = Array.from(this.selectedExtraCourseIds);
    }
    if (this.hasStoredMandatoryGroupState) {
      payload.openedMandatoryGroups = Array.from(this.openedMandatoryGroups);
    }
    if (this.hasStoredOptionalGroupState) {
      payload.openedOptionalGroups = Array.from(this.openedOptionalGroups);
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

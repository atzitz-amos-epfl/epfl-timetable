import { timetableConfig, type TimetableConfig } from "./config/timetableConfig";
import { TimetableWidget, type TimetableWidgetData } from "./components/timetableWidget";
import { TimetableModel } from "./domain/timetableModel";
import type { PlannedLecture, StudyPlan } from "./types";

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

export class Timetable {
  private readonly model: TimetableModel;
  private readonly studyPlans: StudyPlan[];
  private readonly selectedPlans: Map<string, SelectedStudyPlan>;
  private container: HTMLElement | null = null;

  public constructor(
    studyPlans: StudyPlan[],
    private readonly config: TimetableConfig = timetableConfig,
  ) {
    this.model = new TimetableModel(this.config);
    this.studyPlans = studyPlans;
    this.selectedPlans = new Map();
  }

  public attach(container: HTMLElement): void {
    this.container = container;
    this.renderIntoContainer();
  }

  public render(): HTMLElement {
    const selectedStudyPlans = this.getSelectedStudyPlans();
    const visibleStudyPlans = selectedStudyPlans.filter((selectedPlan) => selectedPlan.enabled).map((selectedPlan) => selectedPlan.studyPlan);
    const plannedLectures = this.getPlannedLectures(visibleStudyPlans);
    const conflictSlotBlocks = this.model.buildConflictSlotBlocks(plannedLectures);

    const data: TimetableWidgetData = {
      selectedStudyPlans,
      availableStudyPlans: this.getAvailableStudyPlans(),
      plannedLectures,
      conflictSlotBlocks,
      planColorByKey: this.getPlanColorByKey(selectedStudyPlans),
      onAddStudyPlan: (planKey: string) => this.addStudyPlan(planKey),
      onToggleStudyPlanEnabled: (planKey: string) => this.toggleStudyPlanEnabled(planKey),
      onRemoveStudyPlan: (planKey: string) => this.removeStudyPlan(planKey),
    };

    return new TimetableWidget(data, this.model, this.config).render();
  }

  private addStudyPlan(planKey: string): void {
    const existing = this.selectedPlans.get(planKey);
    if (existing) {
      existing.enabled = true;
      this.selectedPlans.set(planKey, existing);
      this.renderIntoContainer();
      return;
    }

    const matchingPlan = this.studyPlans.find((studyPlan) => this.toPlanKey(studyPlan) === planKey);
    if (!matchingPlan) {
      return;
    }

    this.selectedPlans.set(planKey, { studyPlan: matchingPlan, enabled: true });
    this.renderIntoContainer();
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

  private renderIntoContainer(): void {
    if (!this.container) {
      return;
    }

    this.container.replaceChildren(this.render());
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

  private getAvailableStudyPlans(): TimetableWidgetData["availableStudyPlans"] {
    return this.studyPlans
      .filter((studyPlan) => !this.selectedPlans.has(this.toPlanKey(studyPlan)))
      .map((studyPlan) => ({
        key: this.toPlanKey(studyPlan),
        studyPlan,
      }));
  }

  private getPlannedLectures(studyPlans: StudyPlan[]): PlannedLecture[] {
    const mergedLectures = new Map<string, PlannedLecture>();

    studyPlans.forEach((studyPlan) => {
      studyPlan.courses.forEach((course) => {
        course.lectures.forEach((lecture) => {
          const lectureKey = this.toLectureKey(lecture);
          const existing = mergedLectures.get(lectureKey);

          if (!existing) {
            mergedLectures.set(lectureKey, {
              id: lectureKey,
              lecture,
              studyPlans: [studyPlan],
            });
            return;
          }

          existing.studyPlans.push(studyPlan);
        });
      });
    });

    return Array.from(mergedLectures.values());
  }

  private toPlanKey(studyPlan: StudyPlan): string {
    return `${studyPlan.semester}:${studyPlan.name}`;
  }

  private toLectureKey(lecture: PlannedLecture["lecture"]): string {
    return [
      lecture.course.abbreviation,
      lecture.course.name,
      lecture.type,
      lecture.day,
      lecture.timeStart,
      lecture.timeEnd,
    ].join("|");
  }
}


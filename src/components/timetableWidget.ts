import { timetableConfig, type TimetableConfig } from "../config/timetableConfig";
import type { ConflictSlotBlock } from "../domain/timetableModel";
import { TimetableModel } from "../domain/timetableModel";
import type { PlannedLecture, StudyPlan } from "../types";
import { Heading } from "./heading";
import { TimetableGrid } from "./timetableGrid";

interface SelectedStudyPlanChip {
  key: string;
  studyPlan: StudyPlan;
  enabled: boolean;
  color: string;
}

interface StudyPlanOption {
  key: string;
  studyPlan: StudyPlan;
}

export interface TimetableWidgetData {
  selectedStudyPlans: SelectedStudyPlanChip[];
  availableStudyPlans: StudyPlanOption[];
  plannedLectures: PlannedLecture[];
  conflictSlotBlocks: ConflictSlotBlock[];
  planColorByKey: Record<string, string>;
  onAddStudyPlan: (planKey: string) => void;
  onToggleStudyPlanEnabled: (planKey: string) => void;
  onRemoveStudyPlan: (planKey: string) => void;
}

export class TimetableWidget {
  public constructor(
    private readonly data: TimetableWidgetData,
    private readonly model: TimetableModel,
    private readonly config: TimetableConfig = timetableConfig,
  ) {}

  public render(): HTMLElement {
    const periods = this.model.buildPeriods();

    const widget = document.createElement("section");
    widget.className = "timetable-widget";

    const visibleCourseCount = new Set(
      this.data.plannedLectures.map((plannedLecture) => plannedLecture.lecture.course.abbreviation),
    ).size;

    const heading = new Heading(
      this.config.title,
      this.config.subtitleTemplate(visibleCourseCount),
    ).render();
    const studyPlanSelector = this.createStudyPlanSelector();

    const grid = new TimetableGrid(this.config.days, periods, this.config.layout);
    const gridElement = grid.render();
    const lectureLayouts = this.model.buildLectureLayouts(this.data.plannedLectures);

    this.data.conflictSlotBlocks.forEach((block) => {
      grid.appendLectureBlock(this.createConflictSlotOverlay(block, grid));
    });

    this.data.plannedLectures.forEach((plannedLecture) => {
      const safeLecture = this.model.clampLecture(plannedLecture.lecture);
      if (safeLecture.timeEnd <= safeLecture.timeStart) {
        return;
      }

      const lectureLayout = lectureLayouts.get(plannedLecture.id);
      grid.appendLectureBlock(
        this.createLectureBlock({ ...plannedLecture, lecture: safeLecture }, grid, lectureLayout?.laneIndex ?? 0, lectureLayout?.laneCount ?? 1),
      );
    });

    widget.appendChild(heading);
    widget.appendChild(studyPlanSelector);
    widget.appendChild(gridElement);

    return widget;
  }

  private createLectureBlock(
    plannedLecture: PlannedLecture,
    grid: TimetableGrid,
    laneIndex: number,
    laneCount: number,
  ): HTMLElement {
    const { lecture, studyPlans } = plannedLecture;
    const planColor = this.resolvePlanColor(studyPlans);
    const planBorder = this.resolvePlanBorder(studyPlans);
    const lectureSpan = this.model.lectureSpan(lecture);
    const isSinglePeriod = lectureSpan === 1;
    const lectureBlock = document.createElement("article");
    lectureBlock.className = `lecture ${lecture.type}`;
    lectureBlock.style.setProperty("--plan-color", planColor);
    lectureBlock.style.setProperty("--plan-border", planBorder);

    if (laneCount > 1) {
      lectureBlock.classList.add("compact");
    }

    if (isSinglePeriod) {
      lectureBlock.classList.add("single-period");
    }

    if (studyPlans.length > 1) {
      lectureBlock.classList.add("merged");
    }

    lectureBlock.style.setProperty("--lecture-lane-index", `${laneIndex}`);
    lectureBlock.style.setProperty("--lecture-lane-count", `${Math.max(1, laneCount)}`);
    lectureBlock.style.gridColumn = grid.getGridColumn(lecture.day);
    lectureBlock.style.gridRow = `${grid.getGridRowStart(lecture.timeStart)} / span ${lectureSpan}`;
    lectureBlock.ariaLabel = this.buildLectureTitle(plannedLecture);

    const abbreviation = document.createElement("div");
    abbreviation.className = "lecture-abbreviation";
    abbreviation.textContent = lecture.course.abbreviation;

    const name = document.createElement("div");
    name.className = "lecture-name";
    name.textContent = lecture.course.name;

    const type = document.createElement("div");
    type.className = "lecture-type";
    type.textContent = lecture.type;

    lectureBlock.appendChild(abbreviation);
    lectureBlock.appendChild(name);
    lectureBlock.appendChild(type);
    lectureBlock.appendChild(this.createCourseOverlay(plannedLecture, lectureBlock));

    return lectureBlock;
  }

  private buildLectureTitle(plannedLecture: PlannedLecture): string {
    const { lecture, studyPlans } = plannedLecture;
    const plans = studyPlans.map((studyPlan) => `${studyPlan.semester} - ${studyPlan.name}`).join(" | ");
    return `${lecture.course.abbreviation} - ${lecture.course.name} (${lecture.type})${plans ? `\n${plans}` : ""}`;
  }

  private createCourseOverlay(plannedLecture: PlannedLecture, lectureBlock: HTMLElement): HTMLElement {
    const { course } = plannedLecture.lecture;
    const overlay = document.createElement("aside");
    overlay.className = "lecture-course-overlay";

    const title = document.createElement("div");
    title.className = "lecture-course-overlay-title";
    title.textContent = `${course.abbreviation} - ${course.name}`;

    const teacher = document.createElement("div");
    teacher.className = "lecture-course-overlay-row";
    teacher.textContent = `Teacher: ${course.teacher}`;

    const credits = document.createElement("div");
    credits.className = "lecture-course-overlay-row";
    credits.textContent = `Credits: ${course.credits}`;

    const group = document.createElement("div");
    group.className = "lecture-course-overlay-row";
    group.textContent = `Group: ${course.group}`;

    const link = document.createElement("a");
    link.className = "lecture-course-overlay-link";
    link.href = course.linkToCourse;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Course page";

    overlay.appendChild(title);
    overlay.appendChild(teacher);
    overlay.appendChild(credits);
    overlay.appendChild(group);
    overlay.appendChild(link);

    let hoverTimer: number | null = null;
    let hideTimer: number | null = null;

    const clearTimers = (): void => {
      if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
      }

      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    const scheduleHideOverlay = (): void => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }

      hideTimer = window.setTimeout(() => {
        clearTimers();
        overlay.classList.remove("visible");
      }, 220);
    };

    const showOverlay = (): void => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }

      if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
      }

      hoverTimer = window.setTimeout(() => {
        const offset = 10;
        const popupWidth = 300;
        const popupHeight = 170;
        const rect = lectureBlock.getBoundingClientRect();
        const maxLeft = Math.max(offset, window.innerWidth - popupWidth - offset);
        const maxTop = Math.max(offset, window.innerHeight - popupHeight - offset);
        const left = Math.min(maxLeft, rect.right + offset);
        const top = Math.min(maxTop, rect.top);

        overlay.style.setProperty("--overlay-left", `${left}px`);
        overlay.style.setProperty("--overlay-top", `${top}px`);
        overlay.classList.add("visible");
        hoverTimer = null;
      }, 500);
    };

    lectureBlock.addEventListener("mouseenter", showOverlay);
    lectureBlock.addEventListener("mouseleave", scheduleHideOverlay);
    overlay.addEventListener("mouseenter", showOverlay);
    overlay.addEventListener("mouseleave", scheduleHideOverlay);

    return overlay;
  }

  private createStudyPlanSelector(): HTMLElement {
    const selector = document.createElement("section");
    selector.className = "study-plan-selector";

    const title = document.createElement("h2");
    title.className = "study-plan-selector-title";
    title.textContent = "Visible Study Plans";
    selector.appendChild(title);

    selector.appendChild(this.createPlanPicker());
    selector.appendChild(this.createStudyPlanChips());
    return selector;
  }

  private createPlanPicker(): HTMLElement {
    const picker = document.createElement("div");
    picker.className = "study-plan-picker";

    const select = document.createElement("select");
    select.className = "study-plan-dropdown";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Add study plan...";
    placeholder.selected = true;
    select.appendChild(placeholder);

    this.data.availableStudyPlans.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.key;
      element.textContent = `${option.studyPlan.semester} - ${option.studyPlan.name}`;
      select.appendChild(element);
    });

    select.addEventListener("change", () => {
      if (!select.value) {
        return;
      }

      this.data.onAddStudyPlan(select.value);
      select.value = "";
    });

    picker.appendChild(select);
    return picker;
  }

  private createStudyPlanChips(): HTMLElement {
    const chips = document.createElement("div");
    chips.className = "study-plan-chips";

    this.data.selectedStudyPlans.forEach((selectedPlan) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "study-plan-chip";
      chip.style.setProperty("--plan-color", selectedPlan.color);

      if (!selectedPlan.enabled) {
        chip.classList.add("disabled");
      }

      chip.addEventListener("click", () => this.data.onToggleStudyPlanEnabled(selectedPlan.key));

      const label = document.createElement("span");
      label.className = "study-plan-chip-label";
      label.textContent = `${selectedPlan.studyPlan.semester} - ${selectedPlan.studyPlan.name}`;

      const remove = document.createElement("span");
      remove.className = "study-plan-chip-remove";
      remove.textContent = "x";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        this.data.onRemoveStudyPlan(selectedPlan.key);
      });

      chip.appendChild(label);
      chip.appendChild(remove);
      chips.appendChild(chip);
    });

    return chips;
  }

  private createConflictSlotOverlay(block: ConflictSlotBlock, grid: TimetableGrid): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "conflict-slot-overlay";
    overlay.style.gridColumn = grid.getGridColumn(block.day);
    overlay.style.gridRow = `${grid.getGridRowStart(block.start)} / span ${Math.max(1, block.end - block.start)}`;

    return overlay;
  }

  private resolvePlanColor(studyPlans: StudyPlan[]): string {
    for (let index = 0; index < studyPlans.length; index += 1) {
      const key = this.toPlanKey(studyPlans[index]);
      const color = this.data.planColorByKey[key];
      if (color) {
        return color;
      }
    }

    return "#9ca3af";
  }

  private resolvePlanBorder(studyPlans: StudyPlan[]): string {
    const colors = Array.from(
      new Set(
        studyPlans
          .map((studyPlan) => this.data.planColorByKey[this.toPlanKey(studyPlan)])
          .filter((color): color is string => Boolean(color)),
      ),
    );

    if (colors.length === 0) {
      return "#9ca3af";
    }

    if (colors.length === 1) {
      return colors[0];
    }

    const segmentSize = 100 / colors.length;
    const stops = colors
      .map((color, index) => {
        const start = (index * segmentSize).toFixed(2);
        const end = ((index + 1) * segmentSize).toFixed(2);
        return `${color} ${start}%, ${color} ${end}%`;
      })
      .join(", ");

    return `linear-gradient(180deg, ${stops})`;
  }

  private toPlanKey(studyPlan: StudyPlan): string {
    return `${studyPlan.semester}:${studyPlan.name}`;
  }
}


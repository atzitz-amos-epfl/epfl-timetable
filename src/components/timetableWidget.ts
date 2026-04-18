import { timetableConfig, type TimetableConfig } from "../config/timetableConfig";
import type { ConflictSlotBlock } from "../domain/timetableModel";
import { TimetableModel } from "../domain/timetableModel";
import type { Course, PlannedLecture, Semester, StudyPlan } from "../types";
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

interface ExtraCurriculumAddOption {
  key: string;
  label: string;
}

export interface CurriculumCourse {
  id: string;
  course: Course;
  studyPlans: StudyPlan[];
}

export interface CurriculumCourseGroup {
  semester: Semester;
  courses: CurriculumCourse[];
}

export interface OptionalCourseGroup {
  groupName: string;
  courses: CurriculumCourse[];
}

export interface TimetableWidgetData {
  mainStudyOptions: string[];
  activeMainStudy: string;
  semesters: Semester[];
  activeSemester: Semester;
  selectedStudyPlans: SelectedStudyPlanChip[];
  availableStudyPlans: StudyPlanOption[];
  extraCurriculumAddOptions: ExtraCurriculumAddOption[];
  mandatoryCourseGroups: CurriculumCourseGroup[];
  openedMandatoryGroupKeys: string[];
  optionalCourseGroups: OptionalCourseGroup[];
  selectedOptionalCourseIds: string[];
  selectedExtraCourseIds: string[];
  optionalOpenGroupNames: string[];
  curriculumPaneScrollTop: Record<string, number>;
  plannedLectures: PlannedLecture[];
  conflictSlotBlocks: ConflictSlotBlock[];
  planColorByKey: Record<string, string>;
  onChangeMainStudy: (mainStudyName: string) => void;
  onChangeSemester: (semester: Semester) => void;
  onAddStudyPlan: (planKey: string) => void;
  onAddExtraCurriculumItem: (itemKey: string) => void;
  onToggleStudyPlanEnabled: (planKey: string) => void;
  onRemoveStudyPlan: (planKey: string) => void;
  onToggleOptionalCourse: (courseId: string) => void;
  onToggleExtraCourse: (courseId: string) => void;
  onToggleMandatoryGroupOpen: (groupKey: string, open: boolean) => void;
  onToggleOptionalGroupOpen: (groupName: string, open: boolean) => void;
  onCurriculumPaneScroll: (paneKey: string, scrollTop: number) => void;
}

export class TimetableWidget {
  private static readonly MODAL_FADE_DURATION_MS = 180;

  private static normalizeSearchValue(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  private static semesterRank(semester: Semester): number {
    return Number.parseInt(semester.replace("BA", ""), 10);
  }

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
    const topBar = document.createElement("div");
    topBar.className = "timetable-topbar";
    topBar.appendChild(heading);
    topBar.appendChild(this.createMainStudyPicker());

    const curriculumSection = this.createCurriculumSection();
    const semesterSelectorRow = document.createElement("div");
    semesterSelectorRow.className = "semester-selector-row";
    semesterSelectorRow.appendChild(this.createSemesterTabs());

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

    widget.appendChild(topBar);
    widget.appendChild(curriculumSection);
    widget.appendChild(semesterSelectorRow);
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

    const linkToCourse = lecture.course.linkToCourse.trim();
    if (linkToCourse.length > 0) {
      lectureBlock.classList.add("clickable");
      lectureBlock.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".lecture-course-overlay")) {
          return;
        }

        this.openCourseModal(linkToCourse, `${lecture.course.abbreviation} - ${lecture.course.name}`);
      });
    }

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
        lectureBlock.classList.remove("overlay-active");
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
        lectureBlock.classList.add("overlay-active");
        hoverTimer = null;
      }, 1000);
    };

    lectureBlock.addEventListener("mouseenter", showOverlay);
    lectureBlock.addEventListener("mouseleave", scheduleHideOverlay);
    overlay.addEventListener("mouseenter", showOverlay);
    overlay.addEventListener("mouseleave", scheduleHideOverlay);

    return overlay;
  }

  private openCourseModal(url: string, title: string): void {
    const existing = document.querySelector(".course-link-modal-backdrop");
    if (existing) {
      return;
    }

    const backdrop = document.createElement("div");
    backdrop.className = "course-link-modal-backdrop";

    const modal = document.createElement("section");
    modal.className = "course-link-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", title);

    const header = document.createElement("header");
    header.className = "course-link-modal-header";

    const heading = document.createElement("h3");
    heading.className = "course-link-modal-title";
    heading.textContent = title;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "course-link-modal-close";
    closeButton.textContent = "Close";

    const frame = document.createElement("iframe");
    frame.className = "course-link-modal-frame";
    frame.src = url;
    frame.loading = "lazy";
    frame.referrerPolicy = "no-referrer";
    frame.title = title;

    header.appendChild(heading);
    header.appendChild(closeButton);
    modal.appendChild(header);
    modal.appendChild(frame);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const closeModal = (): void => {
      backdrop.classList.remove("visible");
      window.removeEventListener("keydown", handleEscape);
      window.setTimeout(() => backdrop.remove(), TimetableWidget.MODAL_FADE_DURATION_MS);
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    closeButton.addEventListener("click", closeModal);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeModal();
      }
    });

    window.addEventListener("keydown", handleEscape);
    window.requestAnimationFrame(() => backdrop.classList.add("visible"));
  }

  private createMainStudyPicker(): HTMLElement {
    const picker = document.createElement("div");
    picker.className = "main-study-picker";

    const label = document.createElement("label");
    label.className = "main-study-label";
    label.textContent = "Main Studies:";
    label.setAttribute("for", "main-study-dropdown");

    const select = document.createElement("select");
    select.className = "main-study-dropdown";
    select.id = "main-study-dropdown";

    this.data.mainStudyOptions.forEach((mainStudy) => {
      const option = document.createElement("option");
      option.value = mainStudy;
      option.textContent = mainStudy;
      option.selected = mainStudy === this.data.activeMainStudy;
      select.appendChild(option);
    });

    select.addEventListener("change", () => {
      if (!select.value || select.value === this.data.activeMainStudy) {
        return;
      }

      this.data.onChangeMainStudy(select.value);
    });

    picker.appendChild(label);
    picker.appendChild(select);
    return picker;
  }

  private createSemesterTabs(): HTMLElement {
    const tabs = document.createElement("div");
    tabs.className = "semester-tabs";

    this.data.semesters.forEach((semester) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "semester-tab";
      tab.textContent = semester;

      if (semester === this.data.activeSemester) {
        tab.classList.add("active");
      }

      tab.addEventListener("click", () => {
        if (semester === this.data.activeSemester) {
          return;
        }

        this.data.onChangeSemester(semester);
      });

      tabs.appendChild(tab);
    });

    return tabs;
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

  private createCurriculumSection(): HTMLElement {
    const section = document.createElement("section");
    section.className = "curriculum-section";

    section.appendChild(this.createCurriculumPanel("mandatory", "Mandatory Courses", this.createMandatoryCoursesContent(), false));
    section.appendChild(this.createCurriculumPanel("optional", "Optional Courses", this.createOptionalCoursesContent(), false));
    section.appendChild(this.createCurriculumPanel("extra", "Extra-Curriculum Courses", this.createExtraCurriculumContent(), false));

    return section;
  }

  private createCurriculumPanel(
    paneKey: "mandatory" | "optional" | "extra",
    titleText: string,
    content: HTMLElement,
    collapsible: boolean,
  ): HTMLElement {
    const panel = collapsible ? document.createElement("details") : document.createElement("article");
    panel.className = "curriculum-panel";

    const title = document.createElement(collapsible ? "summary" : "h3");
    title.className = "curriculum-panel-title";
    title.textContent = titleText;

    const body = document.createElement("div");
    body.className = "curriculum-panel-body";
    body.dataset.curriculumPaneKey = paneKey;
    body.scrollTop = this.data.curriculumPaneScrollTop[paneKey] ?? 0;
    body.addEventListener("scroll", () => this.data.onCurriculumPaneScroll(paneKey, body.scrollTop), { passive: true });
    body.appendChild(content);

    panel.appendChild(title);
    panel.appendChild(body);
    return panel;
  }

  private createMandatoryCoursesContent(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "mandatory-courses-grid";
    const openedGroups = new Set(this.data.openedMandatoryGroupKeys);

    if (this.data.mandatoryCourseGroups.length === 0) {
      return this.createPlaceholderContent("No mandatory courses for the current selection.");
    }

    this.data.mandatoryCourseGroups.forEach((group) => {
      const section = document.createElement("details");
      section.className = "mandatory-semester-group";
      const groupKey = group.semester;
      section.open = openedGroups.has(groupKey);
      section.addEventListener("toggle", () => this.data.onToggleMandatoryGroupOpen(groupKey, section.open));

      const semesterTitle = document.createElement("summary");
      semesterTitle.className = "mandatory-semester-title";
      semesterTitle.textContent = group.semester;

      const cards = document.createElement("div");
      cards.className = "mandatory-semester-cards";

      group.courses.forEach((entry) => {
        const card = document.createElement("article");
        card.className = "mandatory-course-card";
        const linkToCourse = entry.course.linkToCourse.trim();

        if (linkToCourse.length > 0) {
          card.classList.add("clickable");
          card.addEventListener("click", () => {
            this.openCourseModal(linkToCourse, `${entry.course.abbreviation} - ${entry.course.name}`);
          });
        }

        const header = document.createElement("div");
        header.className = "mandatory-course-header";

        const abbreviation = document.createElement("span");
        abbreviation.className = "mandatory-course-abbreviation";
        abbreviation.textContent = entry.course.abbreviation;

        const credits = document.createElement("span");
        credits.className = "mandatory-course-credits";
        credits.textContent = `${entry.course.credits} ECTS`;

        const name = document.createElement("div");
        name.className = "mandatory-course-name";
        name.textContent = entry.course.name;

        const meta = document.createElement("div");
        meta.className = "mandatory-course-meta";
        meta.textContent = `${entry.course.teacher} | ${entry.course.group}`;

        header.appendChild(abbreviation);
        header.appendChild(credits);
        card.appendChild(header);
        card.appendChild(name);
        card.appendChild(meta);
        cards.appendChild(card);
      });

      section.appendChild(semesterTitle);
      section.appendChild(cards);
      wrapper.appendChild(section);
    });

    return wrapper;
  }

  private createOptionalCoursesContent(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "optional-courses-grid";

    if (this.data.optionalCourseGroups.length === 0) {
      return this.createPlaceholderContent("No optional courses for the current selection.");
    }

    const selectedIds = new Set(this.data.selectedOptionalCourseIds);
    const openGroups = new Set(this.data.optionalOpenGroupNames);

    this.data.optionalCourseGroups.forEach((group) => {
      const section = document.createElement("details");
      section.className = "optional-group";
      section.open = openGroups.has(group.groupName);
      section.addEventListener("toggle", () => this.data.onToggleOptionalGroupOpen(group.groupName, section.open));

      const title = document.createElement("summary");
      title.className = "optional-group-title";

      const titleText = document.createElement("span");
      titleText.className = "optional-group-title-text";
      titleText.textContent = group.groupName;

      const selectedCredits = group.courses
        .filter((entry) => selectedIds.has(entry.id))
        .reduce((total, entry) => total + entry.course.credits, 0);

      const selectedCreditsBadge = document.createElement("span");
      selectedCreditsBadge.className = "optional-group-selected-credits";
      selectedCreditsBadge.textContent = `${selectedCredits} ECTS`;

      title.appendChild(titleText);
      title.appendChild(selectedCreditsBadge);

      const cards = document.createElement("div");
      cards.className = "optional-group-cards";

      const orderedCourses = [...group.courses].sort((a, b) => {
        const semesterA = a.studyPlans[0]?.semester ?? "BA1";
        const semesterB = b.studyPlans[0]?.semester ?? "BA1";
        const bySemester = TimetableWidget.semesterRank(semesterA) - TimetableWidget.semesterRank(semesterB);
        if (bySemester !== 0) {
          return bySemester;
        }

        return a.course.abbreviation.localeCompare(b.course.abbreviation);
      });

      orderedCourses.forEach((entry) => {
        const card = document.createElement("article");
        card.className = "optional-course-card";
        const isSelected = selectedIds.has(entry.id);
        if (isSelected) {
          card.classList.add("selected");
        }

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.className = "optional-course-toggle";
        toggle.checked = isSelected;
        toggle.addEventListener("click", (event) => event.stopPropagation());
        toggle.addEventListener("change", () => this.data.onToggleOptionalCourse(entry.id));

        card.addEventListener("click", (event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".optional-course-content") || target.closest(".optional-course-toggle")) {
            return;
          }

          event.stopPropagation();
          this.data.onToggleOptionalCourse(entry.id);
        });

        const content = document.createElement("button");
        content.type = "button";
        content.className = "optional-course-content";

        const linkToCourse = entry.course.linkToCourse.trim();
        if (linkToCourse.length > 0) {
          content.addEventListener("click", (event) => {
            event.stopPropagation();
            this.openCourseModal(linkToCourse, `${entry.course.abbreviation} - ${entry.course.name}`);
          });
        }

        const header = document.createElement("div");
        header.className = "optional-course-header";

        const abbreviation = document.createElement("span");
        abbreviation.className = "optional-course-abbreviation";
        abbreviation.textContent = entry.course.abbreviation;

        const credits = document.createElement("span");
        credits.className = "optional-course-credits";
        credits.textContent = `${entry.course.credits} ECTS`;

        const name = document.createElement("div");
        name.className = "optional-course-name";
        name.textContent = entry.course.name;

        const firstPlan = entry.studyPlans[0];
        const meta = document.createElement("div");
        meta.className = "optional-course-meta";
        meta.textContent = `${entry.course.teacher} | ${firstPlan?.semester ?? ""}`;

        header.appendChild(abbreviation);
        header.appendChild(credits);
        content.appendChild(header);
        content.appendChild(name);
        content.appendChild(meta);

        card.appendChild(toggle);
        card.appendChild(content);
        cards.appendChild(card);
      });

      section.appendChild(title);
      section.appendChild(cards);
      wrapper.appendChild(section);
    });

    return wrapper;
  }

  private createExtraCurriculumContent(): HTMLElement {
            const selectedExtraIds = new Set(this.data.selectedExtraCourseIds);

    const wrapper = document.createElement("div");
    wrapper.className = "extra-curriculum-content";

    const addRow = document.createElement("div");
    addRow.className = "extra-curriculum-add-row";

    const addLabel = document.createElement("label");
    addLabel.className = "extra-curriculum-add-label";
    addLabel.setAttribute("for", "extra-curriculum-dropdown");
    addLabel.textContent = "Add Course:";

    const combo = document.createElement("div");
    combo.className = "extra-curriculum-combobox";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "extra-curriculum-dropdown";
    input.id = "extra-curriculum-dropdown";
    input.placeholder = "Search course or study plan...";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");

    const optionsList = document.createElement("div");
    optionsList.className = "extra-curriculum-options";
    optionsList.setAttribute("role", "listbox");

    let isOpen = false;
    let activeIndex = -1;
    let filtered = [...this.data.extraCurriculumAddOptions];

    const renderOptions = (): void => {
      optionsList.replaceChildren();

      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "extra-curriculum-option-empty";
        empty.textContent = "No matching course or plan";
        optionsList.appendChild(empty);
        return;
      }

      let lastPrefix = "";
      filtered.forEach((option, index) => {
        const prefix = option.label.startsWith("Plan:") ? "Plans" : "Courses";
        if (prefix !== lastPrefix) {
          const header = document.createElement("div");
          header.className = "extra-curriculum-option-group";
          header.textContent = prefix;
          optionsList.appendChild(header);
          lastPrefix = prefix;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "extra-curriculum-option";
        if (index === activeIndex) {
          button.classList.add("active");
        }
        button.textContent = option.label;

        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          input.value = "";
          this.data.onAddExtraCurriculumItem(option.key);
        });

        optionsList.appendChild(button);
      });
    };

    const openOptions = (): void => {
      isOpen = true;
      combo.classList.add("open");
      input.setAttribute("aria-expanded", "true");
      renderOptions();
    };

    const closeOptions = (): void => {
      isOpen = false;
      combo.classList.remove("open");
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
    };

    const updateFilter = (): void => {
      const query = TimetableWidget.normalizeSearchValue(input.value.trim());
      filtered = this.data.extraCurriculumAddOptions.filter((option) => {
        return TimetableWidget.normalizeSearchValue(option.label).includes(query);
      });
      activeIndex = filtered.length > 0 ? 0 : -1;
      if (isOpen) {
        renderOptions();
      }
    };

    input.addEventListener("focus", () => {
      updateFilter();
      openOptions();
    });

    input.addEventListener("input", () => {
      updateFilter();
      openOptions();
    });

    input.addEventListener("keydown", (event) => {
      if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        updateFilter();
        openOptions();
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filtered.length > 0) {
          activeIndex = (activeIndex + 1 + filtered.length) % filtered.length;
          renderOptions();
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length > 0) {
          activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
          renderOptions();
        }
      } else if (event.key === "Enter") {
        if (isOpen && activeIndex >= 0 && filtered[activeIndex]) {
          event.preventDefault();
          input.value = "";
          this.data.onAddExtraCurriculumItem(filtered[activeIndex].key);
        }
      } else if (event.key === "Escape") {
        closeOptions();
      }
    });

    combo.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!combo.contains(document.activeElement)) {
          closeOptions();
        }
      }, 0);
    });

    combo.appendChild(input);
    combo.appendChild(optionsList);

    addRow.appendChild(addLabel);
    addRow.appendChild(combo);
    wrapper.appendChild(addRow);

    if (this.data.selectedStudyPlans.length === 0) {
      wrapper.appendChild(this.createPlaceholderContent("No extra-curriculum study plan selected."));
      return wrapper;
    }

    const groupedByStudyPlan = document.createElement("div");
    groupedByStudyPlan.className = "extra-curriculum-groups";

    const orderedStudyPlans = [...this.data.selectedStudyPlans].sort((a, b) => {
      const bySemester = TimetableWidget.semesterRank(a.studyPlan.semester) - TimetableWidget.semesterRank(b.studyPlan.semester);
      if (bySemester !== 0) {
        return bySemester;
      }

      return a.studyPlan.name.localeCompare(b.studyPlan.name);
    });

    orderedStudyPlans.forEach((selectedPlan) => {
      const section = document.createElement("section");
      section.className = "extra-curriculum-group";

      const title = document.createElement("div");
      title.className = "extra-curriculum-group-header";

      const titleText = document.createElement("div");
      titleText.className = "extra-curriculum-group-title";
      titleText.textContent = `${selectedPlan.studyPlan.semester} - ${selectedPlan.studyPlan.name}`;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "extra-curriculum-group-remove";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => this.data.onRemoveStudyPlan(selectedPlan.key));

      const courses = document.createElement("div");
      courses.className = "extra-curriculum-courses";

      selectedPlan.studyPlan.courses.forEach((course) => {
        const courseId = `${selectedPlan.key}|${course.abbreviation}|${course.name}`;
        const courseElement = document.createElement("article");
        courseElement.className = "extra-curriculum-course";
        const isSelected = selectedExtraIds.has(courseId);
        if (isSelected) {
          courseElement.classList.add("selected");
        }
        if (!selectedPlan.enabled) {
          courseElement.classList.add("disabled");
        }

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.className = "extra-curriculum-course-toggle";
        toggle.checked = isSelected;
        toggle.disabled = !selectedPlan.enabled;
        toggle.addEventListener("click", (event) => event.stopPropagation());
        toggle.addEventListener("change", () => this.data.onToggleExtraCourse(courseId));

        courseElement.addEventListener("click", (event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".extra-curriculum-course-content") || target.closest(".extra-curriculum-course-toggle")) {
            return;
          }

          event.stopPropagation();
          if (!toggle.disabled) {
            this.data.onToggleExtraCourse(courseId);
          }
        });

        const content = document.createElement("button");
        content.type = "button";
        content.className = "extra-curriculum-course-content";
        content.disabled = !selectedPlan.enabled;

        const linkToCourse = course.linkToCourse.trim();
        if (linkToCourse.length > 0) {
          content.addEventListener("click", () => {
            this.openCourseModal(linkToCourse, `${course.abbreviation} - ${course.name}`);
          });
        }

        const header = document.createElement("div");
        header.className = "extra-curriculum-course-header";

        const abbreviation = document.createElement("span");
        abbreviation.className = "extra-curriculum-course-abbreviation";
        abbreviation.textContent = course.abbreviation;

        const credits = document.createElement("span");
        credits.className = "extra-curriculum-course-credits";
        credits.textContent = `${course.credits} ECTS`;

        const name = document.createElement("div");
        name.className = "extra-curriculum-course-name";
        name.textContent = course.name;

        header.appendChild(abbreviation);
        header.appendChild(credits);
        content.appendChild(header);
        content.appendChild(name);

        courseElement.appendChild(toggle);
        courseElement.appendChild(content);
        courses.appendChild(courseElement);
      });

      title.appendChild(titleText);
      title.appendChild(removeButton);
      section.appendChild(title);
      section.appendChild(courses);
      groupedByStudyPlan.appendChild(section);
    });

    wrapper.appendChild(groupedByStudyPlan);
    return wrapper;
  }

  private createPlaceholderContent(text: string): HTMLElement {
    const placeholder = document.createElement("div");
    placeholder.className = "curriculum-placeholder";
    placeholder.textContent = text;
    return placeholder;
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


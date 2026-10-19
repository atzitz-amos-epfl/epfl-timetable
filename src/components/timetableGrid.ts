import type { TimetableLayoutConfig } from "../config/timetableConfig";
import type { Period } from "../domain/timetableModel";

/** Formats a duration in hours without trailing zeros (e.g. 4.5, 12, 2.25). */
export const formatHours = (hours: number): string => `${Number(hours.toFixed(2))}`;

export class TimetableGrid {
  private static readonly GRID_OFFSETS = {
    dayColumnStart: 2,
    periodRowStart: 2,
  };

  private gridElement: HTMLElement | null = null;

  public constructor(
      private readonly days: readonly string[],
      private readonly periods: Period[],
      private readonly layout: TimetableLayoutConfig,
      private readonly dayLoadsHours: readonly number[] = [],
  ) {}

  public render(): HTMLElement {
    const grid = document.createElement("section");
    grid.className = "timetable";
    this.applyLayoutVariables(grid);

    const topLeft = document.createElement("div");
    topLeft.className = "cell header";
    topLeft.style.gridColumn = "1";
    topLeft.style.gridRow = "1";
    topLeft.textContent = "Time";
    grid.appendChild(topLeft);

    this.days.forEach((day, dayIndex) => {
      const dayHeader = document.createElement("div");
      dayHeader.className = "cell header day-header";
      dayHeader.style.gridColumn = this.getGridColumn(dayIndex);
      dayHeader.style.gridRow = "1";

      const dayName = document.createElement("span");
      dayName.className = "day-name";
      dayName.textContent = day;
      dayHeader.appendChild(dayName);

      const load = this.dayLoadsHours[dayIndex] ?? 0;
      if (load > 0) {
        const dayLoad = document.createElement("span");
        dayLoad.className = "day-load";
        dayLoad.textContent = `${formatHours(load)} h`;
        dayHeader.appendChild(dayLoad);
      }

      grid.appendChild(dayHeader);
    });

    this.periods.forEach((period) => {
      const rowIndex = this.getGridRowStart(period.index);
      const timeLabel = document.createElement("div");
      timeLabel.className = "cell time-cell";
      timeLabel.style.gridColumn = "1";
      timeLabel.style.gridRow = `${rowIndex}`;

      const start = document.createElement("span");
      start.className = "time-start";
      start.textContent = period.startLabel;

      const end = document.createElement("span");
      end.className = "time-end";
      end.textContent = period.endLabel;

      timeLabel.appendChild(start);
      timeLabel.appendChild(end);
      grid.appendChild(timeLabel);

      this.days.forEach((_, dayIndex) => {
        const slot = document.createElement("div");
        slot.className = "cell";
        slot.style.gridColumn = this.getGridColumn(dayIndex);
        slot.style.gridRow = `${rowIndex}`;
        grid.appendChild(slot);
      });
    });

    this.gridElement = grid;
    return grid;
  }

  public appendLectureBlock(lectureBlock: HTMLElement): void {
    this.getGridElement().appendChild(lectureBlock);
  }

  public getGridColumn(dayIndex: number): string {
    return `${dayIndex + TimetableGrid.GRID_OFFSETS.dayColumnStart}`;
  }

  public getGridRowStart(periodIndex: number): number {
    return periodIndex + TimetableGrid.GRID_OFFSETS.periodRowStart;
  }

  private getGridElement(): HTMLElement {
    if (!this.gridElement) {
      throw new Error("TimetableGrid must be rendered before lecture blocks can be appended.");
    }

    return this.gridElement;
  }

  private applyLayoutVariables(grid: HTMLElement): void {
    grid.style.setProperty("--day-count", `${this.days.length}`);
    grid.style.setProperty("--period-count", `${this.periods.length}`);
    grid.style.setProperty("--time-column-width", `${this.layout.timeColumnWidthPx}px`);
    grid.style.setProperty("--day-column-min-width", `${this.layout.dayColumnMinWidthPx}px`);
    grid.style.setProperty("--header-row-height", `${this.layout.headerRowHeightPx}px`);
    grid.style.setProperty("--period-row-height", `${this.layout.periodRowHeightPx}px`);
  }
}
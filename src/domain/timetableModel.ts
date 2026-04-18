import type { TimetableConfig } from "../config/timetableConfig";
import type { Lecture, PlannedLecture } from "../types";

const DAY_MINUTES = 24 * 60;

export interface Period {
  index: number;
  startLabel: string;
  endLabel: string;
}

export interface LectureLayout {
  laneIndex: number;
  laneCount: number;
}

export interface ConflictRange {
  start: number;
  end: number;
}

export interface ConflictSlotBlock {
  day: number;
  start: number;
  end: number;
}

export class TimetableModel {
  public constructor(private readonly config: TimetableConfig) {}

  public getSchoolHourCount(): number {
    return Math.ceil((this.config.clock.endMinutes - this.config.clock.startMinutes) / this.getCycleMinutes());
  }

  public buildPeriods(): Period[] {
    const periods: Period[] = [];
    const schoolHourCount = this.getSchoolHourCount();

    for (let index = 0; index < schoolHourCount; index += 1) {
      const periodStart = this.config.clock.startMinutes + index * this.getCycleMinutes();
      const periodEnd = periodStart + this.config.clock.lectureDurationMinutes;

      periods.push({
        index,
        startLabel: this.formatMinutes(periodStart),
        endLabel: this.formatMinutes(periodEnd),
      });
    }

    return periods;
  }

  public clampLecture(lecture: Lecture): Lecture {
    const schoolHourCount = this.getSchoolHourCount();

    return {
      ...lecture,
      timeStart: Math.max(0, Math.min(schoolHourCount - 1, lecture.timeStart)),
      timeEnd: Math.max(1, Math.min(schoolHourCount, lecture.timeEnd)),
    };
  }

  public lectureSpan(lecture: Lecture): number {
    const safeLecture = this.clampLecture(lecture);
    return Math.max(1, safeLecture.timeEnd - safeLecture.timeStart);
  }

  public detectConflicts(plannedLectures: PlannedLecture[]): Set<string> {
    const conflicts = new Set<string>();

    for (let leftIndex = 0; leftIndex < plannedLectures.length; leftIndex += 1) {
      const left = plannedLectures[leftIndex];
      const leftLecture = this.clampLecture(left.lecture);

      for (let rightIndex = leftIndex + 1; rightIndex < plannedLectures.length; rightIndex += 1) {
        const right = plannedLectures[rightIndex];
        const rightLecture = this.clampLecture(right.lecture);

        if (leftLecture.day !== rightLecture.day) {
          continue;
        }

        const sameCourseAndType =
          leftLecture.course.abbreviation === rightLecture.course.abbreviation &&
          leftLecture.type === rightLecture.type &&
          leftLecture.day === rightLecture.day &&
          leftLecture.timeStart === rightLecture.timeStart &&
          leftLecture.timeEnd === rightLecture.timeEnd;

        if (sameCourseAndType) {
          continue;
        }

        const overlap = leftLecture.timeStart < rightLecture.timeEnd && rightLecture.timeStart < leftLecture.timeEnd;

        if (overlap) {
          conflicts.add(left.id);
          conflicts.add(right.id);
        }
      }
    }

    return conflicts;
  }

  public buildConflictRanges(plannedLectures: PlannedLecture[]): Map<string, ConflictRange[]> {
    const rangesByLectureId = new Map<string, ConflictRange[]>();

    for (let leftIndex = 0; leftIndex < plannedLectures.length; leftIndex += 1) {
      const left = plannedLectures[leftIndex];
      const leftLecture = this.clampLecture(left.lecture);

      for (let rightIndex = leftIndex + 1; rightIndex < plannedLectures.length; rightIndex += 1) {
        const right = plannedLectures[rightIndex];
        const rightLecture = this.clampLecture(right.lecture);

        if (leftLecture.day !== rightLecture.day) {
          continue;
        }

        const sameLecture =
          leftLecture.course.abbreviation === rightLecture.course.abbreviation &&
          leftLecture.type === rightLecture.type &&
          leftLecture.day === rightLecture.day &&
          leftLecture.timeStart === rightLecture.timeStart &&
          leftLecture.timeEnd === rightLecture.timeEnd;

        if (sameLecture) {
          continue;
        }

        const overlapStart = Math.max(leftLecture.timeStart, rightLecture.timeStart);
        const overlapEnd = Math.min(leftLecture.timeEnd, rightLecture.timeEnd);

        if (overlapStart >= overlapEnd) {
          continue;
        }

        this.addConflictRange(rangesByLectureId, left.id, { start: overlapStart, end: overlapEnd });
        this.addConflictRange(rangesByLectureId, right.id, { start: overlapStart, end: overlapEnd });
      }
    }

    rangesByLectureId.forEach((ranges, lectureId) => {
      rangesByLectureId.set(lectureId, this.mergeConflictRanges(ranges));
    });

    return rangesByLectureId;
  }

  public buildConflictSlotBlocks(plannedLectures: PlannedLecture[]): ConflictSlotBlock[] {
    const rangesByDay = new Map<number, ConflictRange[]>();

    for (let leftIndex = 0; leftIndex < plannedLectures.length; leftIndex += 1) {
      const left = plannedLectures[leftIndex];
      const leftLecture = this.clampLecture(left.lecture);

      for (let rightIndex = leftIndex + 1; rightIndex < plannedLectures.length; rightIndex += 1) {
        const right = plannedLectures[rightIndex];
        const rightLecture = this.clampLecture(right.lecture);

        if (leftLecture.day !== rightLecture.day) {
          continue;
        }

        const sameLecture =
          leftLecture.course.abbreviation === rightLecture.course.abbreviation &&
          leftLecture.type === rightLecture.type &&
          leftLecture.day === rightLecture.day &&
          leftLecture.timeStart === rightLecture.timeStart &&
          leftLecture.timeEnd === rightLecture.timeEnd;

        if (sameLecture) {
          continue;
        }

        const overlapStart = Math.max(leftLecture.timeStart, rightLecture.timeStart);
        const overlapEnd = Math.min(leftLecture.timeEnd, rightLecture.timeEnd);

        if (overlapStart >= overlapEnd) {
          continue;
        }

        const dayRanges = rangesByDay.get(leftLecture.day) ?? [];
        dayRanges.push({ start: overlapStart, end: overlapEnd });
        rangesByDay.set(leftLecture.day, dayRanges);
      }
    }

    const blocks: ConflictSlotBlock[] = [];

    rangesByDay.forEach((ranges, day) => {
      this.mergeConflictRanges(ranges).forEach((range) => {
        blocks.push({ day, start: range.start, end: range.end });
      });
    });

    return blocks;
  }

  public buildLectureLayouts(plannedLectures: PlannedLecture[]): Map<string, LectureLayout> {
    const layouts = new Map<string, LectureLayout>();
    const byDay = new Map<number, PlannedLecture[]>();

    plannedLectures.forEach((plannedLecture) => {
      const day = this.clampLecture(plannedLecture.lecture).day;
      const dayLectures = byDay.get(day) ?? [];
      dayLectures.push(plannedLecture);
      byDay.set(day, dayLectures);
    });

    byDay.forEach((dayLectures) => {
      const sorted = [...dayLectures].sort((left, right) => {
        const leftLecture = this.clampLecture(left.lecture);
        const rightLecture = this.clampLecture(right.lecture);

        if (leftLecture.timeStart !== rightLecture.timeStart) {
          return leftLecture.timeStart - rightLecture.timeStart;
        }

        return leftLecture.timeEnd - rightLecture.timeEnd;
      });

      const groups: PlannedLecture[][] = [];
      let currentGroup: PlannedLecture[] = [];
      let currentGroupEnd = -1;

      sorted.forEach((plannedLecture) => {
        const lecture = this.clampLecture(plannedLecture.lecture);

        if (currentGroup.length === 0 || lecture.timeStart < currentGroupEnd) {
          currentGroup.push(plannedLecture);
          currentGroupEnd = Math.max(currentGroupEnd, lecture.timeEnd);
          return;
        }

        groups.push(currentGroup);
        currentGroup = [plannedLecture];
        currentGroupEnd = lecture.timeEnd;
      });

      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }

      groups.forEach((group) => {
        const laneEndByIndex: number[] = [];
        const laneByLectureId = new Map<string, number>();

        group.forEach((plannedLecture) => {
          const lecture = this.clampLecture(plannedLecture.lecture);
          let laneIndex = laneEndByIndex.findIndex((laneEnd) => laneEnd <= lecture.timeStart);

          if (laneIndex === -1) {
            laneEndByIndex.push(lecture.timeEnd);
            laneIndex = laneEndByIndex.length - 1;
          } else {
            laneEndByIndex[laneIndex] = lecture.timeEnd;
          }

          laneByLectureId.set(plannedLecture.id, laneIndex);
        });

        const laneCount = Math.max(1, laneEndByIndex.length);

        group.forEach((plannedLecture) => {
          layouts.set(plannedLecture.id, {
            laneIndex: laneByLectureId.get(plannedLecture.id) ?? 0,
            laneCount,
          });
        });
      });
    });

    return layouts;
  }

  private getCycleMinutes(): number {
    return this.config.clock.lectureDurationMinutes + this.config.clock.breakDurationMinutes;
  }

  private addConflictRange(
    rangesByLectureId: Map<string, ConflictRange[]>,
    lectureId: string,
    range: ConflictRange,
  ): void {
    const existingRanges = rangesByLectureId.get(lectureId) ?? [];
    existingRanges.push(range);
    rangesByLectureId.set(lectureId, existingRanges);
  }

  private mergeConflictRanges(ranges: ConflictRange[]): ConflictRange[] {
    if (ranges.length <= 1) {
      return ranges;
    }

    const sorted = [...ranges].sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      return left.end - right.end;
    });

    const merged: ConflictRange[] = [sorted[0]];

    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index];
      const previous = merged[merged.length - 1];

      if (current.start <= previous.end) {
        previous.end = Math.max(previous.end, current.end);
        continue;
      }

      merged.push({ ...current });
    }

    return merged;
  }

  private formatMinutes(totalMinutes: number): string {
    const safeMinutes = ((totalMinutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const hours = Math.floor(safeMinutes / 60)
      .toString()
      .padStart(2, "0");
    const minutes = (safeMinutes % 60).toString().padStart(2, "0");

    return `${hours}:${minutes}`;
  }
}


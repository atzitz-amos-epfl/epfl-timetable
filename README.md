# Studies Planner

Native TypeScript + Vite app for planning a university curriculum. The first widget is a weekly timetable (Monday-Friday).

## Timetable model

```ts
interface Course {
  abbreviation: string;
  name: string;
  teacher: string;
  credits: number;
  group: string;
  isOptional: boolean; // true when group === 'Groupe "Options"'
  linkToCourse: string;
  lectures: Lecture[];
}

interface Lecture {
  course: Course;
  type: "exercise" | "course" | "lab";
  day: 0 | 1 | 2 | 3 | 4; // Monday-Friday
  timeStart: SchoolHour;
  timeEnd: SchoolHour;
}

interface StudyPlan {
  name: string;
  semester: "BA1" | "BA2" | "BA3" | "BA4" | "BA5" | "BA6";
  courses: Course[];
}
```

`SchoolHour` is the slot index where:
- `0` = `08:15-09:00`
- `1` = `09:15-10:00`
- ...
- `10` = `18:15-19:00`

`timeEnd` is exclusive, so a lecture with `timeStart: 2` and `timeEnd: 4` fills two periods.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Study plan selection and conflicts

- Use the dropdown to add study plans as chips.
- The timetable starts empty until at least one study plan is added.
- Click a chip to toggle it enabled/disabled for timetable rendering.
- Hover a chip to show `x`, then click `x` to remove that plan from selection.
- Plan colors are assigned by the order in which plans are added.
- Each lecture card shows its plan (`semester + name`) and uses the same add-order color bar as its chip.
- Identical lectures (same course, type, day, and timeslot) across plans are merged into one card.
- Overlapping lectures from enabled plans are shown side by side, and only the actually overlapping slots get a dashed red striped conflict overlay.

## Where to edit data

Sample data lives in `src/sampleData.ts` and exports `sampleStudyPlans` (`StudyPlan[]`).


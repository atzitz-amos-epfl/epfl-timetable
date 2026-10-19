# EPFL data scraper

`scraper.py` reads the study plans on [edu.epfl.ch](https://edu.epfl.ch/studyplan/fr/) and writes
`epfl_data.json`, which the web app bundles.

```bash
py -3 scraper.py                              # full scrape (about an hour: one polite request every ~2 s)
py -3 scraper.py --cache-dir .cache           # keep downloaded pages; re-runs only parse
py -3 scraper.py --only informatique physique # re-scrape some programmes, keep the rest
```

Needs `requests` and `beautifulsoup4`.

## What it does

1. Lists every programme from the propédeutique, bachelor and master index pages.
2. Reads each programme's study plan: groups, courses, the semester column a course is taught in,
   credits, language and teachers. Propédeutique, bachelor and master pages of a programme are merged
   into one plan (BA1 to MA4) with the id the app uses (`info`, `GC`, `data-science`...).
3. Fetches each course's coursebook page **once** (courses are shared between plans) for its weekly
   timetable and prerequisites.
4. Builds the SHS choices (see below).

The coursebook only publishes the timetable of the semester being taught. When a page has none (spring
courses during the autumn), the timetable from the previous output is kept and the course is marked
`"timetable": "previous"`; the app tags it "old timetable".

## SHS

Main study plans don't list SHS courses, only one placeholder per semester:

| Semester | Placeholder in the main plan          | Courses come from                                    |
|----------|---------------------------------------|------------------------------------------------------|
| BA2      | Durabilité : Propédeutique BA2        | propédeutique SHS programme                          |
| BA3      | SHS + MGT : Cycle Bachelor BA3        | bachelor SHS programme, "Enjeux mondiaux"            |
| BA4–BA6  | SHS + MGT : Cycle Bachelor BA4 … BA6  | bachelor SHS programme, "Cours SHS" + "Cours MGT"    |
| MA1      | SHS : Introduction au projet          | master SHS programme, same-named block               |
| MA2      | SHS : Projet                          | master SHS programme, same-named block               |

Students register for exactly one of them per semester, so each placeholder becomes a **choice**
(`SHS-BA4`, ...): the plan references the choice, and the app shows it as one card where you pick the course,
like the sections of Analyse I. The SHS programme is also written as its own plan (`SHS`) so its courses can
be searched and loaded like any other.

## `epfl_data.json` (schemaVersion 2)

```jsonc
{
  "schemaVersion": 2,
  "scrapedAt": "2026-10-09T12:00:00+00:00",
  "courses": {                       // every course once, by code ("slug:..." when it has none)
    "CS-200": {
      "code": "CS-200", "name": "Computer architecture", "section": "IN",
      "teachers": ["Ienne"], "language": "EN", "credits": 8,
      "link": "https://edu.epfl.ch/.../coursebook/computer-architecture-CS-200",
      "prerequisites": "",
      "lectures": [{ "type": "course", "day": 2, "start": 2, "end": 4, "rooms": ["SG1 138"] }],
      "timetable": "current"         // "current" | "previous" (carried over) | "none"
    }
  },
  "choices": {                       // "take one of these" slots
    "SHS-BA4": { "label": "SHS + MGT : Cycle Bachelor BA4", "semester": "BA4", "credits": 2, "options": ["HUM-...", "MGT-203"] }
  },
  "plans": {
    "info": {
      "id": "info", "title": "Informatique",
      "sources": [{ "domain": "bachelor", "slug": "informatique", "title": "Informatique" }],
      "semesters": {
        "BA3": [
          { "course": "CS-200", "group": "Bloc B", "optional": false },
          { "choice": "SHS-BA3", "group": "Bloc transversal SHS", "optional": false, "credits": 2 }
        ]
      }
    }
  }
}
```

`day` is 0 (Monday) to 4; `start`/`end` are timetable periods, 0 = 08:15. A plan entry can override a
course's `name` or `credits` when one plan lists it differently. `optional` is inferred from the group title
(the study plans don't flag it) — see `OPTIONAL_GROUP` in `scraper.py`.

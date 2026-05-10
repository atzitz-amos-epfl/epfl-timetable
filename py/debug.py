s = """[
  {
    "name": "Algèbre linéaire avancée I - espaces vectoriels",
    "lectures": [
      { "type": "course", "day": 1, "timeStart": 0, "timeEnd": 2 },
      { "type": "course", "day": 0, "timeStart": 5, "timeEnd": 7 },
      { "type": "exercise", "day": 0, "timeStart": 7, "timeEnd": 8 },
      { "type": "exercise", "day": 3, "timeStart": 7, "timeEnd": 9 },
      { "type": "exercise", "day": 0, "timeStart": 8, "timeEnd": 9 }
    ]
  },
  {
    "name": "Algèbre I - structures fondamentales",
    "lectures": [
      { "type": "course", "day": 1, "timeStart": 2, "timeEnd": 4 },
      { "type": "exercise", "day": 0, "timeStart": 8, "timeEnd": 9 }
    ]
  },
  {
    "name": "Analyse avancée I - analyse réelle",
    "lectures": [
      { "type": "course", "day": 0, "timeStart": 2, "timeEnd": 4 },
      { "type": "course", "day": 2, "timeStart": 5, "timeEnd": 7 },
      { "type": "exercise", "day": 1, "timeStart": 6, "timeEnd": 8 },
      { "type": "exercise", "day": 3, "timeStart": 5, "timeEnd": 7 }
    ]
  },
  {
    "name": "Physique générale : mécanique",
    "lectures": [
      { "type": "course", "day": 2, "timeStart": 1, "timeEnd": 4 },
      { "type": "course", "day": 2, "timeStart": 7, "timeEnd": 8 },
      { "type": "exercise", "day": 4, "timeStart": 2, "timeEnd": 4 }
    ]
  },
  {
    "name": "Information, calcul, communication",
    "lectures": [
      { "type": "course", "day": 3, "timeStart": 1, "timeEnd": 2 },
      { "type": "exercise", "day": 3, "timeStart": 2, "timeEnd": 4 },
      { "type": "course", "day": 4, "timeStart": 5, "timeEnd": 7 },
      { "type": "exercise", "day": 4, "timeStart": 7, "timeEnd": 8 }
    ]
  }
]"""

import json
import sys


def merge(data_file: str, patch: str):
    with open(data_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    for p in json.loads(patch):
        name = p["name"]
        new_lectures = p["lectures"]

        updated = 0
        for entry in data:
            for course in entry.get("courses", []):
                if course.get("courseName") == name:
                    course["lectures"] = new_lectures
                    updated += 1

        if updated == 0:
            print(f"⚠️  No course found with abbreviation '{name}'")
            sys.exit(1)
        print(f"✅ Updated lectures for '{name}' in {updated} occurrence(s) → {data_file}")

    with open(data_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    merge("epfl_courses.json", s)

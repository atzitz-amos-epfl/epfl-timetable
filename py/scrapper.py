import requests
from bs4 import BeautifulSoup
import json
import re
import time
import random

BASE_URL = "https://edu.epfl.ch"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

DOMAIN_SEMESTERS = {
    "propedeutique": ["BA1", "BA2"],
    "bachelor":      ["BA3", "BA4", "BA5", "BA6"],
}

TARGETS = [
    ("propedeutique", "informatique"),
    ("propedeutique", "mathematiques"),
    ("bachelor",      "informatique"),
    ("bachelor",      "mathematiques"),
]

SHORT_NAME = {
    "informatique":  "info",
    "mathematiques": "math",
}

CLASS_TO_TYPE = {
    "cours":    "course",
    "exercice": "exercise",
    "projet":   "lab",
}


def cooldown():
    time.sleep(random.uniform(1.0, 2.5))


def scrape_timetable(url: str) -> list[dict]:
    cooldown()
    response = requests.get(url, headers=HEADERS)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    table = soup.select_one("table.semaineDeRef")
    if not table:
        return []

    lectures = []
    rows = table.find_all("tr")
    occupied = {}

    for row_idx, tr in enumerate(rows[1:]):  # row 0 is header
        tds = iter(tr.find_all("td"))
        col_idx = 0

        for td in tds:
            # Skip columns occupied by a rowspan from above
            while occupied.get((row_idx, col_idx)):
                col_idx += 1

            # col 0 is the time label
            if col_idx == 0:
                col_idx += 1
                continue

            day = col_idx - 1  # 0=Mon ... 4=Fri
            rowspan = int(td.get("rowspan", 1))
            css_classes = td.get("class", [])

            # Mark future rows as occupied for this column
            for r in range(1, rowspan):
                occupied[(row_idx + r, col_idx)] = True

            lecture_type = None
            for cls in css_classes:
                if cls in CLASS_TO_TYPE:
                    lecture_type = CLASS_TO_TYPE[cls]
                    break

            if lecture_type:
                lectures.append({
                    "type": lecture_type,
                    "day": day,
                    "timeStart": row_idx,
                    "timeEnd": row_idx + rowspan - 1,
                })

            col_idx += 1

    return lectures


def scrape_page(domain: str, name: str) -> dict:
    url = f"{BASE_URL}/studyplan/fr/{domain}/{name}/"
    cooldown()
    response = requests.get(url, headers=HEADERS)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    semesters = DOMAIN_SEMESTERS[domain]
    courses_by_semester = {s: [] for s in semesters}

    for study_plan in soup.find_all("div", class_="study-plan"):
        h4 = study_plan.find("h4")
        group = h4.get_text(strip=True) if h4 else "Unknown"

        for line in study_plan.find_all("div", class_="line"):
            link_tag = line.find("a", href=lambda h: h and "/coursebook/" in h)
            if not link_tag:
                continue

            course_name = link_tag.get_text(strip=True)
            href = link_tag["href"]
            full_link = BASE_URL + href if href.startswith("/") else href

            # Abbreviation
            cours_div = line.find("div", class_="cours")
            full_text = cours_div.get_text(separator="\n", strip=True) if cours_div else ""
            abbr_match = re.search(r"([A-Z]{2,}-\d{3}[\w\(\)]*)", full_text)
            abbreviation = abbr_match.group(1) if abbr_match else ""

            # Teacher
            teacher_tag = line.find("a", href=lambda h: h and "people.epfl.ch" in h)
            teacher = teacher_tag.get_text(strip=True) if teacher_tag else "Divers enseignants"

            # Credits
            credit_div = line.find("div", class_="credit")
            credits_match = re.search(r"\d+", credit_div.get_text(strip=True)) if credit_div else None
            credits = int(credits_match.group()) if credits_match else None

            # Semester
            bachelor_divs = line.find_all("div", class_="bachlor")
            semester = None
            for i, div in enumerate(bachelor_divs):
                text = div.get_text(strip=True)
                if text and text != "-":
                    if i < len(semesters):
                        semester = semesters[i]
                    break

            if semester is None:
                continue

            # Timetable
            print(f"    Fetching timetable: {abbreviation}...")
            lectures = scrape_timetable(full_link)

            courses_by_semester[semester].append({
                "courseName": course_name,
                "courseAbbreviation": abbreviation,
                "teacher": teacher,
                "credits": credits,
                "group": group,
                "lectures": lectures,
                "linkToCourse": full_link,
            })

    return courses_by_semester


if __name__ == "__main__":
    output = []

    for domain, name in TARGETS:
        print(f"\nScraping {domain}/{name}...")
        try:
            courses_by_semester = scrape_page(domain, name)
            for semester, courses in courses_by_semester.items():
                output.append({
                    "semester": semester.lower(),
                    "name": SHORT_NAME[name],
                    "courses": courses,
                })
                print(f"  {semester}: {len(courses)} courses")
        except Exception as e:
            print(f"  ❌ Failed: {e}")

    output_file = "epfl_courses.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total = sum(len(e["courses"]) for e in output)
    print(f"\n✅ Scraped {total} courses across {len(output)} semester/program entries → {output_file}")
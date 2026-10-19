"""Scrape EPFL study plans (edu.epfl.ch) into epfl_data.json for the studies planner.

What it collects
  * Every programme listed on the propédeutique / bachelor / master index pages.
  * Each course once (by code), with its timetable from the coursebook page.
  * SHS: main plans only contain a placeholder per semester ("SHS + MGT : Cycle Bachelor BA4",
    "SHS : Introduction au projet", ...). The actual courses come from the SHS programme pages.
    Each placeholder becomes a "choice": the student takes exactly one of its courses.

Timetables
  The coursebook only shows the timetable of the semester being taught (autumn now). When a page
  has no timetable, the one from the previous output is kept and the course is flagged
  "timetable": "previous" so the app can say so.

Usage (from the py/ directory)
  py -3 scraper.py                              # full scrape, writes epfl_data.json
  py -3 scraper.py --only informatique physique # just these programme slugs (others kept from previous output)
  py -3 scraper.py --cache-dir .cache           # reuse downloaded pages (handy when iterating)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Tag

BASE_URL = "https://edu.epfl.ch"
STUDY_PLAN_URL = BASE_URL + "/studyplan/fr/{domain}/"
DOMAINS = ("propedeutique", "bachelor", "master")
SHS_SLUG = "programme-sciences-humaines-et-sociales"
# Listed on the index pages but not degree programmes.
SKIPPED_SLUGS = {"mise-a-niveau", "projeter-ensemble-enac"}

OUTPUT_FILE = Path(__file__).with_name("epfl_data.json")
# Output of the previous scraper; only read to carry over timetables.
LEGACY_FILE = Path(__file__).with_name("epfl_courses.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

# Plan ids used by the app (and in users' saved selections). Programmes not listed here use their slug.
PLAN_IDS = {
    "informatique": "info",
    "mathematiques": "math",
    "chimie-et-genie-chimique": "chimie",
    "genie-civil": "GC",
    "genie-mecanique": "GM",
    "genie-electrique-et-electronique": "GE",
    "ingenierie-des-sciences-du-vivant": "SV",
    "microtechnique": "MT",
    "physique": "phys",
    "science-et-genie-des-materiaux": "SGM",
    "systemes-de-communication": "syscom",
    SHS_SLUG: "SHS",
}

# Column titles on study plan pages ("Bachelor 3", "Master 1") -> semester.
COLUMN_SEMESTER = re.compile(r"^(Bachelor|Master)\s+(\d)$")
# Coursebook timetable cell classes -> lecture type.
CELL_TYPES = {"cours": "course", "exercice": "exercise", "projet": "lab"}
COURSE_CODE = re.compile(r"([A-Z]{2,}(?:-[A-Z]+)?-\d{3}[\w()]*)")

# The study plans don't flag optional courses; infer it from the group title
# ('Groupe "Options"', 'Bloc 4 : Electives', 'Domaine "..."', 'Liste 2 - autres bachelor', ...).
OPTIONAL_GROUP = re.compile(r"option|elective|à choix|mineur|minor|domaine|liste \d|physique/bio|branches de semestre", re.I)


# --------------------------------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------------------------------

class Http:
    """Polite GET with retries and an optional on-disk cache."""

    def __init__(self, cache_dir: Path | None, min_delay: float = 1.0, max_delay: float = 2.5) -> None:
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.cache_dir = cache_dir
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.requests = 0
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def get(self, url: str) -> str:
        cached = self._cache_path(url)
        if cached and cached.exists():
            return cached.read_text(encoding="utf-8")

        for attempt in range(4):
            time.sleep(random.uniform(self.min_delay, self.max_delay))
            try:
                response = self.session.get(url, timeout=30)
            except requests.RequestException as error:
                print(f"    ! {error} (attempt {attempt + 1})")
                continue
            self.requests += 1
            if response.status_code in (429, 500, 502, 503, 504):
                time.sleep(5 * (attempt + 1))
                continue
            response.raise_for_status()
            if cached:
                cached.write_text(response.text, encoding="utf-8")
            return response.text

        raise RuntimeError(f"giving up on {url}")

    def _cache_path(self, url: str) -> Path | None:
        if not self.cache_dir:
            return None
        return self.cache_dir / (hashlib.sha1(url.encode()).hexdigest() + ".html")


# --------------------------------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------------------------------

@dataclass
class PlanLine:
    """One row of a study plan table."""

    group: str
    title: str
    code: str
    section: str
    teachers: list[str]
    language: str
    credits: float | None
    semester: str | None
    coursebook_url: str | None

    @property
    def is_shs_placeholder(self) -> bool:
        return self.coursebook_url is None and self.section == "SHS"


def text_of(element: Tag | None) -> str:
    return element.get_text(" ", strip=True) if element else ""


def parse_credits(text: str) -> float | None:
    match = re.search(r"\d+(?:[.,]\d+)?", text)
    if not match:
        return None
    value = float(match.group().replace(",", "."))
    return int(value) if value.is_integer() else value


def column_semester(title: str | None) -> str | None:
    match = COLUMN_SEMESTER.match((title or "").strip())
    if not match:
        return None
    return ("BA" if match.group(1) == "Bachelor" else "MA") + match.group(2)


def discover_programmes(http: Http) -> list[tuple[str, str, str]]:
    """(domain, slug, title) of every programme on the index pages."""
    programmes = []
    for domain in DOMAINS:
        soup = BeautifulSoup(http.get(STUDY_PLAN_URL.format(domain=domain)), "html.parser")
        seen = set()
        for link in (soup.find("main") or soup).find_all("a", href=True):
            match = re.fullmatch(rf"/studyplan/fr/{domain}/([a-z0-9-]+)/", link["href"])
            if match and match.group(1) not in seen and match.group(1) not in SKIPPED_SLUGS:
                seen.add(match.group(1))
                programmes.append((domain, match.group(1), text_of(link)))
    return programmes


def parse_study_plan(html: str) -> list[PlanLine]:
    soup = BeautifulSoup(html, "html.parser")
    lines = []
    for block in soup.find_all("div", class_="study-plan"):
        group = text_of(block.find("h4")).replace("\xa0", " ")
        for line in block.find_all("div", class_="line"):
            name = line.find("div", class_="cours-name")
            link = name.find("a", href=lambda href: href and "/coursebook/" in href) if name else None
            title = text_of(link) if link else text_of(name)
            # The <i> after the link is a note ("Une seule inscription..."); keep only the course title.
            info = text_of(line.find("div", class_="cours-info"))
            code_match = COURSE_CODE.search(info)
            section_match = re.search(r"Section\s+(\S+)", info)
            teachers = [text_of(a) for a in line.select(".enseignement-name a")] or \
                [t for t in [text_of(line.find("div", class_="enseignement-name"))] if t]

            # The semester is the column that has a schedule; plan pages title their columns.
            semester = None
            for column in line.find_all("div", class_="bachlor"):
                if column.find("div", class_="no-course") is None and column.get_text(strip=True) not in ("", "-"):
                    semester = column_semester(column.get("data-title"))
                    if semester:
                        break

            href = link["href"] if link else None
            lines.append(PlanLine(
                group=group,
                title=title,
                code=code_match.group(1) if code_match else "",
                section=section_match.group(1) if section_match else "",
                teachers=teachers,
                language=text_of(line.select_one(".langue abbr")),
                credits=parse_credits(text_of(line.find("div", class_="credit"))),
                semester=semester,
                coursebook_url=(BASE_URL + href if href.startswith("/") else href) if href else None,
            ))
    return lines


def parse_course_page(html: str) -> tuple[list[dict], str]:
    """Weekly timetable and learning prerequisites of a coursebook page."""
    soup = BeautifulSoup(html, "html.parser")
    lectures = []

    table = soup.select_one("table.semaineDeRef")
    if table:
        # Rowspans hide cells of the rows below them; track which (row, column) slots are already taken.
        occupied: set[tuple[int, int]] = set()
        for row, tr in enumerate(table.find_all("tr")[1:]):
            column = 0
            for td in tr.find_all("td"):
                while (row, column) in occupied:
                    column += 1
                if column == 0:  # time label
                    column += 1
                    continue

                span = int(td.get("rowspan", 1))
                for offset in range(1, span):
                    occupied.add((row + offset, column))

                lecture_type = next((CELL_TYPES[c] for c in td.get("class", []) if c in CELL_TYPES), None)
                if lecture_type:
                    lectures.append({
                        "type": lecture_type,
                        "day": column - 1,
                        "start": row,
                        "end": row + span,
                        "rooms": sorted({text_of(a) for a in td.find_all("a") if text_of(a)}),
                    })
                column += 1

    prerequisites = ""
    for section in soup.find_all("div", class_="mt-5"):
        heading = section.find("h2")
        if heading and "Learning Prerequisites" in heading.get_text():
            required = section.find("h2", class_="h6")
            if required:
                texts = []
                for sibling in required.next_siblings:
                    if getattr(sibling, "name", None) == "h2":
                        break
                    if getattr(sibling, "name", None):
                        texts.append(text_of(sibling))
                prerequisites = " ".join(t for t in texts if t)
            break

    return lectures, prerequisites


# --------------------------------------------------------------------------------------------------
# Building the dataset
# --------------------------------------------------------------------------------------------------

@dataclass
class Dataset:
    courses: dict[str, dict] = field(default_factory=dict)
    choices: dict[str, dict] = field(default_factory=dict)
    plans: dict[str, dict] = field(default_factory=dict)


def course_key(line: PlanLine) -> str:
    """Courses are shared between plans by code; the few without one fall back to their coursebook slug."""
    if line.code:
        return line.code
    slug = (line.coursebook_url or line.title).rstrip("/").rsplit("/", 1)[-1]
    return "slug:" + slug


def plan_id(domain: str, slug: str, used: dict[str, str]) -> str:
    candidate = PLAN_IDS.get(slug, slug)
    # Propédeutique and bachelor (and often master) pages of one programme share an id: BA1..MA4 in one plan.
    owner = used.setdefault(candidate, slug)
    return candidate if owner == slug else f"{slug}-{domain}"


class Scraper:
    def __init__(self, http: Http, previous: dict[str, list[dict]]) -> None:
        self.http = http
        self.previous_timetables = previous
        self.data = Dataset()
        self.course_pages_done: set[str] = set()

    def add_course(self, line: PlanLine) -> str:
        """Registers the course (fetching its coursebook page once) and returns its key."""
        key = course_key(line)
        course = self.data.courses.get(key)
        if course is None:
            course = {
                "code": line.code,
                "name": line.title,
                "section": line.section,
                "teachers": line.teachers,
                "language": line.language,
                "credits": line.credits,
                "link": line.coursebook_url or "",
                "prerequisites": "",
                "lectures": [],
                "timetable": "none",
            }
            self.data.courses[key] = course

        if line.coursebook_url and key not in self.course_pages_done:
            self.course_pages_done.add(key)
            print(f"    · {key}")
            try:
                lectures, prerequisites = parse_course_page(self.http.get(line.coursebook_url))
            except Exception as error:  # keep going: one broken page must not lose the whole run
                print(f"    ! {key}: {error}")
                lectures, prerequisites = [], ""
            course["prerequisites"] = prerequisites
            if lectures:
                course["lectures"], course["timetable"] = lectures, "current"
            elif self.previous_timetables.get(key):
                course["lectures"], course["timetable"] = self.previous_timetables[key], "previous"
        return key

    def scrape_shs(self) -> dict[str, str]:
        """Builds one choice per semester from the SHS programme pages. Returns {block title: semester}."""
        block_semesters: dict[str, str] = {}
        for domain in DOMAINS:
            print(f"\nSHS {domain}")
            lines = parse_study_plan(self.http.get(f"{STUDY_PLAN_URL.format(domain=domain)}{SHS_SLUG}/"))
            for line in lines:
                if not line.coursebook_url or not line.semester:
                    continue
                key = self.add_course(line)
                choice = self.data.choices.setdefault(f"SHS-{line.semester}", {
                    "label": f"SHS {line.semester}", "semester": line.semester, "credits": line.credits, "options": [],
                })
                if key not in choice["options"]:
                    choice["options"].append(key)
                # Master placeholders are named after their block ("SHS : Projet"), so remember each block's semester.
                block_semesters.setdefault(line.group, line.semester)
        return block_semesters

    def scrape_programme(self, domain: str, slug: str, title: str, plan: dict, block_semesters: dict[str, str]) -> None:
        print(f"\n{domain}/{slug}")
        plan.setdefault("sources", []).append({"domain": domain, "slug": slug, "title": title})
        semesters = plan.setdefault("semesters", {})

        for line in parse_study_plan(self.http.get(f"{STUDY_PLAN_URL.format(domain=domain)}{slug}/")):
            if line.is_shs_placeholder:
                semester = self.placeholder_semester(line, block_semesters)
                if not semester or f"SHS-{semester}" not in self.data.choices:
                    print(f"    ? SHS placeholder not matched: {line.title!r}")
                    continue
                choice = self.data.choices[f"SHS-{semester}"]
                choice["label"] = line.title  # e.g. "SHS + MGT : Cycle Bachelor BA4"
                semester_entries = semesters.setdefault(semester, [])
                if not any(existing.get("choice") == f"SHS-{semester}" for existing in semester_entries):
                    semester_entries.append({
                        "choice": f"SHS-{semester}",
                        "group": line.group,
                        "optional": False,
                        "credits": line.credits,
                    })
                continue

            if not line.coursebook_url or not line.semester:
                continue

            key = self.add_course(line)
            entry = {"course": key, "group": line.group, "optional": bool(OPTIONAL_GROUP.search(line.group))}
            # Rare per-plan differences (MSE-362 is "Polymer science + TP" for 5 ECTS in one plan).
            shared = self.data.courses[key]
            if line.title != shared["name"]:
                entry["name"] = line.title
            if line.credits != shared["credits"]:
                entry["credits"] = line.credits
            semester_entries = semesters.setdefault(line.semester, [])
            if not any(existing.get("course") == key for existing in semester_entries):
                semester_entries.append(entry)

    @staticmethod
    def placeholder_semester(line: PlanLine, block_semesters: dict[str, str]) -> str | None:
        match = re.search(r"\b(BA|MA)\s?(\d)\b", line.title)
        if match:
            return match.group(1) + match.group(2)
        # Some plans add a marker to the title ("SHS : Projet (.)").
        title = re.sub(r"\s*\([^)]*\)\s*$", "", line.title)
        return block_semesters.get(line.title) or block_semesters.get(title)


def load_previous_timetables() -> dict[str, list[dict]]:
    """Timetables from the last run (new format) or the old scraper output, by course key."""
    timetables: dict[str, list[dict]] = {}
    if LEGACY_FILE.exists():
        for plan in json.loads(LEGACY_FILE.read_text(encoding="utf-8")):
            for course in plan.get("courses", []):
                if course.get("courseAbbreviation") and course.get("lectures"):
                    timetables[course["courseAbbreviation"]] = [
                        {"type": l["type"], "day": l["day"], "start": l["timeStart"], "end": l["timeEnd"],
                         "rooms": sorted(set(l.get("rooms", [])))}
                        for l in course["lectures"]
                    ]
    if OUTPUT_FILE.exists():
        for key, course in json.loads(OUTPUT_FILE.read_text(encoding="utf-8")).get("courses", {}).items():
            if course.get("lectures"):
                timetables[key] = course["lectures"]
    return timetables


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="*", default=[], help="programme slugs to scrape (others are kept from the previous output)")
    parser.add_argument("--cache-dir", type=Path, help="store downloaded pages here and reuse them")
    parser.add_argument("--output", type=Path, default=OUTPUT_FILE)
    args = parser.parse_args()

    http = Http(args.cache_dir)
    scraper = Scraper(http, load_previous_timetables())
    started = time.time()

    programmes = discover_programmes(http)
    print(f"Found {len(programmes)} programmes")

    block_semesters = scraper.scrape_shs()

    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.only and args.output.exists() else None
    used_ids: dict[str, str] = {}
    for domain, slug, title in programmes:
        if slug == SHS_SLUG:
            continue
        pid = plan_id(domain, slug, used_ids)
        if args.only and slug not in args.only:
            continue
        plan = scraper.data.plans.setdefault(pid, {"id": pid, "title": title, "sources": [], "semesters": {}})
        try:
            scraper.scrape_programme(domain, slug, title, plan, block_semesters)
        except Exception as error:
            print(f"  ! {domain}/{slug} failed: {error}")

    # The SHS programme itself, so its courses can be searched and loaded like any other plan.
    # Not a degree: it can be loaded and searched, but not picked as a main study.
    shs_plan = scraper.data.plans.setdefault("SHS", {"id": "SHS", "title": "Programme Sciences humaines et sociales", "mainStudy": False, "sources": [], "semesters": {}})
    for choice in scraper.data.choices.values():
        shs_plan["semesters"].setdefault(choice["semester"], []).extend(
            {"course": key, "group": "SHS", "optional": True} for key in choice["options"]
        )

    if previous:  # --only: keep the plans and courses that were not re-scraped
        for pid, plan in previous.get("plans", {}).items():
            scraper.data.plans.setdefault(pid, plan)
        for key, course in previous.get("courses", {}).items():
            scraper.data.courses.setdefault(key, course)

    output = {
        "schemaVersion": 2,
        "scrapedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": BASE_URL,
        "courses": dict(sorted(scraper.data.courses.items())),
        "choices": dict(sorted(scraper.data.choices.items())),
        "plans": dict(sorted(scraper.data.plans.items(), key=lambda item: item[0].lower())),
    }
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=1), encoding="utf-8")

    timetables = [course["timetable"] for course in scraper.data.courses.values()]
    print(
        f"\nWrote {args.output.name}: {len(output['plans'])} plans, {len(output['courses'])} courses "
        f"({timetables.count('current')} current timetables, {timetables.count('previous')} carried over, "
        f"{timetables.count('none')} without), {len(output['choices'])} SHS choices; "
        f"{http.requests} requests in {(time.time() - started) / 60:.1f} min"
    )


if __name__ == "__main__":
    sys.exit(main())

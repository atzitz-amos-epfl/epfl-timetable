import requests
from bs4 import BeautifulSoup
import json

URL = "https://edu.epfl.ch/studyplan/fr/propedeutique/mathematiques/coursebook/algebre-lineaire-avancee-ii-diagonalisation-MATH-115-A"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"}

CLASS_TO_TYPE = {
    "cours":    "course",
    "exercice": "exercise",
    "projet":   "lab",
}


def scrape_timetable(url: str) -> list[dict]:
    response = requests.get(url, headers=HEADERS)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    table = soup.select_one("table.semaineDeRef")
    if not table:
        return []

    lectures = []
    rows = table.find_all("tr")

    # Grid to track cells already filled by a rowspan from a previous row
    # grid[row_index][col_index] = True means that cell is occupied
    occupied = {}

    # Row 0 is the header (Lu/Ma/Me/Je/Ve), skip it
    # Rows 1..13 are time slots 8-9 .. 21-22
    for row_idx, tr in enumerate(rows[1:]):  # row_idx 0 = 8h, 1 = 9h, ...
        tds = iter(tr.find_all("td"))
        col_idx = 0  # will skip col 0 (time label) and track days 0-4

        for td in tds:
            # Skip over columns already occupied by a rowspan above
            while occupied.get((row_idx, col_idx)):
                col_idx += 1

            # col 0 is the time label, cols 1-5 are Mon-Fri (days 0-4)
            if col_idx == 0:
                col_idx += 1
                continue

            day = col_idx - 1  # 0=Mon ... 4=Fri
            rowspan = int(td.get("rowspan", 1))
            css_classes = td.get("class", [])

            # Mark future rows as occupied for this column
            for r in range(1, rowspan):
                occupied[(row_idx + r, col_idx)] = True

            # Detect lecture type from CSS class
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
                    "timeEnd": row_idx + rowspan,
                })

            col_idx += 1

    return lectures


if __name__ == "__main__":
    lectures = scrape_timetable(URL)
    print(json.dumps(lectures, indent=2))
    print(f"\n✅ Found {len(lectures)} lectures")
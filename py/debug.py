import json

with open('epfl_courses.json', 'r') as f:
    data = json.load(f)

for section in data:
    for course in section.get('courses', []):
        for lecture in course.get('lectures', []):
            if 'timeEnd' in lecture:
                lecture['timeEnd'] += 1

with open('epfl_courses.json', 'w') as f:
    json.dump(data, f, indent=2)

print("Done!")
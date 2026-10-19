# My Studies

Plan your EPFL studies semester by semester and see your weekly schedule.

## Main features

- **My studies**: your current semester at a glance (today's classes, courses, credits, progress), based on the year you started.
- **Planner**: your bachelor and master by semester; move courses between semesters, pick sections and SHS courses, load courses from other plans, and see the weekly schedule with conflicts.
- **Explore**: search any study plan, course or room and see its timetable.
- **Agenda**: series, labs, exams and notes on the EPFL academic calendar, as a calendar or course by course; share a course's workload as JSON.
- Correct outdated course data by hand; everything is saved in your browser.
- **Sync** (optional): sign in with an email and a password to use the same data on your phone and other devices.

## Access

https://atzitz-amos-epfl.github.io/epfl-timetable/dist/

## Setting up sync (Supabase)

1. Create a free project on [supabase.com](https://supabase.com).
2. In the dashboard, open **SQL Editor**, paste [supabase/schema.sql](supabase/schema.sql) and run it.
3. In **Authentication > URL Configuration**, set the **Site URL** to the app's address
   (`https://atzitz-amos-epfl.github.io/epfl-timetable/dist/`) and add it to the **Redirect URLs**, so the
   confirmation and password-reset emails link back to the app.
4. Copy [.env.example](.env.example) to `.env` and fill in the project URL and the anon (publishable) key from
   **Project Settings > API**. Never use the service_role (secret) key.
5. Rebuild (`npm run build`) and push.

Without these values the app works as before, saving only in the browser.

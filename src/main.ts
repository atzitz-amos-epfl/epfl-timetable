import "./styles.css";
import { sampleStudyPlans } from "./sampleData";
import { Timetable } from "./timetable";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
    throw new Error("#app container was not found.");
}

new Timetable(sampleStudyPlans).attach(app);


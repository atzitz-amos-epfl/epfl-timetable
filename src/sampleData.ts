import { buildStudyPlans } from "./data/epflData";
import type { StudyPlan } from "./types";

export const sampleStudyPlans: StudyPlan[] = buildStudyPlans({ expandChoices: true });

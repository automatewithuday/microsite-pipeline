// Step registry: every implemented step, in one place. pipeline.ts derives
// execution order from each step's dependsOn, so this array does not need
// to be pre-sorted. New steps are added here without touching
// pipeline.ts.

import type { StepModule } from "../pipeline.js";
import person from "./01_enrichPerson.js";
import company from "./02_enrichCompany.js";
import crm from "./03_crmDetect.js";
import traffic from "./04_traffic.js";
import adsMeta from "./05_adsMeta.js";
import adsGoogle from "./05_adsGoogle.js";
import adsLinkedin from "./05_adsLinkedin.js";
import founders from "./06_contactsFounders.js";
import sdr from "./06_contactsSdr.js";
import research from "./07_research.js";
import brandColors from "./08_brandColors.js";
import logo from "./09_logoUrl.js";
import tam from "./10_tam.js";
import icpSegments from "./11_icpSegments.js";
import salesSignals from "./12_salesSignals.js";
import followupNarrative from "./13_followupNarrative.js";

export const STEPS: StepModule[] = [
  person,
  company,
  crm,
  traffic,
  adsMeta,
  adsGoogle,
  adsLinkedin,
  founders,
  sdr,
  research,
  brandColors,
  logo,
  tam,
  icpSegments,
  salesSignals,
  followupNarrative,
];

// Request schemas for every resource (design: "Validator", schema table).
export { loginBody } from './auth.schemas.js';
export { PROFILE_FIELDS, profileBody } from './profile.schemas.js';
export { SETTINGS_KEYS, SOCIAL_LINKS_MAX, settingsBody } from './settings.schemas.js';
export {
  PROJECT_FEATURES_MAX,
  PROJECT_TECHNOLOGIES_MAX,
  projectBody,
  publicProjectQuery,
  publishBody,
  slugField,
} from './project.schemas.js';
export { skillBody } from './skill.schemas.js';
export { RESPONSIBILITIES_MAX, experienceBody } from './experience.schemas.js';
export {
  EDUCATION_MIN_YEAR,
  EDUCATION_YEARS_AHEAD,
  createEducationBody,
  currentYear,
  educationBody,
} from './education.schemas.js';
export {
  CONTACT_FIELDS,
  CONTACT_PAGE_MAX,
  HONEYPOT_FIELD,
  contactBody,
  contactListQuery,
  isHoneypotFilled,
  readBody,
} from './contact.schemas.js';
export { ID_MAX, idParams } from './params.schemas.js';
export { classifyIdentifier } from './identifier.js';

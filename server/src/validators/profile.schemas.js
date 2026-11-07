// Profile request schema (Requirements 10.2, 10.3, 10.4, 10.10).
import { email, object, str, url } from './rules.js';

/** The ten Profile fields, in response order. */
export const PROFILE_FIELDS = Object.freeze([
  'name',
  'professional_title',
  'personal_introduction',
  'biography',
  'career_interests',
  'professional_goals',
  'profile_image_url',
  'email',
  'github_url',
  'linkedin_url',
]);

/**
 * `PUT /api/profile` body. `name`, `professional_title` and `email` are required. Every other
 * field is optional and stays out of the normalized value when omitted, so the service leaves it
 * unchanged (10.2). URL fields accept '' to clear the stored value (10.5). Unknown keys are
 * rejected (10.10).
 */
export const profileBody = object({
  name: str({ min: 1, max: 100 }),
  professional_title: str({ min: 1, max: 100 }),
  email: email(),
  personal_introduction: str({ max: 5000, required: false }),
  biography: str({ max: 5000, required: false }),
  career_interests: str({ max: 5000, required: false }),
  professional_goals: str({ max: 5000, required: false }),
  profile_image_url: url({ required: false }),
  github_url: url({ required: false }),
  linkedin_url: url({ required: false }),
});

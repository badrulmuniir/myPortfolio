// URLs of the missing-image placeholders (assumption A8). Vite turns each import into a URL string.
// Pass one of these to <LazyImage placeholder={...}>. The alt text comes from the image's props,
// so a placeholder keeps the subject name of the image it replaces (34.5).

import placeholderProject from './placeholder-project.svg';
import placeholderProfile from './placeholder-profile.svg';
import placeholderIcon from './placeholder-icon.svg';

/** Project card and Project Details image placeholder (16:9). */
export const PLACEHOLDER_PROJECT = placeholderProject;
/** Profile image placeholder (square). */
export const PLACEHOLDER_PROFILE = placeholderProfile;
/** Skill icon placeholder (square, small). */
export const PLACEHOLDER_ICON = placeholderIcon;

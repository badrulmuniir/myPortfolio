// Admin_Dashboard sidebar destinations (Requirements 20.3, 31.1). The Overview cards link to
// the same paths, so both read them from here.

export const ADMIN_NAV_ITEMS = Object.freeze([
  { key: 'overview', label: 'Overview', to: '/admin', end: true },
  { key: 'projects', label: 'Projects', to: '/admin/projects' },
  { key: 'skills', label: 'Skills', to: '/admin/skills' },
  { key: 'experience', label: 'Experience', to: '/admin/experience' },
  { key: 'education', label: 'Education', to: '/admin/education' },
  { key: 'messages', label: 'Messages', to: '/admin/messages' },
  { key: 'profile', label: 'Profile', to: '/admin/profile' },
  { key: 'settings', label: 'Settings', to: '/admin/settings' },
]);

# Page styles

One file per page that needs styles beyond the shared sheets, named after the page
(for example `home.css`, `projects.css`, `admin-messages.css`).

- Import the file from its page component: `import '../../styles/pages/home.css';`
- Do not import page files from `main.jsx`; the global sheets (`tokens`, `base`, `layout`,
  `components`, `admin`) are imported there once.
- Use the tokens from `tokens.css` (no raw colors), the mobile-first breakpoints
  `@media (min-width: 768px)` and `@media (min-width: 1024px)`, and prefix classes with
  the page name (`.home-...`, `.projects-...`) to avoid collisions.

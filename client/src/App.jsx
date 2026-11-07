import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { SiteDataProvider } from './context/SiteDataContext.jsx';
import { PublicLayout } from './components/layout/PublicLayout.jsx';
import { LoadingIndicator } from './components/common/LoadingIndicator.jsx';
import HomePage from './pages/public/HomePage.jsx';
import AboutPage from './pages/public/AboutPage.jsx';
import SkillsPage from './pages/public/SkillsPage.jsx';
import ProjectsPage from './pages/public/ProjectsPage.jsx';
import ProjectDetailsPage from './pages/public/ProjectDetailsPage.jsx';
import ExperiencePage from './pages/public/ExperiencePage.jsx';
import EducationPage from './pages/public/EducationPage.jsx';
import ContactPage from './pages/public/ContactPage.jsx';
import NotFoundPage from './pages/public/NotFoundPage.jsx';

// The Admin_Dashboard is a separate chunk, loaded only when an /admin path is opened
// (Requirements 35.2, 35.3). Nothing in the public bundle imports admin modules statically.
const AdminApp = lazy(() => import('./routes/AdminApp.jsx'));

export const ADMIN_LOADING_LABEL = 'Loading dashboard';

/**
 * Top-level routes (design: Frontend > Routing).
 * `/admin` and everything below it go to the Admin_Dashboard, never to the public
 * not-found page (21.5). Every other path renders inside the PublicLayout.
 */
export default function App() {
  return (
    <Routes>
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<LoadingIndicator label={ADMIN_LOADING_LABEL} />}>
            <AdminApp />
          </Suspense>
        }
      />
      <Route
        element={
          <SiteDataProvider>
            <PublicLayout />
          </SiteDataProvider>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:slug" element={<ProjectDetailsPage />} />
        <Route path="experience" element={<ExperiencePage />} />
        <Route path="education" element={<EducationPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

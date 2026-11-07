// Admin_Dashboard entry, loaded lazily by App.jsx as its own chunk (Requirements 35.2, 35.3).
// Paths are relative to the `/admin/*` route in App.jsx.
//
// | Path                          | Page                 |
// |-------------------------------|----------------------|
// | /admin/login                  | LoginPage (guest)    |
// | /admin                        | OverviewPage         |
// | /admin/projects               | ProjectsListPage     |
// | /admin/projects/new           | ProjectFormPage      |
// | /admin/projects/:id/edit      | ProjectFormPage      |
// | /admin/skills[/new, /:id/edit]| SkillsListPage, SkillFormPage |
// | /admin/experience[...]        | ExperienceListPage, ExperienceFormPage |
// | /admin/education[...]         | EducationListPage, EducationFormPage |
// | /admin/messages               | MessagesPage         |
// | /admin/messages/:id           | MessageDetailPage    |
// | /admin/profile                | ProfileFormPage      |
// | /admin/settings               | SettingsFormPage     |
// | /admin/* (anything else)      | AdminNotFoundPage, inside the protected layout |
//
// Every route except login is behind ProtectedRoute, so an unknown admin path never reveals
// anything to a signed-out visitor: it redirects to the login page like any other admin path.

import { Route, Routes } from 'react-router-dom';
import { NotificationProvider } from '../context/NotificationContext.jsx';
import { ProtectedRoute } from './ProtectedRoute.jsx';
import { GuestOnlyRoute } from './GuestOnlyRoute.jsx';
import { AdminLayout } from '../components/admin/AdminLayout.jsx';
import LoginPage from '../pages/admin/LoginPage.jsx';
import OverviewPage from '../pages/admin/OverviewPage.jsx';
import ProjectsListPage from '../pages/admin/ProjectsListPage.jsx';
import ProjectFormPage from '../pages/admin/ProjectFormPage.jsx';
import SkillsListPage from '../pages/admin/SkillsListPage.jsx';
import SkillFormPage from '../pages/admin/SkillFormPage.jsx';
import ExperienceListPage from '../pages/admin/ExperienceListPage.jsx';
import ExperienceFormPage from '../pages/admin/ExperienceFormPage.jsx';
import EducationListPage from '../pages/admin/EducationListPage.jsx';
import EducationFormPage from '../pages/admin/EducationFormPage.jsx';
import MessagesPage from '../pages/admin/MessagesPage.jsx';
import MessageDetailPage from '../pages/admin/MessageDetailPage.jsx';
import ProfileFormPage from '../pages/admin/ProfileFormPage.jsx';
import SettingsFormPage from '../pages/admin/SettingsFormPage.jsx';
import AdminNotFoundPage from '../pages/admin/AdminNotFoundPage.jsx';

export default function AdminApp() {
  return (
    <NotificationProvider>
      <Routes>
        <Route
          path="login"
          element={
            <GuestOnlyRoute>
              <LoginPage />
            </GuestOnlyRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="projects" element={<ProjectsListPage />} />
          <Route path="projects/new" element={<ProjectFormPage />} />
          <Route path="projects/:id/edit" element={<ProjectFormPage />} />
          <Route path="skills" element={<SkillsListPage />} />
          <Route path="skills/new" element={<SkillFormPage />} />
          <Route path="skills/:id/edit" element={<SkillFormPage />} />
          <Route path="experience" element={<ExperienceListPage />} />
          <Route path="experience/new" element={<ExperienceFormPage />} />
          <Route path="experience/:id/edit" element={<ExperienceFormPage />} />
          <Route path="education" element={<EducationListPage />} />
          <Route path="education/new" element={<EducationFormPage />} />
          <Route path="education/:id/edit" element={<EducationFormPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="messages/:id" element={<MessageDetailPage />} />
          <Route path="profile" element={<ProfileFormPage />} />
          <Route path="settings" element={<SettingsFormPage />} />
          <Route path="*" element={<AdminNotFoundPage />} />
        </Route>
      </Routes>
    </NotificationProvider>
  );
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as projectsApi from '../../api/projectsApi.js';
import * as technologiesApi from '../../api/technologiesApi.js';
import { NotificationProvider } from '../../context/NotificationContext.jsx';
import ProjectsListPage from './ProjectsListPage.jsx';
import ProjectFormPage, { SLUG_WARNING_TITLE, needsSlugWarning, valuesFromProject } from './ProjectFormPage.jsx';

vi.mock('../../api/projectsApi.js', () => ({
  listAdmin: vi.fn(),
  getAdmin: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setPublished: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../api/technologiesApi.js', () => ({ list: vi.fn() }));

const api = vi.mocked(projectsApi);
const techApi = vi.mocked(technologiesApi);

const project = (overrides = {}) => ({
  id: 1,
  title: 'Portfolio CMS',
  slug: 'portfolio-cms',
  short_description: 'A CMS',
  full_description: '',
  problem_statement: '',
  objectives: '',
  challenges: '',
  solutions: '',
  category: 'Web',
  image_url: '',
  github_url: '',
  live_demo_url: '',
  display_order: 0,
  is_published: false,
  features: [],
  technologies: [],
  ...overrides,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Path() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}</p>;
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NotificationProvider>
        <Path />
        <Routes>
          <Route path="/admin/projects" element={<ProjectsListPage />} />
          <Route path="/admin/projects/new" element={<ProjectFormPage />} />
          <Route path="/admin/projects/:id/edit" element={<ProjectFormPage />} />
        </Routes>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

const path = () => screen.getByTestId('path').textContent;
const statusRegion = () =>
  screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite' && el.closest('.notification-region'));
const alertRegion = () =>
  screen.getAllByRole('alert').find((el) => el.getAttribute('aria-live') === 'assertive' && el.closest('.notification-region'));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  techApi.list.mockReset();
  api.listAdmin.mockResolvedValue([]);
  techApi.list.mockResolvedValue([
    { id: 1, name: 'React', category: null },
    { id: 2, name: 'Node.js', category: null },
  ]);
});

describe('ProjectsListPage', () => {
  it('shows one row per project with its publication label and Edit/Delete actions (31.3, 31.4)', async () => {
    api.listAdmin.mockResolvedValue([project(), project({ id: 2, title: 'Shop', is_published: true })]);
    renderAt('/admin/projects');

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Unpublished')).toBeTruthy();
    expect(within(rows[1]).getByText('Published')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit Shop' }).getAttribute('href')).toBe('/admin/projects/2/edit');
    expect(screen.getByRole('button', { name: 'Delete Shop' })).toBeTruthy();
  });

  it('changes the status only after the publish request succeeds, then notifies and reloads (31.4, 31.11, 31.13)', async () => {
    const user = userEvent.setup();
    api.listAdmin.mockResolvedValue([project()]);
    const publish = deferred();
    api.setPublished.mockReturnValue(publish.promise);
    renderAt('/admin/projects');

    const toggle = await screen.findByRole('button', { name: 'Publish Portfolio CMS' });
    await user.click(toggle);
    expect(api.setPublished).toHaveBeenCalledWith(1, true);
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText('Unpublished')).toBeTruthy();

    await user.click(toggle);
    expect(api.setPublished).toHaveBeenCalledTimes(1);

    api.listAdmin.mockResolvedValue([project({ is_published: true })]);
    publish.resolve(project({ is_published: true }));

    expect(await screen.findByText('Published')).toBeTruthy();
    expect(within(statusRegion()).getByText('Project "Portfolio CMS" published.')).toBeTruthy();
    await waitFor(() => expect(api.listAdmin).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Unpublish Portfolio CMS' }).disabled).toBe(false);
  });

  it('keeps the status and shows an error Notification when publishing fails (31.16)', async () => {
    const user = userEvent.setup();
    api.listAdmin.mockResolvedValue([project()]);
    api.setPublished.mockRejectedValue(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }));
    renderAt('/admin/projects');

    await user.click(await screen.findByRole('button', { name: 'Publish Portfolio CMS' }));

    expect(await within(alertRegion()).findByText(NETWORK_ERROR_MESSAGE)).toBeTruthy();
    expect(screen.getByText('Unpublished')).toBeTruthy();
    expect(api.listAdmin).toHaveBeenCalledTimes(1);
  });

  it('deletes only after Confirm in a dialog that names the project (31.5, 31.11)', async () => {
    const user = userEvent.setup();
    api.listAdmin.mockResolvedValue([project(), project({ id: 2, title: 'Shop' })]);
    api.remove.mockResolvedValue({ id: 2 });
    renderAt('/admin/projects');

    await user.click(await screen.findByRole('button', { name: 'Delete Shop' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/"Shop"/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete Shop' }));
    dialog = screen.getByRole('dialog');
    api.listAdmin.mockResolvedValue([project()]);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(api.remove).toHaveBeenCalledWith(2);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Shop' })).toBeNull());
    expect(within(statusRegion()).getByText('Project "Shop" deleted.')).toBeTruthy();
    await waitFor(() => expect(api.listAdmin).toHaveBeenCalledTimes(2));
  });

  it('keeps the row when the delete fails (31.16)', async () => {
    const user = userEvent.setup();
    api.listAdmin.mockResolvedValue([project()]);
    api.remove.mockRejectedValue(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Server failed' }));
    renderAt('/admin/projects');

    await user.click(await screen.findByRole('button', { name: 'Delete Portfolio CMS' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(await within(alertRegion()).findByText('Server failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Portfolio CMS' })).toBeTruthy();
  });

  it('shows the empty state, and an error with Retry when loading fails (31.14)', async () => {
    const user = userEvent.setup();
    api.listAdmin.mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Load failed' }));
    renderAt('/admin/projects');

    expect(await screen.findByText('Load failed')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No projects yet/)).toBeTruthy();
  });
});

describe('ProjectFormPage', () => {
  it('validates every field before sending and sends nothing while a field fails (31.7)', async () => {
    const user = userEvent.setup();
    renderAt('/admin/projects/new');

    await user.type(screen.getByLabelText(/^GitHub URL/), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(api.create).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Title/).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText(/^Title/));
    expect(screen.getByLabelText(/^Short description/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/^Category/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/^GitHub URL/).getAttribute('aria-invalid')).toBe('true');
  });

  it('creates a project with features in order and suggested technologies, then notifies and returns to the list (31.8, 31.11)', async () => {
    const user = userEvent.setup();
    api.create.mockImplementation(async (payload) => ({ ...project(), ...payload, id: 9 }));
    renderAt('/admin/projects/new');

    await user.type(screen.getByLabelText(/^Title/), '  New site ');
    await user.type(screen.getByLabelText(/^Short description/), 'Short');
    await user.type(screen.getByLabelText(/^Category/), 'Web');

    await user.click(screen.getByRole('button', { name: 'Add feature' }));
    await user.type(screen.getByLabelText('Feature 1'), 'First');
    await user.click(screen.getByRole('button', { name: 'Add feature' }));
    await user.type(screen.getByLabelText('Feature 2'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Move up Feature 2' }));

    await waitFor(() => expect(techApi.list).toHaveBeenCalled());
    const techInput = screen.getByRole('combobox', { name: 'Technologies' });
    await user.type(techInput, 'rea');
    await user.click(await screen.findByRole('option', { name: 'React' }));
    await user.type(techInput, 'react{Enter}');
    expect(screen.getAllByText('React')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const payload = api.create.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: 'New site',
      short_description: 'Short',
      category: 'Web',
      display_order: 0,
      is_published: false,
      features: ['Second', 'First'],
      technologies: ['React'],
    });
    expect(payload).not.toHaveProperty('slug');
    await waitFor(() => expect(path()).toBe('/admin/projects'));
    expect(within(statusRegion()).getByText('Project "New site" created.')).toBeTruthy();
  });

  it('warns before changing the slug of a published project; Cancel sends nothing, Continue sends PUT (31.10)', async () => {
    const user = userEvent.setup();
    api.getAdmin.mockResolvedValue(
      project({ id: 7, is_published: true, slug: 'old-slug', features: ['A', 'B'], technologies: [{ id: 1, name: 'React' }] }),
    );
    api.update.mockImplementation(async (id, payload) => ({ ...project(), ...payload, id }));
    renderAt('/admin/projects/7/edit');

    const slug = await screen.findByLabelText(/^Slug/);
    expect(slug.value).toBe('old-slug');
    expect(screen.getByLabelText('Feature 2').value).toBe('B');
    await user.clear(slug);
    await user.type(slug, 'new-slug');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    let dialog = screen.getByRole('dialog', { name: SLUG_WARNING_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.update).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Slug/).value).toBe('new-slug');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    dialog = screen.getByRole('dialog', { name: SLUG_WARNING_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update.mock.calls[0][0]).toBe(7);
    expect(api.update.mock.calls[0][1]).toMatchObject({
      slug: 'new-slug',
      is_published: true,
      features: ['A', 'B'],
      technologies: ['React'],
    });
    await waitFor(() => expect(path()).toBe('/admin/projects'));
    expect(within(statusRegion()).getByText('Project "Portfolio CMS" updated.')).toBeTruthy();
  });

  it('shows server field errors next to the fields and keeps the values (31.15, 31.16)', async () => {
    const user = userEvent.setup();
    api.getAdmin.mockResolvedValue(project({ id: 3, features: ['One', 'Two'] }));
    api.update.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [
          { field: 'category', reason: 'too_long', message: 'Category is too long' },
          { field: 'features[1]', reason: 'too_long', message: 'Feature is too long' },
        ],
      }),
    );
    renderAt('/admin/projects/3/edit');

    const title = await screen.findByLabelText(/^Title/);
    await user.clear(title);
    await user.type(title, 'Changed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Category is too long')).toBeTruthy();
    expect(screen.getByLabelText(/^Category/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Feature 2').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Feature is too long')).toBeTruthy();
    expect(within(alertRegion()).getByText('Validation failed')).toBeTruthy();
    expect(screen.getByLabelText(/^Title/).value).toBe('Changed');
    expect(path()).toBe('/admin/projects/3/edit');
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(false);
  });

  it('shows a not-found error with a link back when the project does not exist', async () => {
    api.getAdmin.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Project not found' }));
    renderAt('/admin/projects/99/edit');

    expect(await screen.findByText(/was not found/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('project form helpers', () => {
  it('needsSlugWarning only for a published project whose non-empty slug changes', () => {
    const saved = { slug: 'a-slug', is_published: true };
    expect(needsSlugWarning(saved, 'b-slug')).toBe(true);
    expect(needsSlugWarning(saved, 'a-slug')).toBe(false);
    expect(needsSlugWarning(saved, undefined)).toBe(false);
    expect(needsSlugWarning({ ...saved, is_published: false }, 'b-slug')).toBe(false);
    expect(needsSlugWarning(null, 'b-slug')).toBe(false);
  });

  it('valuesFromProject turns null text into empty strings and technologies into names', () => {
    const values = valuesFromProject(project({ image_url: null, display_order: 12, technologies: [{ id: 1, name: 'Go' }] }));
    expect(values.image_url).toBe('');
    expect(values.display_order).toBe('12');
    expect(values.technologies).toEqual(['Go']);
  });
});

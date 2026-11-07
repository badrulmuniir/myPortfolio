// Skill management page tests (Requirements 15.4, 15.5, 15.9, 31.3, 31.5, 31.7, 31.11, 31.15, 31.16).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../api/apiClient.js';
import * as skillsApi from '../../api/skillsApi.js';
import { NotificationProvider } from '../../context/NotificationContext.jsx';
import SkillsListPage from './SkillsListPage.jsx';
import SkillFormPage from './SkillFormPage.jsx';
import { DEFAULT_SKILL_CATEGORIES, categorySuggestions, toSkillInput } from './skillPages.js';

vi.mock('../../api/skillsApi.js', () => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const SKILLS = [
  { id: 1, name: 'PostgreSQL', category: 'Database', proficiency_level: 'Advanced', icon_url: '', display_order: 0 },
  { id: 2, name: 'Redis', category: 'Database', proficiency_level: '', icon_url: '', display_order: 1 },
  { id: 3, name: 'React', category: 'Frontend Development', proficiency_level: 'Expert', icon_url: 'https://x.dev/r.svg', display_order: 0 },
  { id: 4, name: 'Vite', category: 'Frontend Development', proficiency_level: 'Intermediate', icon_url: '', display_order: 1 },
  { id: 5, name: 'Figma', category: 'Design', proficiency_level: '', icon_url: '', display_order: 0 },
];

function renderAt(path) {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/skills" element={<SkillsListPage />} />
          <Route path="/admin/skills/new" element={<SkillFormPage />} />
          <Route path="/admin/skills/:id/edit" element={<SkillFormPage />} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>,
  );
}

const table = () => screen.findByRole('table');
const button = (name) => screen.getByRole('button', { name });
const notifications = () => document.querySelector('.notification-region').textContent;

afterEach(() => {
  vi.mocked(skillsApi.list).mockReset();
  vi.mocked(skillsApi.create).mockReset();
  vi.mocked(skillsApi.update).mockReset();
  vi.mocked(skillsApi.remove).mockReset();
});

describe('skillPages helpers', () => {
  it('suggests the five defaults first, then other existing categories once each (15.4)', () => {
    expect(categorySuggestions(null)).toEqual(DEFAULT_SKILL_CATEGORIES);
    expect(categorySuggestions([...SKILLS, { category: 'Design' }, { category: 'database' }, { category: '  ' }])).toEqual([
      ...DEFAULT_SKILL_CATEGORIES,
      'Design',
      'database',
    ]);
  });

  it('builds a full PUT body with only display_order changed', () => {
    expect(toSkillInput({ ...SKILLS[1], proficiency_level: null }, 7)).toEqual({
      name: 'Redis',
      category: 'Database',
      proficiency_level: '',
      icon_url: '',
      display_order: 7,
    });
  });
});

describe('SkillsListPage', () => {
  it('shows one row per skill and disables moves at category edges (15.5, 31.3)', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue(SKILLS);
    renderAt('/admin/skills');
    await table();

    expect(screen.getAllByRole('row')).toHaveLength(SKILLS.length + 1);
    expect(button('Move PostgreSQL up').disabled).toBe(true);
    expect(button('Move PostgreSQL down').disabled).toBe(false);
    expect(button('Move Redis up').disabled).toBe(false);
    expect(button('Move Redis down').disabled).toBe(true);
    expect(button('Move Figma up').disabled).toBe(true);
    expect(button('Move Figma down').disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Edit React' }).getAttribute('href')).toBe('/admin/skills/3/edit');
    expect(document.title).toBe('Skills | Admin');
  });

  it('swaps display_order with the neighbour, PUTs both skills and reloads (15.5, 31.11)', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue(SKILLS);
    vi.mocked(skillsApi.update).mockImplementation(async (id, body) => ({ id, ...body }));
    const user = userEvent.setup();
    renderAt('/admin/skills');
    await table();

    await user.click(button('Move Vite up'));

    await waitFor(() => expect(skillsApi.list).toHaveBeenCalledTimes(2));
    expect(skillsApi.update).toHaveBeenCalledTimes(2);
    expect(skillsApi.update).toHaveBeenCalledWith(4, { ...toSkillInput(SKILLS[3]), display_order: 0 });
    expect(skillsApi.update).toHaveBeenCalledWith(3, { ...toSkillInput(SKILLS[2]), display_order: 1 });
    expect(notifications()).toContain('Moved Vite up.');
    await table();
    await waitFor(() => expect(document.activeElement).toBe(button('Move Vite up')));
  });

  it('renumbers the category when the two values are equal (15.5)', async () => {
    const tied = [
      { id: 10, name: 'A', category: 'Tools', proficiency_level: '', icon_url: '', display_order: 3 },
      { id: 11, name: 'B', category: 'Tools', proficiency_level: '', icon_url: '', display_order: 3 },
    ];
    vi.mocked(skillsApi.list).mockResolvedValue(tied);
    vi.mocked(skillsApi.update).mockImplementation(async (id, body) => ({ id, ...body }));
    const user = userEvent.setup();
    renderAt('/admin/skills');
    await table();

    await user.click(button('Move B up'));

    await waitFor(() => expect(skillsApi.list).toHaveBeenCalledTimes(2));
    expect(vi.mocked(skillsApi.update).mock.calls.map(([id, body]) => [id, body.display_order]).sort()).toEqual([
      [10, 1],
      [11, 0],
    ]);
  });

  it('shows an error Notification and reloads when a move PUT fails (15.9, 31.16)', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue(SKILLS);
    vi.mocked(skillsApi.update)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Database is down' }));
    const user = userEvent.setup();
    renderAt('/admin/skills');
    await table();

    await user.click(button('Move PostgreSQL down'));

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent).toContain('Database is down'));
    await waitFor(() => expect(skillsApi.list).toHaveBeenCalledTimes(2));
    expect(skillsApi.update).toHaveBeenCalledTimes(2);
    await table();
  });

  it('deletes only after Confirm; Cancel sends no request (31.5, 31.11)', async () => {
    vi.mocked(skillsApi.list).mockResolvedValueOnce(SKILLS).mockResolvedValueOnce(SKILLS.slice(1));
    vi.mocked(skillsApi.remove).mockResolvedValue({ id: 1 });
    const user = userEvent.setup();
    renderAt('/admin/skills');
    await table();

    await user.click(button('Delete PostgreSQL'));
    let dialog = screen.getByRole('dialog', { name: 'Delete skill' });
    expect(dialog.textContent).toContain('PostgreSQL');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(skillsApi.remove).not.toHaveBeenCalled();

    await user.click(button('Delete PostgreSQL'));
    dialog = screen.getByRole('dialog', { name: 'Delete skill' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(skillsApi.list).toHaveBeenCalledTimes(2));
    expect(skillsApi.remove).toHaveBeenCalledWith(1);
    await table();
    expect(screen.queryByRole('button', { name: 'Delete PostgreSQL' })).toBeNull();
    expect(notifications()).toContain('Deleted skill PostgreSQL.');
  });
});

describe('SkillFormPage', () => {
  it('offers category suggestions and a Proficiency_Level select (15.4)', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue(SKILLS);
    renderAt('/admin/skills/new');

    const category = screen.getByLabelText(/^Category/);
    const datalist = document.getElementById(category.getAttribute('list'));
    await waitFor(() =>
      expect([...datalist.options].map((o) => o.value)).toEqual([...DEFAULT_SKILL_CATEGORIES, 'Design']),
    );
    const select = screen.getByLabelText('Proficiency level');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'Beginner', 'Intermediate', 'Advanced', 'Expert']);
    expect(document.title).toBe('New skill | Admin');
  });

  it('sends no request while a field is invalid and shows the field errors (31.7)', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue(SKILLS);
    const user = userEvent.setup();
    renderAt('/admin/skills/new');

    await user.type(screen.getByLabelText(/^Icon URL/), 'not a url');
    await user.clear(screen.getByLabelText(/^Display order/));
    await user.type(screen.getByLabelText(/^Display order/), '1.5');
    await user.click(button('Create skill'));

    expect(skillsApi.create).not.toHaveBeenCalled();
    const name = screen.getByLabelText(/^Name/);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/^Category/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/^Icon URL/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/^Display order/).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
  });

  it('creates a skill with trimmed values, notifies and returns to the list (31.11)', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue(SKILLS);
    vi.mocked(skillsApi.create).mockImplementation(async (body) => ({ id: 9, ...body }));
    const user = userEvent.setup();
    renderAt('/admin/skills/new');

    await user.type(screen.getByLabelText(/^Name/), '  Docker ');
    await user.type(screen.getByLabelText(/^Category/), 'Development Tools');
    await user.selectOptions(screen.getByLabelText('Proficiency level'), 'Advanced');
    await user.clear(screen.getByLabelText(/^Display order/));
    await user.type(screen.getByLabelText(/^Display order/), '4');
    await user.click(button('Create skill'));

    expect(skillsApi.create).toHaveBeenCalledWith({
      name: 'Docker',
      category: 'Development Tools',
      proficiency_level: 'Advanced',
      icon_url: '',
      display_order: 4,
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Skills' })).toBeTruthy();
    expect(notifications()).toContain('Created skill Docker.');
  });

  it('pre-fills the edit form and shows server field errors with the values kept (31.3, 31.15)', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue(SKILLS);
    vi.mocked(skillsApi.update).mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'name', reason: 'duplicate', message: 'Name is already used' }],
      }),
    );
    const user = userEvent.setup();
    renderAt('/admin/skills/3/edit');

    const name = await screen.findByLabelText(/^Name/);
    expect(name.value).toBe('React');
    expect(screen.getByLabelText(/^Category/).value).toBe('Frontend Development');
    expect(screen.getByLabelText('Proficiency level').value).toBe('Expert');
    expect(screen.getByLabelText(/^Icon URL/).value).toBe('https://x.dev/r.svg');
    expect(screen.getByLabelText(/^Display order/).value).toBe('0');

    await user.clear(name);
    await user.type(name, 'React 19');
    await user.click(button('Save changes'));

    expect(skillsApi.update).toHaveBeenCalledWith(3, {
      name: 'React 19',
      category: 'Frontend Development',
      proficiency_level: 'Expert',
      icon_url: 'https://x.dev/r.svg',
      display_order: 0,
    });
    expect(await screen.findByText('Name is already used')).toBeTruthy();
    expect(screen.getByLabelText(/^Name/).value).toBe('React 19');
    expect(notifications()).toContain('Validation failed');
    expect(button('Save changes').disabled).toBe(false);
  });

  it('shows a not-found state for an unknown id', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue(SKILLS);
    renderAt('/admin/skills/99/edit');

    expect(await screen.findByText('Skill not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to skills' }).getAttribute('href')).toBe('/admin/skills');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});

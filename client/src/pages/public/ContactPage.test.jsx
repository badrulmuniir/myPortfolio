import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ContactPage, {
  CONTACT_RATE_LIMIT_MESSAGE,
  CONTACT_SENDING_LABEL,
  CONTACT_SUCCESS_MESSAGE,
} from './ContactPage.jsx';
import { SiteDataProvider } from '../../context/SiteDataContext.jsx';
import { submit as submitContact } from '../../api/contactApi.js';
import { get as getSettings } from '../../api/settingsApi.js';
import { get as getProfile } from '../../api/profileApi.js';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';

vi.mock('../../api/contactApi.js', () => ({ submit: vi.fn() }));
vi.mock('../../api/settingsApi.js', () => ({ get: vi.fn() }));
vi.mock('../../api/profileApi.js', () => ({ get: vi.fn() }));

const SETTINGS = { site_title: 'Ada Dev', hero_introduction: '', footer_text: '', social_links: [] };
const PROFILE = {
  name: 'Ada Lovelace',
  professional_title: 'Developer',
  email: 'ada@example.com',
  github_url: 'https://github.com/ada',
  linkedin_url: 'https://www.linkedin.com/in/ada',
};
const VALID = { name: 'Grace', email: 'grace@example.com', subject: 'Hello', message: 'I would like to talk.' };

function renderContact({ profile = PROFILE } = {}) {
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
  if (profile) vi.mocked(getProfile).mockResolvedValue(profile);
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={['/contact']}>
      <SiteDataProvider>
        <ContactPage />
      </SiteDataProvider>
    </MemoryRouter>,
  );
  return { user, ...utils };
}

const field = (name) => screen.getByLabelText(new RegExp(`^${name}`));
const submitButton = () => screen.getByRole('button', { name: /Send message|Sending/ });

async function fillValid(user, values = VALID) {
  for (const [name, value] of Object.entries(values)) {
    const label = name[0].toUpperCase() + name.slice(1);
    await user.clear(field(label));
    if (value !== '') await user.type(field(label), value);
  }
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  vi.mocked(submitContact).mockReset();
  vi.mocked(getSettings).mockReset();
  vi.mocked(getProfile).mockReset();
});

describe('ContactPage', () => {
  it('shows one h1, labelled fields, a hidden honeypot and the page title', async () => {
    const { container } = renderContact();

    expect(container.querySelectorAll('h1').length).toBe(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Contact');
    for (const label of ['Name', 'Email', 'Subject', 'Message']) {
      expect(field(label)).toBeTruthy();
    }
    expect(field('Message').tagName).toBe('TEXTAREA');

    const honeypot = container.querySelector('input[name="website"]');
    expect(honeypot.id).toBe('website');
    expect(honeypot.getAttribute('tabindex')).toBe('-1');
    expect(honeypot.getAttribute('autocomplete')).toBe('off');
    const wrapper = honeypot.closest('.hp-field');
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper.querySelector('label').getAttribute('for')).toBe('website');

    await waitFor(() => expect(document.title).toBe('Contact | Ada Dev'));
  });

  it('shows the Profile email as a mailto link and GitHub/LinkedIn in a new tab', async () => {
    renderContact();

    const email = await screen.findByRole('link', { name: PROFILE.email });
    expect(email.getAttribute('href')).toBe(`mailto:${PROFILE.email}`);
    expect(email.getAttribute('target')).toBeNull();
    for (const [name, href] of [
      ['GitHub', PROFILE.github_url],
      ['LinkedIn', PROFILE.linkedin_url],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('omits each contact link whose Profile value is empty', async () => {
    renderContact({ profile: { ...PROFILE, email: 'ada@example.com', github_url: '', linkedin_url: '' } });

    await screen.findByRole('link', { name: 'ada@example.com' });
    expect(screen.queryByRole('link', { name: 'GitHub' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'LinkedIn' })).toBeNull();
  });

  it('shows field errors, focuses the first invalid field, keeps values and sends nothing', async () => {
    const { user } = renderContact();

    await user.type(field('Name'), '   ');
    await user.type(field('Email'), 'not-an-email');
    await user.type(field('Subject'), 'Hi');
    await user.type(field('Message'), 'short');
    await user.click(submitButton());

    expect(document.activeElement).toBe(field('Name'));
    expect(field('Name').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('This field is required')).toBeTruthy();
    expect(screen.getByText('Must be a valid email address')).toBeTruthy();
    expect(screen.getByText('Must be at least 10 characters')).toBeTruthy();
    expect(field('Subject').getAttribute('aria-invalid')).toBeNull();
    expect(field('Email').value).toBe('not-an-email');
    expect(field('Message').value).toBe('short');
    expect(submitContact).not.toHaveBeenCalled();

    // Fixing the name removes its error and moves focus to the next invalid field.
    await user.type(field('Name'), 'Grace');
    await user.click(submitButton());
    expect(screen.queryByText('This field is required')).toBeNull();
    expect(field('Name').getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(field('Email'));
    expect(submitContact).not.toHaveBeenCalled();
  });

  it('sends one trimmed request, shows the sending state, then announces success and clears the form', async () => {
    const { user, container } = renderContact();
    const pending = deferred();
    vi.mocked(submitContact).mockReturnValue(pending.promise);

    await fillValid(user, { ...VALID, name: '  Grace  ' });
    await user.click(submitButton());

    const button = submitButton();
    expect(button.textContent).toBe(CONTACT_SENDING_LABEL);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    fireEvent.submit(container.querySelector('form'));
    expect(submitContact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(submitContact).mock.calls[0][0]).toEqual({ ...VALID, website: '' });

    await act(async () => pending.resolve({ received: true }));

    const success = await screen.findByText(CONTACT_SUCCESS_MESSAGE);
    expect(success.closest('[role="status"]')).toBeTruthy();
    for (const label of ['Name', 'Email', 'Subject', 'Message']) {
      expect(field(label).value).toBe('');
    }
    expect(container.querySelector('input[name="website"]').value).toBe('');
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().getAttribute('aria-busy')).toBeNull();
    expect(submitButton().textContent).toBe('Send message');
  });

  it('sends the honeypot value unchanged and treats the 201 as success', async () => {
    const { user, container } = renderContact();
    vi.mocked(submitContact).mockResolvedValue({ received: true });

    await fillValid(user);
    fireEvent.change(container.querySelector('input[name="website"]'), { target: { value: '  bot ' } });
    await user.click(submitButton());

    expect(await screen.findByText(CONTACT_SUCCESS_MESSAGE)).toBeTruthy();
    expect(vi.mocked(submitContact).mock.calls[0][0].website).toBe('  bot ');
    expect(container.querySelector('input[name="website"]').value).toBe('');
  });

  it('shows a form-level alert and the details field errors for a 400, keeping values', async () => {
    const { user } = renderContact();
    vi.mocked(submitContact).mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid.',
        details: [{ field: 'subject', reason: 'too_long', message: 'Must be at most 150 characters' }],
      }),
    );

    await fillValid(user);
    await user.click(submitButton());

    const alert = await screen.findByText('Some fields are invalid.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(screen.getByText('Must be at most 150 characters')).toBeTruthy();
    expect(field('Subject').getAttribute('aria-invalid')).toBe('true');
    expect(field('Name').value).toBe(VALID.name);
    expect(field('Message').value).toBe(VALID.message);
    expect(submitButton().disabled).toBe(false);
  });

  it('asks to try again later on 429, keeping values and showing no field errors', async () => {
    const { user, container } = renderContact();
    vi.mocked(submitContact).mockRejectedValue(
      new ApiError({ status: 429, code: 'TOO_MANY_CONTACT_SUBMISSIONS', message: CONTACT_RATE_LIMIT_MESSAGE }),
    );

    await fillValid(user);
    await user.click(submitButton());

    const alert = await screen.findByText(CONTACT_RATE_LIMIT_MESSAGE);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(container.querySelectorAll('[aria-invalid="true"]').length).toBe(0);
    expect(field('Email').value).toBe(VALID.email);
    expect(submitButton().disabled).toBe(false);
  });

  it('shows the network error message when no response arrives, keeping values', async () => {
    const { user } = renderContact();
    vi.mocked(submitContact).mockRejectedValue(
      new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }),
    );

    await fillValid(user);
    await user.click(submitButton());

    const alert = await screen.findByText(NETWORK_ERROR_MESSAGE);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(field('Subject').value).toBe(VALID.subject);
    expect(submitButton().disabled).toBe(false);
  });

  it('shows a loading indicator in place of the contact links while the Profile loads', () => {
    vi.mocked(getProfile).mockReturnValue(new Promise(() => {}));
    renderContact({ profile: null });

    expect(screen.getByText('Loading contact details…')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(submitButton()).toBeTruthy();
  });

  it('shows Retry when the Profile fails and keeps the form working', async () => {
    vi.mocked(getProfile)
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE }))
      .mockResolvedValueOnce(PROFILE);
    const { user } = renderContact({ profile: null });
    vi.mocked(submitContact).mockResolvedValue({ received: true });

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();

    await fillValid(user);
    await user.click(submitButton());
    expect(await screen.findByText(CONTACT_SUCCESS_MESSAGE)).toBeTruthy();
    expect(submitContact).toHaveBeenCalledTimes(1);

    await user.click(retry);
    expect(await screen.findByRole('link', { name: PROFILE.email })).toBeTruthy();
    expect(getProfile).toHaveBeenCalledTimes(2);
  });
});

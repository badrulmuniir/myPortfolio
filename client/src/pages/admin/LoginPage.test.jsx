import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api/apiClient.js';
import * as authApi from '../../api/authApi.js';
import { AUTH_STATUS, AuthProvider, SESSION_EXPIRED_MESSAGE, useAuth } from '../../context/AuthContext.jsx';
import { NotificationProvider } from '../../context/NotificationContext.jsx';
import { GuestOnlyRoute } from '../../routes/GuestOnlyRoute.jsx';
import { ProtectedRoute } from '../../routes/ProtectedRoute.jsx';
import { clearToken, getToken, setToken } from '../../utils/tokenStorage.js';
import LoginPage, { LOGIN_PENDING_LABEL, LOGIN_UNAVAILABLE_MESSAGE } from './LoginPage.jsx';

vi.mock('../../api/authApi.js', () => ({ login: vi.fn(), me: vi.fn() }));

const ADMIN = { id: 1, email: 'admin@example.com', role: 'admin' };

let auth;
function Probe() {
  auth = useAuth();
  const location = useLocation();
  return <p data-testid="path">{`${location.pathname}${location.search}`}</p>;
}

function renderLogin(entry = '/admin/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <NotificationProvider>
          <Probe />
          <Routes>
            <Route
              path="/admin/login"
              element={
                <GuestOnlyRoute>
                  <LoginPage />
                </GuestOnlyRoute>
              }
            />
            <Route
              path="/admin/*"
              element={
                <ProtectedRoute>
                  <h1>Dashboard target</h1>
                </ProtectedRoute>
              }
            />
          </Routes>
        </NotificationProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const path = () => screen.getByTestId('path').textContent;
const emailInput = () => screen.getByLabelText(/^Email/);
const passwordInput = () => screen.getByLabelText(/^Password/);
const submitButton = () => screen.getByRole('button', { name: /Sign in|Signing in/ });

async function fillAndSubmit(user, email, password) {
  if (email) await user.type(emailInput(), email);
  if (password) await user.type(passwordInput(), password);
  await user.click(submitButton());
}

beforeEach(() => {
  vi.mocked(authApi.login).mockReset();
  vi.mocked(authApi.me).mockReset();
  clearToken();
  auth = undefined;
});

afterEach(() => {
  clearToken();
});

describe('LoginPage form', () => {
  it('is reachable without authentication and has labelled email and masked password fields (30.1)', () => {
    renderLogin();
    expect(path()).toBe('/admin/login');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.querySelector('main#main')).not.toBeNull();
    expect(emailInput().getAttribute('type')).toBe('email');
    expect(passwordInput().getAttribute('type')).toBe('password');
    expect(submitButton().getAttribute('type')).toBe('submit');
    expect(document.title).toBe('Sign in | Admin');
  });

  it('shows field errors and sends no request for empty fields (30.2)', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(submitButton());

    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(passwordInput().getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('login-email-error')).not.toBeNull();
    expect(document.getElementById('login-password-error')).not.toBeNull();
    expect(document.activeElement).toBe(emailInput());
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('rejects an invalid email without a request and keeps the values (30.2)', async () => {
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user, 'not-an-email', 'secret');

    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(passwordInput().getAttribute('aria-invalid')).toBeNull();
    expect(emailInput().value).toBe('not-an-email');
    expect(authApi.login).not.toHaveBeenCalled();
  });
});

describe('LoginPage submission', () => {
  it('stores the token and replaces the history entry with the remembered path on success (30.3)', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ token: 'tok-1', admin: ADMIN });
    const user = userEvent.setup();
    renderLogin({ pathname: '/admin/login', state: { from: '/admin/projects?page=2' } });
    await fillAndSubmit(user, '  admin@example.com ', 'p@ss word');

    await waitFor(() => expect(path()).toBe('/admin/projects?page=2'));
    expect(authApi.login).toHaveBeenCalledTimes(1);
    expect(authApi.login).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'p@ss word' });
    expect(getToken()).toBe('tok-1');
    expect(auth.status).toBe(AUTH_STATUS.AUTHENTICATED);
    expect(screen.getByRole('heading', { name: 'Dashboard target' })).toBeTruthy();
  });

  it.each([
    ['no remembered path', '/admin/login'],
    ['a non-admin path', { pathname: '/admin/login', state: { from: '/projects' } }],
    ['the login page', { pathname: '/admin/login', state: { from: '/admin/login' } }],
  ])('navigates to /admin with %s (30.3)', async (_label, entry) => {
    vi.mocked(authApi.login).mockResolvedValue({ token: 'tok-1', admin: ADMIN });
    const user = userEvent.setup();
    renderLogin(entry);
    await fillAndSubmit(user, 'admin@example.com', 'secret');
    await waitFor(() => expect(path()).toBe('/admin'));
  });

  it.each([
    [401, 'Invalid email or password'],
    [429, 'Too many login attempts. Please try again later.'],
  ])('on %i shows the server message, clears only the password and stores no token (30.4, 8.8)', async (status, message) => {
    vi.mocked(authApi.login).mockRejectedValue(new ApiError({ status, code: 'ERR', message }));
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user, 'admin@example.com', 'wrong');

    expect(await screen.findByText(message)).toBeTruthy();
    expect(emailInput().value).toBe('admin@example.com');
    expect(passwordInput().value).toBe('');
    expect(getToken()).toBeNull();
    expect(auth.status).toBe(AUTH_STATUS.UNAUTHENTICATED);
    expect(path()).toBe('/admin/login');
    expect(submitButton().disabled).toBe(false);
  });

  it('on 400 shows the details next to the matching fields and keeps the email (30.9)', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'password', reason: 'too_long', message: 'Must be at most 72 bytes' }],
      }),
    );
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user, 'admin@example.com', 'secret');

    await waitFor(() => expect(document.getElementById('login-password-error')).not.toBeNull());
    expect(document.getElementById('login-password-error').textContent).toBe('Must be at most 72 bytes');
    expect(passwordInput().getAttribute('aria-invalid')).toBe('true');
    expect(emailInput().value).toBe('admin@example.com');
    expect(auth.status).toBe(AUTH_STATUS.UNAUTHENTICATED);
  });

  it.each([
    ['a network error', new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE })],
    ['a 500 response', new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Internal error' })],
    ['a 503 response', new ApiError({ status: 503, code: 'UNAVAILABLE', message: 'Unavailable' })],
  ])('on %s shows an error Notification, keeps the email and re-enables submit (30.10)', async (_label, error) => {
    vi.mocked(authApi.login).mockRejectedValue(error);
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user, 'admin@example.com', 'secret');

    const notification = await screen.findByText(LOGIN_UNAVAILABLE_MESSAGE);
    expect(notification.closest('[role="alert"]')).not.toBeNull();
    expect(emailInput().value).toBe('admin@example.com');
    expect(submitButton().disabled).toBe(false);
    expect(getToken()).toBeNull();
    expect(auth.status).toBe(AUTH_STATUS.UNAUTHENTICATED);
  });

  it('disables the button with a loading label and sends one request while pending (30.8)', async () => {
    let resolveLogin;
    vi.mocked(authApi.login).mockImplementation(() => new Promise((r) => (resolveLogin = r)));
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user, 'admin@example.com', 'secret');

    const button = submitButton();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(LOGIN_PENDING_LABEL);
    expect(button.getAttribute('aria-busy')).toBe('true');

    await user.type(passwordInput(), '{Enter}');
    expect(authApi.login).toHaveBeenCalledTimes(1);

    await act(async () => resolveLogin({ token: 'tok-1', admin: ADMIN }));
    await waitFor(() => expect(path()).toBe('/admin'));
    expect(authApi.login).toHaveBeenCalledTimes(1);
  });
});

describe('LoginPage session expiry message (6.4)', () => {
  it('shows the message once after an expiry and returns to the remembered path after login', async () => {
    setToken('expired');
    vi.mocked(authApi.me).mockRejectedValue(new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'Expired' }));
    vi.mocked(authApi.login).mockResolvedValue({ token: 'tok-2', admin: ADMIN });
    const user = userEvent.setup();
    renderLogin('/admin/skills?page=3');

    expect(await screen.findByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy();
    expect(path()).toBe('/admin/login');
    expect(screen.getAllByText(SESSION_EXPIRED_MESSAGE)).toHaveLength(1);
    // Copied into the page and cleared in the Auth_Context, so a later visit shows nothing.
    await waitFor(() => expect(auth.sessionMessage).toBeNull());
    expect(screen.getByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy();

    await fillAndSubmit(user, 'admin@example.com', 'secret');
    await waitFor(() => expect(path()).toBe('/admin/skills?page=3'));
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).toBeNull();
    expect(auth.sessionMessage).toBeNull();
  });

  it('hides the message when a new attempt starts', async () => {
    setToken('expired');
    vi.mocked(authApi.me).mockRejectedValue(new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'Expired' }));
    vi.mocked(authApi.login).mockRejectedValue(new ApiError({ status: 401, code: 'INVALID', message: 'Invalid email or password' }));
    const user = userEvent.setup();
    renderLogin('/admin/messages');

    expect(await screen.findByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy();
    await fillAndSubmit(user, 'admin@example.com', 'wrong');

    expect(await screen.findByText('Invalid email or password')).toBeTruthy();
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).toBeNull();
  });

  it('shows no message on a normal visit', () => {
    renderLogin();
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).toBeNull();
  });
});

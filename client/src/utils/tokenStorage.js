// Storage for the admin JWT (design: "JWT storage in browser").
//
// The token lives in sessionStorage under TOKEN_STORAGE_KEY, so it survives reloads but ends
// when the tab closes. When sessionStorage is unavailable or throws (private mode, disabled
// storage, quota), the token is kept in memory for the life of the page instead.
//
// Only the Auth_Context and the API_Client may import this module (Requirement 32.10).

export const TOKEN_STORAGE_KEY = 'portfolio.admin.token';

/** Used when sessionStorage cannot store the token. */
let memoryToken = null;

function getStorage() {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    // Accessing window.sessionStorage itself can throw (SecurityError).
    return null;
  }
}

/**
 * Returns the stored JWT, or null when none is stored.
 * @returns {string | null}
 */
export function getToken() {
  let stored = null;
  const storage = getStorage();
  if (storage) {
    try {
      stored = storage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      stored = null;
    }
  }
  const token = stored ?? memoryToken;
  return typeof token === 'string' && token !== '' ? token : null;
}

/**
 * Stores the JWT. An empty or non-string value clears the stored token.
 * @param {string} token
 */
export function setToken(token) {
  if (typeof token !== 'string' || token === '') {
    clearToken();
    return;
  }
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(TOKEN_STORAGE_KEY, token);
      memoryToken = null;
      return;
    } catch {
      // Fall through to the in-memory copy.
    }
  }
  memoryToken = token;
}

/** Removes the stored JWT from sessionStorage and from memory. */
export function clearToken() {
  memoryToken = null;
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Nothing else to clear.
    }
  }
}

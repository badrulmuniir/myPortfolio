// Shared Settings and Profile data for the Public_Site (design: Contexts; Requirement 21.9).
//
// Exported API:
//   <SiteDataProvider>   sends GET /settings and GET /profile once when it mounts and shares
//                        the results, so the layout (footer, document title) and the Home,
//                        About and Contact pages do not send their own requests.
//   useSiteData()        → {
//     settings,          Settings object, or null while loading or after a failure
//     profile,           Profile object, or null while loading or after a failure
//     settingsState,     { loading, error, retry } for GET /settings
//     profileState,      { loading, error, retry } for GET /profile
//     refreshSettings,   repeats GET /settings (same function as settingsState.retry)
//     refreshProfile,    repeats GET /profile (same function as profileState.retry)
//   }
//   Throws when called outside a SiteDataProvider.
//
// Error handling:
//   `error` is the ApiError thrown by the API_Client. A Profile 404 (no profile row yet) is an
//   error like any other: pages that need the Profile show the error state with Retry, while
//   the layout only omits the items that depend on the missing data (21.9).
//   The two requests are independent, so one failing does not hide the other's data.
//
// Freshness: the provider wraps the public route tree only, so returning from the
// Admin_Dashboard to a public page mounts it again and fetches current values (11.6).
// refreshSettings/refreshProfile exist for callers that need a reload without remounting.

import { createContext, useContext, useMemo } from 'react';
import { useFetch } from '../hooks/useFetch.js';
import * as settingsApi from '../api/settingsApi.js';
import * as profileApi from '../api/profileApi.js';

const SiteDataContext = createContext(null);
SiteDataContext.displayName = 'SiteDataContext';

const fetchSettings = (signal) => settingsApi.get({ signal });
const fetchProfile = (signal) => profileApi.get({ signal });

export function SiteDataProvider({ children }) {
  const settings = useFetch(fetchSettings, []);
  const profile = useFetch(fetchProfile, []);

  const value = useMemo(
    () => ({
      settings: settings.data,
      profile: profile.data,
      settingsState: { loading: settings.loading, error: settings.error, retry: settings.retry },
      profileState: { loading: profile.loading, error: profile.error, retry: profile.retry },
      refreshSettings: settings.retry,
      refreshProfile: profile.retry,
    }),
    [
      settings.data,
      settings.loading,
      settings.error,
      settings.retry,
      profile.data,
      profile.loading,
      profile.error,
      profile.retry,
    ],
  );

  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>;
}

/** Returns the shared Settings and Profile data. Must be used inside a SiteDataProvider. */
export function useSiteData() {
  const value = useContext(SiteDataContext);
  if (value === null) {
    throw new Error('useSiteData must be used inside a <SiteDataProvider>.');
  }
  return value;
}

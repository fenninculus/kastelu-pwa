import { getMeta, setMeta } from './db.js';

const DRIVE_FILE_ID = import.meta.env.VITE_DRIVE_FILE_ID || '1GjC9WymeRitiAdHhZWQdgTFY7hOT15QY';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SCOPE = 'https://www.googleapis.com/auth/drive';

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

async function loadStoredToken() {
  try {
    const stored = await getMeta('authToken');
    if (stored && stored.accessToken && stored.expiry > Date.now()) {
      accessToken = stored.accessToken;
      tokenExpiry = stored.expiry;
      console.log('[Auth] Restored token from IndexedDB, expires in', Math.round((tokenExpiry - Date.now()) / 60000), 'min');
      return true;
    }
  } catch {}
  return false;
}

async function storeToken() {
  try {
    await setMeta('authToken', { accessToken, expiry: tokenExpiry });
    console.log('[Auth] Token stored in IndexedDB');
  } catch {}
}

async function clearStoredToken() {
  accessToken = null;
  tokenExpiry = 0;
  try { await setMeta('authToken', null); } catch {}
}

export async function initAuth() {
  if (!CLIENT_ID) return false;
  await loadStoredToken();
  return new Promise((resolve) => {
    const check = () => {
      if (window.google?.accounts?.oauth2) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          callback: () => {},
        });
        resolve(true);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

export function requestToken() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('Auth not initialized'));
      return;
    }
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      accessToken = response.access_token;
      tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000;
      console.log('[Auth] Got new token, expires in', Math.round((tokenExpiry - Date.now()) / 60000), 'min');
      storeToken();
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

export function hasToken() {
  return !!accessToken && Date.now() < tokenExpiry;
}

export async function clearToken() {
  if (accessToken) {
    window.google?.accounts?.oauth2?.revoke?.(accessToken);
  }
  await clearStoredToken();
}

async function ensureToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  const restored = await loadStoredToken();
  if (restored) return accessToken;
  console.log('[Drive] No valid token in memory or IndexedDB, requesting new one...');
  return await requestToken();
}

async function driveRequest(path, options = {}) {
  let token = await ensureToken();
  const url = path.startsWith('http') ? path : `https://www.googleapis.com/drive/v3/files/${DRIVE_FILE_ID}${path}`;
  let res = await fetch(url, {
    ...options,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (res.status === 401) {
    console.log('[Drive] 401 — token expired, requesting new one...');
    await clearStoredToken();
    token = await requestToken();
    res = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text}`);
  }
  return res;
}

export async function getFileModifiedTime() {
  const res = await driveRequest('?fields=modifiedTime');
  const data = await res.json();
  return data.modifiedTime;
}

export async function readPlantData() {
  const res = await driveRequest('?alt=media');
  return res.json();
}

export async function writePlantData(data) {
  const body = JSON.stringify(data, null, 2);
  console.log('[Drive] writePlantData: body size', body.length, 'bytes');

  const token = await ensureToken();

  const url = `https://www.googleapis.com/upload/drive/v3/files/${DRIVE_FILE_ID}?uploadType=media`;

  let res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (res.status === 401) {
    console.log('[Drive] Write got 401, refreshing token...');
    await clearStoredToken();
    const newToken = await requestToken();
    res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${newToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  }

  const responseText = await res.text();
  console.log('[Drive] Write response:', res.status, responseText.slice(0, 300));

  if (!res.ok) {
    throw new Error(`Drive API ${res.status}: ${responseText}`);
  }
}

// Supabase Proxy Handler
// Intercepta llamadas HTTP a Supabase y las redirige al proxy si es necesario
// Esto es transparente para el resto de la app

import { supabase } from './supabaseClient';

const PROXY_ENABLED = import.meta.env.VITE_USE_PROXY === 'true';
const PROXY_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1/db-proxy';

let proxyConnected = false;
let directConnected = !PROXY_ENABLED;

// Intercepción de fetch para redirigir a proxy
const originalFetch = globalThis.fetch;

globalThis.fetch = async (...args) => {
  const [resource, config] = args;
  const url = typeof resource === 'string' ? resource : resource.url;

  if (!url || !url.includes('supabase.co/rest/v1')) {
    return originalFetch(...args);
  }

  const isProxyCall = url.includes('/db-proxy');
  if (isProxyCall) {
    return originalFetch(...args);
  }

  if (!PROXY_ENABLED) {
    return originalFetch(...args);
  }

  try {
    if (!directConnected) {
      return originalFetch(...args);
    }

    const response = await originalFetch(...args);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    directConnected = true;
    return response;
  } catch (err) {
    if (directConnected && !proxyConnected) {
      console.warn('Direct Supabase connection failed, switching to proxy:', err.message);
      directConnected = false;
    }

    if (PROXY_ENABLED && !directConnected) {
      return await proxyFetch(resource, config);
    }

    throw err;
  }
};

async function proxyFetch(resource, config) {
  const url = typeof resource === 'string' ? resource : resource.url;
  const method = (config?.method || 'GET').toUpperCase();
  const headers = new Headers(config?.headers || {});

  const session = await supabase.auth.getSession();
  const token = session?.data?.session?.access_token;

  if (!token) {
    throw new Error('Not authenticated for proxy request');
  }

  headers.set('Authorization', `Bearer ${token}`);

  let operation = 'select';
  let table = '';
  let data = null;
  let filters = {};

  const urlMatch = url.match(/\/rest\/v1\/([^/?]+)/);
  if (urlMatch) {
    table = urlMatch[1];
  }

  if (method === 'POST') {
    operation = 'insert';
    try {
      data = JSON.parse(config?.body || '{}');
    } catch {
      data = null;
    }
  } else if (method === 'PATCH') {
    operation = 'update';
    try {
      data = JSON.parse(config?.body || '{}');
    } catch {
      data = null;
    }

    const queryPart = url.split('?')[1];
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      for (const [key, value] of params) {
        if (key.startsWith('filter_')) {
          const filterKey = key.replace('filter_', '');
          filters[filterKey] = value;
        } else if (key === 'eq') {
          const [col, val] = value.split('.');
          if (col && val) filters[col] = val;
        }
      }
    }
  } else if (method === 'DELETE') {
    operation = 'delete';

    const queryPart = url.split('?')[1];
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      for (const [key, value] of params) {
        filters[key] = value;
      }
    }
  } else if (method === 'GET') {
    operation = 'select';
  }

  const proxyRequest = {
    operation,
    table,
    data,
    filters
  };

  const proxyResponse = await originalFetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(proxyRequest)
  });

  if (!proxyResponse.ok) {
    throw new Error(`Proxy error: ${proxyResponse.statusText}`);
  }

  proxyConnected = true;

  const result = await proxyResponse.json();
  if (!result.ok) {
    throw new Error(result.error);
  }

  const responseData = JSON.stringify(result.data || []);
  return new Response(responseData, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'x-proxied': 'true'
    }
  });
}

export { PROXY_ENABLED, proxyConnected };

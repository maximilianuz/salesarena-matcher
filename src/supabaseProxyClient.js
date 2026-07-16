import { supabase } from './supabaseClient';

const PROXY_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') + '/functions/v1/db-proxy';

export const dbProxy = {
  async select(table, options = {}) {
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        operation: 'select',
        table,
        filters: options.filters || {},
        columns: options.columns
      })
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return { data: result.data, error: null };
  },

  async insert(table, data) {
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        operation: 'insert',
        table,
        data
      })
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return { data: result.data, error: null };
  },

  async update(table, data, filters) {
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        operation: 'update',
        table,
        data,
        filters
      })
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return { data: result.data, error: null };
  },

  async delete(table, filters) {
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        operation: 'delete',
        table,
        filters
      })
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return { data: result.data, error: null };
  },

  async upsert(table, data) {
    const session = await supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        operation: 'upsert',
        table,
        data
      })
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return { data: result.data, error: null };
  }
};

// Helper para convertir métodos de supabase a operaciones de proxy
export const createProxyTable = (tableName) => ({
  select: (columns = '*') => ({
    eq: (col, val) => ({
      then: async (resolve) => {
        const result = await dbProxy.select(tableName, {
          filters: { [col]: val },
          columns
        });
        resolve(result);
      }
    }),
    async then(resolve) {
      const result = await dbProxy.select(tableName, { columns });
      resolve(result);
    }
  }),

  insert: (data) => ({
    then: async (resolve) => {
      const result = await dbProxy.insert(tableName, data);
      resolve(result);
    }
  }),

  update: (data) => ({
    eq: (col, val) => ({
      then: async (resolve) => {
        const result = await dbProxy.update(tableName, data, { [col]: val });
        resolve(result);
      }
    })
  }),

  upsert: (data) => ({
    then: async (resolve) => {
      const result = await dbProxy.upsert(tableName, data);
      resolve(result);
    }
  }),

  delete: () => ({
    eq: (col, val) => ({
      then: async (resolve) => {
        const result = await dbProxy.delete(tableName, { [col]: val });
        resolve(result);
      }
    })
  })
});

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as jose from 'npm:jose@5';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface ProxyRequest {
  operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  table: string;
  data?: Record<string, any>;
  filters?: Record<string, any>;
  columns?: string;
}

const getJwtSecret = (): string => {
  return Deno.env.get('JWT_SECRET') || Deno.env.get('SUPABASE_JWT_SECRET') || '';
};

const validateAuth = async (authHeader: string | null) => {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7);

  try {
    const secret = getJwtSecret();
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }

    const encoder = new TextEncoder();
    const key = await jose.importSPKI(secret, 'RS256').catch(() =>
      jose.importSecret(secret, 'HS256')
    );

    const { payload } = await jose.jwtVerify(token, key);
    if (!payload.sub) throw new Error('Invalid token');
    return { id: payload.sub, email: payload.email };
  } catch (err) {
    throw new Error(`Auth failed: ${String(err)}`);
  }
};

const applyFilters = (query: any, filters: Record<string, any> = {}) => {
  for (const [key, value] of Object.entries(filters)) {
    if (value === null) {
      query = query.is(key, null);
    } else if (typeof value === 'object' && value.operator) {
      const { operator, operand } = value;
      query = query[operator](key, operand);
    } else {
      query = query.eq(key, value);
    }
  }
  return query;
};

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    const authHeader = req.headers.get('Authorization');
    const user = await validateAuth(authHeader);

    const body: ProxyRequest = await req.json();
    const { operation, table, data, filters, columns } = body;

    if (!operation || !table) {
      throw new Error('Missing operation or table');
    }

    let query = supabase.from(table);
    let result;

    switch (operation) {
      case 'select':
        query = query.select(columns || '*');
        query = applyFilters(query, filters);
        result = await query;
        break;

      case 'insert':
        if (!data) throw new Error('Data required for insert');
        result = await query.insert(data);
        break;

      case 'update':
        if (!data) throw new Error('Data required for update');
        query = applyFilters(query, filters);
        result = await query.update(data);
        break;

      case 'delete':
        query = applyFilters(query, filters);
        result = await query.delete();
        break;

      case 'upsert':
        if (!data) throw new Error('Data required for upsert');
        result = await query.upsert(data);
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    if (result.error) {
      throw result.error;
    }

    return new Response(JSON.stringify({ ok: true, data: result.data }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});

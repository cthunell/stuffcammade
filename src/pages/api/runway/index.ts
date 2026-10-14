import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { clearState, getData, getState, setData, setState } from '../../../lib/runway-store';
import { json } from '../../../lib/private-response';

export const prerender = false;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const MAX_BODY = 512 * 1024;

async function readBody(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// GET: the forecast data plus your saved edits.
export const GET: APIRoute = async ({ request }) => {
  if (!(await getSession(request))) return json({ error: 'unauthorized' }, 401);
  const [data, state] = await Promise.all([getData(), getState()]);
  return json({ data, state });
};

// PUT: save your edits (inputs, bill checkboxes, budget).
export const PUT: APIRoute = async ({ request }) => {
  if (!(await getSession(request))) return json({ error: 'unauthorized' }, 401);
  const body = await readBody(request);
  if (!isObject(body)) return json({ error: 'bad request' }, 400);
  await setState({ ...body, savedAt: new Date().toISOString() });
  return json({ ok: true });
};

// POST: import (replace) the forecast data. Clears saved edits so the new defaults apply.
export const POST: APIRoute = async ({ request }) => {
  if (!(await getSession(request))) return json({ error: 'unauthorized' }, 401);
  const body = await readBody(request);
  if (!isObject(body) || !Array.isArray(body.items) || !Array.isArray(body.budget) || !isObject(body.settings)) {
    return json({ error: 'That file is not runway forecast data.' }, 400);
  }
  await Promise.all([setData(body), clearState()]);
  return json({ ok: true });
};

// DELETE: forget your edits and go back to the imported starting numbers.
export const DELETE: APIRoute = async ({ request }) => {
  if (!(await getSession(request))) return json({ error: 'unauthorized' }, 401);
  await clearState();
  return json({ ok: true });
};

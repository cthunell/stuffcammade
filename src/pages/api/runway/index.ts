import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { deleteDoc, getDoc, getLegacy, setDoc } from '../../../lib/runway-store';
import { json } from '../../../lib/private-response';

export const prerender = false;

const MAX_BODY = 512 * 1024;

const isDoc = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const d = v as Record<string, unknown>;
  return d.version === 2 && ['checkins', 'income', 'bills', 'categories'].every((k) => Array.isArray(d[k]));
};

async function signedInEmail(request: Request) {
  const session = await getSession(request);
  return session?.user?.email ?? null;
}

// GET: your Runway document. With no document yet, also the first version's data, if any.
export const GET: APIRoute = async ({ request }) => {
  const email = await signedInEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const doc = await getDoc(email);
  return json({ doc, legacy: doc ? null : await getLegacy() });
};

// PUT: save your whole document.
export const PUT: APIRoute = async ({ request }) => {
  const email = await signedInEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!isDoc(doc)) return json({ error: 'That is not Runway data.' }, 400);
  await setDoc(email, { ...doc, savedAt: new Date().toISOString() });
  return json({ ok: true });
};

// DELETE: erase your document and start blank.
export const DELETE: APIRoute = async ({ request }) => {
  const email = await signedInEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);
  await deleteDoc(email);
  return json({ ok: true });
};

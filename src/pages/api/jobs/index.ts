import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getSession } from '../../../lib/auth';
import { getJobs, setJobs } from '../../../lib/jobs-store';
import { json } from '../../../lib/private-response';

export const prerender = false;

const MAX_BODY = 1024 * 1024;

const isJob = (v: unknown) =>
  typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).id === 'string' &&
  typeof (v as Record<string, unknown>).company === 'string';

// Browser: the Google sign-in cookie. Scripts (such as Claude): `Authorization: Bearer <JOBS_API_TOKEN>`,
// which acts as the allowed account. Without JOBS_API_TOKEN set in Vercel, only sign-in works.
async function callerEmail(request: Request) {
  const session = await getSession(request);
  if (session?.user?.email) return session.user.email;
  const token = process.env.JOBS_API_TOKEN ?? '';
  const sent = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const owner = (process.env.ALLOWED_EMAIL ?? '').trim();
  if (token.length >= 32 && owner && sent.length === token.length && timingSafeEqual(Buffer.from(sent), Buffer.from(token))) {
    return owner;
  }
  return null;
}

// GET: your pipeline, or null before the first save.
export const GET: APIRoute = async ({ request }) => {
  const email = await callerEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);
  return json({ doc: (await getJobs(email)) ?? null });
};

// PUT: save the whole pipeline. `baseRev` must match the stored revision, otherwise the
// caller is working from an old copy and gets the current one back (409).
export const PUT: APIRoute = async ({ request }) => {
  const email = await callerEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
  let body: { version?: unknown; baseRev?: unknown; jobs?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (body.version !== 1 || typeof body.baseRev !== 'number' || !Array.isArray(body.jobs) || !body.jobs.every(isJob)) {
    return json({ error: 'That is not job pipeline data.' }, 400);
  }
  const current = await getJobs(email);
  const currentRev = current?.rev ?? 0;
  if (body.baseRev !== currentRev) return json({ error: 'conflict', doc: current ?? null }, 409);
  const rev = currentRev + 1;
  await setJobs(email, { version: 1, rev, jobs: body.jobs as Record<string, unknown>[], savedAt: new Date().toISOString() });
  return json({ ok: true, rev });
};

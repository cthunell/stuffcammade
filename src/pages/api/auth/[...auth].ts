import type { APIRoute } from 'astro';
import { handleAuth } from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = ({ request }) => handleAuth(request);
export const POST: APIRoute = ({ request }) => handleAuth(request);

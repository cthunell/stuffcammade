import { Redis } from '@upstash/redis';

// Forecast data and saved edits live in Upstash Redis, never in the repo.
// The Vercel Upstash integration sets KV_REST_API_*; a direct Upstash setup sets UPSTASH_REDIS_REST_*.
let client: Redis | undefined;
export function redis() {
  client ??= new Redis({
    url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '',
    token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  });
  return client;
}

// Each signed-in person's Runway document, keyed by their email.
const docKey = (email: string) => `runway:v2:${email.toLowerCase()}`;
export const getDoc = (email: string) => redis().get<Record<string, unknown>>(docKey(email));
export const setDoc = (email: string, doc: Record<string, unknown>) => redis().set(docKey(email), doc);
export const deleteDoc = (email: string) => redis().del(docKey(email));

// The first version stored one shared forecast plus edits. Read only, to bring it over.
export const getLegacy = async () => {
  const [data, state] = await Promise.all([
    redis().get<Record<string, unknown>>('runway:data'),
    redis().get<Record<string, unknown>>('runway:state'),
  ]);
  return data ? { data, state } : null;
};

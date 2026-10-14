import { Redis } from '@upstash/redis';

// Forecast data and saved edits live in Upstash Redis, never in the repo.
// The Vercel Upstash integration sets KV_REST_API_*; a direct Upstash setup sets UPSTASH_REDIS_REST_*.
let client: Redis | undefined;
function redis() {
  client ??= new Redis({
    url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '',
    token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
  });
  return client;
}

const DATA_KEY = 'runway:data';
const STATE_KEY = 'runway:state';

export const getData = () => redis().get<Record<string, unknown>>(DATA_KEY);
export const setData = (data: Record<string, unknown>) => redis().set(DATA_KEY, data);
export const getState = () => redis().get<Record<string, unknown>>(STATE_KEY);
export const setState = (state: Record<string, unknown>) => redis().set(STATE_KEY, state);
export const clearState = () => redis().del(STATE_KEY);

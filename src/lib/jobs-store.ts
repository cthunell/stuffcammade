import { redis } from './runway-store';

// The job pipeline lives in Upstash Redis, never in the repo. One document per signed-in
// person, keyed by their email. `rev` counts saves so a stale tab cannot overwrite newer data.
export type JobsDoc = { version: 1; rev: number; jobs: Record<string, unknown>[]; savedAt?: string };

const docKey = (email: string) => `jobs:v1:${email.toLowerCase()}`;
export const getJobs = (email: string) => redis().get<JobsDoc>(docKey(email));
export const setJobs = (email: string, doc: JobsDoc) => redis().set(docKey(email), doc);

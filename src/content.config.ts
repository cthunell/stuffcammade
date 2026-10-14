import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    status: z.enum(['idea', 'prototype', 'in progress', 'live', 'archived']),
    tags: z.array(z.string()).default([]),
    started: z.coerce.date(),
    link: z.url().optional(),
    featured: z.boolean().default(false),
  }),
});

export const collections = { projects };

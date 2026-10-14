# Stuff Cam Made

Source for [stuffcammade.com](https://stuffcammade.com): a home for the projects
I build for personal growth and getting organized.

Built with [Astro](https://astro.build) as a static site. Every change goes through
GitHub, so any version can be reviewed or reverted.

## Run it locally

Requires Node 22.12 or newer.

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # outputs the site to dist/
npm run preview  # serves the built site
```

## Add a project

Create a Markdown file in `src/content/projects/`. The file name becomes the URL,
so `my-project.md` is served at `/projects/my-project/`.

```md
---
title: My Project
summary: One line shown on the project card.
status: in progress   # idea | prototype | in progress | live | archived
tags: [tag1, tag2]
started: 2026-01-15
link: https://example.com   # optional, link out to the live thing
featured: true              # optional, show it on the home page
---

Write about the project here.
```

The fields are checked at build time (see `src/content.config.ts`), so a typo
fails the build instead of shipping a broken page.

## Layout

```
src/
  content.config.ts        project fields and validation
  content/projects/        one Markdown file per project
  layouts/Base.astro       shared page shell, header and footer
  components/              reusable pieces such as ProjectCard
  pages/                   routes: home, projects index, project page
  pages/runway.astro       private cash runway forecast (sign-in required)
  pages/api/               sign-in routes and the runway data API
  lib/                     sign-in config and the private data store
  scripts/runway.js        the runway forecast's in-browser logic
  styles/global.css        colors, type, light and dark themes
public/                    files served as-is (favicon, images)
```

## Private pages

`/runway` is locked behind Google sign-in, and only the account in `ALLOWED_EMAIL`
gets in. It uses [Auth.js](https://authjs.dev) for sign-in and Upstash Redis for
storage. Its numbers are never in this repo: they live in Redis, are loaded once
with the page's "Import data file" button, and every edit on the page auto-saves
back there. "Download backup" on the page saves a copy of the data and edits.

Everything else on the site is still prerendered as static pages; only `/runway`
and `/api/*` run as Vercel functions. The settings it needs are listed in
`.env.example`; set them in Vercel, or in a local `.env` to run it with
`npm run dev` (add `http://localhost:4321/api/auth/callback/google` as a redirect
URI on the Google OAuth client).

## Deploying

The site is hosted on Vercel. Every push to `main` deploys to production, and
every pull request gets its own preview link. Undo a change by reverting its
commit on `main`, or instantly by promoting an earlier deployment in Vercel.

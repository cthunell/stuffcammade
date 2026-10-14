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
  styles/global.css        colors, type, light and dark themes
public/                    files served as-is (favicon, images)
```

## Deploying

The site is hosted on Vercel. Every push to `main` deploys to production, and
every pull request gets its own preview link. Undo a change by reverting its
commit on `main`, or instantly by promoting an earlier deployment in Vercel.

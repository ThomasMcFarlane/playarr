import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

/**
 * Installation and setup documentation.
 *
 * `order` drives sidebar position within a `group`; both are required so a new
 * page can never land in an arbitrary slot. `summary` is reused as the page
 * meta description and as the blurb on index pages.
 */
const docs = defineCollection({
  loader: glob({ base: './src/content/docs', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    group: z.enum(['Install', 'Setup', 'Clients', 'Operate']),
    order: z.number(),
    /** Shown as a badge beside the sidebar entry. */
    badge: z.string().optional(),
    draft: z.boolean().default(false),
  }),
})

export const collections = { docs }

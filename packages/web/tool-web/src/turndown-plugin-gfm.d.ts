/**
 * Ambient declaration for `@joplin/turndown-plugin-gfm`, which ships no types.
 * The package's `gfm` export is a standard turndown plugin (see
 * `@types/turndown`'s `TurndownService.Plugin`).
 */
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown'

  /** GitHub-flavored markdown plugin (tables, strikethrough) for turndown. */
  export const gfm: TurndownService.Plugin
}

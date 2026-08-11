/** Simple `{{key}}` substitution. Missing keys become empty strings. */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

export const DISCORD_CONTENT_MAX = 2000;

export function truncateContent(content: string, max = DISCORD_CONTENT_MAX): string {
  if (content.length <= max) return content;
  return content.slice(0, max);
}

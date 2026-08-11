import { truncateContent } from './template';

export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const h = u.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Accept only Discord incoming-webhook hosts (plus the SSRF guard above). */
export function isDiscordWebhookUrl(raw: string): boolean {
  if (!isAllowedUrl(raw)) return false;
  try {
    const u = new URL(raw);
    const hostOk =
      u.hostname === 'discord.com' ||
      u.hostname === 'discordapp.com' ||
      u.hostname.endsWith('.discord.com') ||
      u.hostname.endsWith('.discordapp.com');
    if (!hostOk) return false;
    return /^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

export async function postDiscordMessage(
  url: string,
  content: string,
  username: string | undefined,
  log: (msg: string, ...args: unknown[]) => void,
): Promise<void> {
  const body: Record<string, string> = {
    content: truncateContent(content),
  };
  if (username?.trim()) {
    body.username = username.trim().slice(0, 80);
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log(`DiscordPlugin: POST returned ${res.status}${text ? ` — ${text}` : ''}`);
    }
  } catch (err) {
    log(`DiscordPlugin: fetch error — ${(err as Error).message}`);
  }
}

import {
  ListmonkNotConfiguredError,
  ListmonkUpstreamError,
  ListmonkUrlNotAllowedError,
} from './listmonk-errors';

export interface ListmonkConfig {
  url: string;
  authHeader: string;
  listIds: number[];
  subscribeOn: 'contact.created' | 'form.submitted' | 'both';
}

export interface ListmonkRemoteList {
  id: number;
  name: string;
  type: string;
  status: string;
  subscriberCount: number;
}

export interface ListmonkSubscriberList {
  id: number;
  name: string;
  subscriptionStatus: string;
}

export interface ListmonkSubscriber {
  id: number;
  email: string;
  name: string;
  status: string;
  lists: ListmonkSubscriberList[];
}

export type ListmonkCampaignStatus =
  'draft' | 'running' | 'scheduled' | 'paused' | 'cancelled' | 'finished';

export interface ListmonkCampaign {
  id: number;
  uuid: string;
  name: string;
  subject: string;
  fromEmail: string;
  status: ListmonkCampaignStatus;
  type: 'regular' | 'optin';
  contentType: 'richtext' | 'html' | 'markdown' | 'plain' | 'visual';
  body: string;
  lists: { id: number; name: string }[];
  templateId: number | null;
  tags: string[];
  sendAt: string | null;
  startedAt: string | null;
  toSend: number;
  sent: number;
  views: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListmonkTemplate {
  id: number;
  name: string;
  type: string;
  isDefault: boolean;
  /** Present on GET /templates/:id — HTML with {{ template "content" . }} */
  body?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListmonkCampaignAnalyticsItem {
  campaignId: number;
  count: number;
  timestamp: string;
}

export interface CampaignPreviewInput {
  templateId: number;
  contentType: 'richtext' | 'html' | 'markdown' | 'plain';
  body: string;
  /** When set, uses Listmonk's accurate campaign preview endpoint. */
  campaignId?: number;
}

export interface CreateCampaignInput {
  name: string;
  subject: string;
  lists: number[];
  fromEmail?: string;
  type: 'regular' | 'optin';
  contentType: 'richtext' | 'html' | 'markdown' | 'plain';
  body: string;
  templateId?: number;
  tags?: string[];
  sendAt?: string;
  headers?: Record<string, string>[];
}

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

export function parseConfig(config: Record<string, string | undefined>): ListmonkConfig | null {
  const url = config['LISTMONK_URL'];
  const user = config['LISTMONK_USER'];
  const pass = config['LISTMONK_PASSWORD'];

  if (!url || !user || !pass) return null;

  const rawIds = config['LISTMONK_LIST_IDS'] ?? '';
  const listIds = rawIds
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);

  const subscribeOn = (['contact.created', 'form.submitted', 'both'] as const).includes(
    config['LISTMONK_SUBSCRIBE_ON'] as ListmonkConfig['subscribeOn'],
  )
    ? (config['LISTMONK_SUBSCRIBE_ON'] as ListmonkConfig['subscribeOn'])
    : 'both';

  return {
    url: url.replace(/\/$/, ''),
    authHeader: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
    listIds: listIds.length > 0 ? listIds : [1],
    subscribeOn,
  };
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

async function listmonkFetch(
  cfg: ListmonkConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!isAllowedUrl(cfg.url)) {
    throw new ListmonkUrlNotAllowedError();
  }
  const headers: Record<string, string> = {
    Authorization: cfg.authHeader,
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${cfg.url}${path}`, {
    ...init,
    headers,
  });
}

function requireConfig(config: Record<string, string | undefined>): ListmonkConfig {
  const cfg = parseConfig(config);
  if (!cfg) throw new ListmonkNotConfiguredError();
  return cfg;
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  throw new ListmonkUpstreamError(res.status, text);
}

type RawCampaign = {
  id: number;
  uuid?: string;
  name: string;
  subject: string;
  from_email?: string;
  status: string;
  type: string;
  content_type?: string;
  body?: string;
  lists?: Array<{ id: number; name: string }>;
  template_id?: number | null;
  tags?: string[];
  send_at?: string | null;
  started_at?: string | null;
  to_send?: number;
  sent?: number;
  views?: number;
  clicks?: number;
  created_at?: string;
  updated_at?: string;
};

function mapCampaign(raw: RawCampaign): ListmonkCampaign {
  return {
    id: raw.id,
    uuid: raw.uuid ?? String(raw.id),
    name: raw.name,
    subject: raw.subject,
    fromEmail: raw.from_email ?? '',
    status: raw.status as ListmonkCampaignStatus,
    type: (raw.type as ListmonkCampaign['type']) ?? 'regular',
    contentType: (raw.content_type as ListmonkCampaign['contentType']) ?? 'richtext',
    body: raw.body ?? '',
    lists: (raw.lists ?? []).map((l) => ({ id: l.id, name: l.name })),
    templateId: raw.template_id ?? null,
    tags: raw.tags ?? [],
    sendAt: raw.send_at ?? null,
    startedAt: raw.started_at ?? null,
    toSend: raw.to_send ?? 0,
    sent: raw.sent ?? 0,
    views: raw.views ?? 0,
    clicks: raw.clicks ?? 0,
    createdAt: raw.created_at ?? '',
    updatedAt: raw.updated_at ?? '',
  };
}

function mapSubscriber(raw: {
  id: number;
  email: string;
  name: string;
  status: string;
  lists?: Array<{
    id: number;
    name: string;
    subscription_status?: string;
  }>;
}): ListmonkSubscriber {
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    status: raw.status,
    lists: (raw.lists ?? []).map((list) => ({
      id: list.id,
      name: list.name,
      subscriptionStatus: list.subscription_status ?? 'unconfirmed',
    })),
  };
}

export async function fetchAllSubscribers(
  config: Record<string, string | undefined>,
): Promise<ListmonkSubscriber[]> {
  const cfg = requireConfig(config);
  const res = await listmonkFetch(cfg, '/api/subscribers?per_page=all');
  await assertOk(res);
  const json = await res.json();
  return (json?.data?.results ?? []).map(mapSubscriber);
}

export async function lookupSubscribersByEmails(
  config: Record<string, string | undefined>,
  emails: string[],
): Promise<Map<string, ListmonkSubscriber>> {
  const cfg = requireConfig(config);
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const result = new Map<string, ListmonkSubscriber>();
  if (unique.length === 0) return result;

  const batchSize = 40;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const query = batch
      .map((email) => `subscribers.email = '${escapeSqlString(email)}'`)
      .join(' OR ');
    const res = await listmonkFetch(
      cfg,
      `/api/subscribers?per_page=all&query=${encodeURIComponent(`(${query})`)}`,
    );
    await assertOk(res);
    const json = await res.json();
    const subscribers: ListmonkSubscriber[] = (json?.data?.results ?? []).map(mapSubscriber);
    for (const sub of subscribers) {
      result.set(sub.email.toLowerCase(), sub);
    }
  }

  return result;
}

export async function fetchRemoteLists(
  config: Record<string, string | undefined>,
): Promise<ListmonkRemoteList[]> {
  const cfg = requireConfig(config);
  const res = await listmonkFetch(cfg, '/api/lists?per_page=all');
  await assertOk(res);
  const json = await res.json();
  const results: Array<{
    id: number;
    name: string;
    type: string;
    status: string;
    subscriber_count?: number;
  }> = json?.data?.results ?? [];

  return results.map((list) => ({
    id: list.id,
    name: list.name,
    type: list.type,
    status: list.status,
    subscriberCount: list.subscriber_count ?? 0,
  }));
}

export async function fetchCampaigns(
  config: Record<string, string | undefined>,
  page = 1,
  perPage = 20,
): Promise<{ results: ListmonkCampaign[]; total: number }> {
  const cfg = requireConfig(config);
  const res = await listmonkFetch(cfg, `/api/campaigns?page=${page}&per_page=${perPage}`);
  await assertOk(res);
  const json = await res.json();
  const results: RawCampaign[] = json?.data?.results ?? [];
  const total = json?.data?.total ?? results.length;
  return { results: results.map(mapCampaign), total };
}

export async function fetchCampaign(
  config: Record<string, string | undefined>,
  id: number,
): Promise<ListmonkCampaign> {
  const cfg = requireConfig(config);
  const res = await listmonkFetch(cfg, `/api/campaigns/${id}`);
  await assertOk(res);
  const json = await res.json();
  return mapCampaign(json?.data as RawCampaign);
}

export async function createCampaign(
  config: Record<string, string | undefined>,
  input: CreateCampaignInput,
): Promise<ListmonkCampaign> {
  const cfg = requireConfig(config);
  const body: Record<string, unknown> = {
    name: input.name,
    subject: input.subject,
    lists: input.lists,
    type: input.type,
    content_type: input.contentType,
    body: input.body,
    messenger: 'email',
  };
  if (input.fromEmail) body.from_email = input.fromEmail;
  if (input.templateId != null) body.template_id = input.templateId;
  if (input.tags?.length) body.tags = input.tags;
  if (input.sendAt) body.send_at = input.sendAt;
  if (input.headers?.length) body.headers = input.headers;

  const res = await listmonkFetch(cfg, '/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  await assertOk(res);
  const json = await res.json();
  return mapCampaign(json?.data as RawCampaign);
}

export async function updateCampaign(
  config: Record<string, string | undefined>,
  id: number,
  input: CreateCampaignInput,
): Promise<ListmonkCampaign> {
  const cfg = requireConfig(config);
  const body: Record<string, unknown> = {
    name: input.name,
    subject: input.subject,
    lists: input.lists,
    type: input.type,
    content_type: input.contentType,
    body: input.body,
    messenger: 'email',
  };
  if (input.fromEmail) body.from_email = input.fromEmail;
  if (input.templateId != null) body.template_id = input.templateId;
  if (input.tags?.length) body.tags = input.tags;
  if (input.sendAt) body.send_at = input.sendAt;
  else body.send_at = null;
  if (input.headers?.length) body.headers = input.headers;

  const res = await listmonkFetch(cfg, `/api/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  await assertOk(res);
  const json = await res.json();
  return mapCampaign(json?.data as RawCampaign);
}

export async function updateCampaignStatus(
  config: Record<string, string | undefined>,
  id: number,
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'cancelled',
): Promise<ListmonkCampaign> {
  const cfg = requireConfig(config);
  const res = await listmonkFetch(cfg, `/api/campaigns/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
  await assertOk(res);
  const json = await res.json();
  return mapCampaign(json?.data as RawCampaign);
}

export async function deleteCampaign(
  config: Record<string, string | undefined>,
  id: number,
): Promise<void> {
  const cfg = requireConfig(config);
  const res = await listmonkFetch(cfg, `/api/campaigns/${id}`, { method: 'DELETE' });
  await assertOk(res);
}

export async function fetchCampaignAnalytics(
  config: Record<string, string | undefined>,
  id: number,
  type: 'views' | 'clicks' | 'bounces' | 'links',
  from: string,
  to: string,
): Promise<ListmonkCampaignAnalyticsItem[]> {
  const cfg = requireConfig(config);
  const qs = new URLSearchParams({ id: String(id), from, to });
  const res = await listmonkFetch(cfg, `/api/campaigns/analytics/${type}?${qs}`);
  await assertOk(res);
  const json = await res.json();
  const rows: Array<{ campaign_id?: number; count?: number; timestamp?: string }> = Array.isArray(
    json?.data,
  )
    ? json.data
    : [];
  return rows.map((row) => ({
    campaignId: row.campaign_id ?? id,
    count: row.count ?? 0,
    timestamp: row.timestamp ?? '',
  }));
}

export async function fetchTemplates(
  config: Record<string, string | undefined>,
): Promise<ListmonkTemplate[]> {
  const cfg = requireConfig(config);
  const res = await listmonkFetch(cfg, '/api/templates');
  await assertOk(res);
  const json = await res.json();
  const raw: Array<{
    id: number;
    name: string;
    type?: string;
    is_default?: boolean;
    body?: string;
    created_at?: string;
    updated_at?: string;
  }> = Array.isArray(json?.data) ? json.data : (json?.data?.results ?? []);

  return raw
    .filter((t) => {
      const type = t.type ?? 'campaign';
      return type === 'campaign' || type === 'campaign_visual';
    })
    .map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type ?? 'campaign',
      isDefault: t.is_default ?? false,
      body: t.body,
      createdAt: t.created_at ?? '',
      updatedAt: t.updated_at ?? '',
    }));
}

export async function fetchTemplate(
  config: Record<string, string | undefined>,
  id: number,
): Promise<ListmonkTemplate> {
  const cfg = requireConfig(config);
  const res = await listmonkFetch(cfg, `/api/templates/${id}`);
  await assertOk(res);
  const json = await res.json();
  const t = json?.data;
  if (!t?.id) {
    throw new ListmonkUpstreamError(404, 'Template not found');
  }
  return {
    id: t.id,
    name: t.name,
    type: t.type ?? 'campaign',
    isDefault: t.is_default ?? false,
    body: t.body ?? '',
    createdAt: t.created_at ?? '',
    updatedAt: t.updated_at ?? '',
  };
}

const CONTENT_PLACEHOLDER = /\{\{\s*template\s+"content"\s+\.\s*\}\}/;

/** Rough body → HTML for local preview when Listmonk campaign preview isn't available. */
export function campaignBodyToHtml(
  body: string,
  contentType: CampaignPreviewInput['contentType'],
): string {
  const trimmed = body.trim();
  if (!trimmed) return '<p></p>';
  if (contentType === 'html' || contentType === 'richtext') {
    return trimmed.replace(/@TrackLink/g, '');
  }
  if (contentType === 'plain') {
    const escaped = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
      .join('\n');
  }
  // markdown — light conversion for preview only
  let md = trimmed.replace(/@TrackLink/g, '');
  md = md.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  md = md.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  md = md.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  md = md.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/\*(.+?)\*/g, '<em>$1</em>');
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  md = md.replace(/^- (.+)$/gm, '<li>$1</li>');
  md = md.replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`);
  md = md
    .split(/\n{2,}/)
    .map((block) => {
      if (/^<(h[1-3]|ul|ol|p|div)/.test(block.trim())) return block;
      return `<p>${block.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');
  return md;
}

/** Inject campaign body into a Listmonk template for CRM-side preview (stubs Go exprs). */
export function composeTemplatePreview(templateBody: string, contentHtml: string): string {
  let html = templateBody.includes('{{')
    ? CONTENT_PLACEHOLDER.test(templateBody)
      ? templateBody.replace(CONTENT_PLACEHOLDER, contentHtml)
      : `${templateBody}\n${contentHtml}`
    : contentHtml;

  html = html
    .replace(/\{\{\s*UnsubscribeURL\s*\}\}/g, '#unsubscribe')
    .replace(/\{\{\s*MessageURL\s*\}\}/g, '#')
    .replace(/\{\{\s*OptinURL\s*\}\}/g, '#')
    .replace(/\{\{\s*TrackView\s*\}\}/g, '')
    .replace(/\{\{\s*Date\s*\}\}/g, '')
    .replace(/\{\{\s*\.Campaign\.\w+\s*\}\}/g, '')
    .replace(/\{\{\s*\.Subscriber\.[^}]+\}\}/g, '')
    .replace(/\{\{[^}]+\}\}/g, '');

  return html;
}

/**
 * Full-email HTML preview: prefers Listmonk campaign preview when campaignId is set;
 * otherwise fetches the template and injects the body locally.
 */
export async function previewCampaignEmail(
  config: Record<string, string | undefined>,
  input: CampaignPreviewInput,
): Promise<{ html: string; source: 'listmonk' | 'local' }> {
  const cfg = requireConfig(config);

  if (input.campaignId != null) {
    const params = new URLSearchParams();
    params.set('body', input.body);
    params.set('content_type', input.contentType);
    params.set('template_id', String(input.templateId));
    const res = await listmonkFetch(cfg, `/api/campaigns/${input.campaignId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    await assertOk(res);
    const html = await res.text();
    if (input.contentType === 'plain') {
      return {
        html: `<pre style="white-space:pre-wrap;font-family:sans-serif;padding:1.5rem">${html
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</pre>`,
        source: 'listmonk',
      };
    }
    return { html, source: 'listmonk' };
  }

  const tpl = await fetchTemplate(config, input.templateId);
  const contentHtml = campaignBodyToHtml(input.body, input.contentType);
  return {
    html: composeTemplatePreview(tpl.body ?? '', contentHtml),
    source: 'local',
  };
}

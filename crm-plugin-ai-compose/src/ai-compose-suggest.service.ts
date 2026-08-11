import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import {
  LEADS_SERVICE,
  MAIL_THREAD_SERVICE,
  POKELO_CONTEXT_SERVICE,
  type MailThreadServiceLike,
  type PokeloContextServiceLike,
  AppException,
} from '../../../packages/plugin-host/src';
import { AiComposeSettingsService } from './ai-compose-settings.service';

const CHAR_BUDGET = 14_000;

/** Listmonk campaign body formats (visual is editor-only — not generated here). */
export const NEWSLETTER_CONTENT_TYPES = ['html', 'markdown', 'plain', 'richtext'] as const;
export type NewsletterContentType = (typeof NEWSLETTER_CONTENT_TYPES)[number];

export type LeadsServiceLike = {
  findById(id: string): Promise<{
    id: string;
    title: string | null;
    contactEmail: string | null;
    contactName: string | null;
    formName: string | null;
    value: string | null;
    priority: string | null;
    submission?: {
      data?: Record<string, unknown> | null;
    } | null;
  } | null>;
};

@Injectable()
export class AiComposeSuggestService {
  private readonly logger = new Logger(AiComposeSuggestService.name);

  constructor(
    private readonly settings: AiComposeSettingsService,
    @Inject(MAIL_THREAD_SERVICE) private readonly mailThreads: MailThreadServiceLike,
    @Inject(LEADS_SERVICE) private readonly leads: LeadsServiceLike,
    @Optional()
    @Inject(POKELO_CONTEXT_SERVICE)
    private readonly pokeloContext: PokeloContextServiceLike | null = null,
  ) {}

  async availability(): Promise<{ available: boolean; defaultModel: string | null }> {
    const defaultModel = await this.settings.getDefaultModel();
    try {
      await this.settings.getDecryptedApiKey();
      return { available: true, defaultModel };
    } catch {
      return { available: false, defaultModel };
    }
  }

  async suggest(input: {
    threadId?: string;
    leadId?: string;
    model?: string;
    instruction?: string;
  }): Promise<{ draft: string; modelUsed: string }> {
    if (!input.threadId && !input.leadId) {
      throw AppException.badRequest('Either threadId or leadId is required');
    }

    const modelUsed = await this.resolveModel(input.model);

    const thread = input.threadId ? await this.mailThreads.getThread(input.threadId) : null;

    let leadContext = '';
    if (input.leadId) {
      const lead = await this.leads.findById(input.leadId);
      if (lead) {
        leadContext = [
          lead.title ? `Lead: ${lead.title}` : '',
          lead.contactName ? `Contact: ${lead.contactName}` : '',
          lead.contactEmail ? `Email: ${lead.contactEmail}` : '',
          lead.value ? `Value: ${lead.value}` : '',
          lead.priority ? `Priority: ${lead.priority}` : '',
          lead.formName ? `Source form: ${lead.formName}` : '',
          formatSubmissionData(lead.submission?.data),
        ]
          .filter(Boolean)
          .join('\n');
      }
    }

    if (!thread && !leadContext) {
      throw AppException.badRequest('Lead not found — cannot draft without context');
    }

    const systemPrompt = await this.settings.getSystemPrompt();
    const defaultSystemPrompt = thread
      ? [
          'You are a professional CRM email assistant.',
          'Your task is to draft a plain-text reply to the provided email thread.',
          'Write only the reply body — no subject line, no greeting instructions.',
          'Match the language of the last inbound message.',
          'Be concise, professional, and helpful.',
          'Output only the draft text — no commentary, no meta-notes.',
        ].join(' ')
      : [
          'You are a professional CRM email assistant.',
          'Your task is to draft a plain-text first outbound email to a sales lead.',
          'Write only the email body — no subject line.',
          'Use the form submission fields as the inbound request — address what the lead actually wrote.',
          'Match the language of the submission when possible.',
          'Be concise, professional, and helpful.',
          'Output only the draft text — no commentary, no meta-notes.',
        ].join(' ');

    const systemContent = [
      systemPrompt || defaultSystemPrompt,
      input.instruction ? `Additional instruction: ${input.instruction}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const userContent = thread
      ? buildThreadContext(thread, leadContext)
      : buildLeadOnlyContext(leadContext);

    const lastMessage = thread?.messages?.slice(-1)?.[0]?.bodyText?.slice(0, 300) ?? '';
    const ragQuery = [input.instruction ?? '', leadContext.slice(0, 500), lastMessage]
      .filter(Boolean)
      .join(' ');

    const draft = await this.completeChat({ modelUsed, systemContent, userContent, ragQuery });
    return { draft, modelUsed };
  }

  /**
   * Free-form newsletter campaign body for Listmonk (and similar).
   * Output format follows `contentType` — never wraps in markdown fences.
   */
  async generateNewsletter(input: {
    contentType: NewsletterContentType;
    name?: string;
    subject?: string;
    instruction?: string;
    existingBody?: string;
    /** Selected Listmonk template name — body is injected into {{ template }} slot. */
    templateName?: string;
    model?: string;
  }): Promise<{ draft: string; modelUsed: string }> {
    if (!NEWSLETTER_CONTENT_TYPES.includes(input.contentType)) {
      throw AppException.badRequest(
        `contentType must be one of: ${NEWSLETTER_CONTENT_TYPES.join(', ')}`,
      );
    }

    const brief = (input.instruction ?? '').trim();
    const hasContext =
      brief.length > 0 ||
      Boolean(input.name?.trim()) ||
      Boolean(input.subject?.trim()) ||
      Boolean(input.existingBody?.trim());
    if (!hasContext) {
      throw AppException.badRequest(
        'Provide an instruction, campaign name/subject, or existing body to generate from',
      );
    }

    const modelUsed = await this.resolveModel(input.model);
    const formatSpec = formatSpecFor(input.contentType);
    const systemPrompt = await this.settings.getSystemPrompt();

    const systemContent = [
      systemPrompt ||
        [
          'You are a professional newsletter copywriter for Listmonk campaigns.',
          'Write ONLY the campaign body fragment that will be injected into an existing email template.',
          'The template already provides chrome (header bar, footer, brand note, outer layout) — never recreate those.',
          'Do not invent a subject line as a separate field; put copy in the body only.',
          'Match the language of the user brief when possible.',
          'Output only the body — no commentary, no meta-notes, no markdown code fences.',
        ].join(' '),
      formatSpec,
      brief ? `Additional instruction: ${brief}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const userParts = [
      'Write a Listmonk campaign body fragment with this context:',
      input.name?.trim() ? `Campaign name: ${input.name.trim()}` : '',
      input.subject?.trim()
        ? `Subject line (for tone only — do not output it): ${input.subject.trim()}`
        : '',
      input.templateName?.trim()
        ? `Injected into Listmonk template: ${input.templateName.trim()} (header/footer already in template)`
        : 'Injected into a Listmonk email template (header/footer already in template)',
      `Required output format: ${input.contentType}`,
      input.existingBody?.trim()
        ? [
            '',
            'Existing draft to improve or rewrite (keep intent unless the instruction says otherwise):',
            input.existingBody.trim().slice(0, CHAR_BUDGET),
          ].join('\n')
        : '',
      brief ? ['', 'Brief:', brief].join('\n') : '',
      '',
      'Return only the body fragment in the required format.',
    ].filter(Boolean);

    const ragQuery = [input.instruction ?? '', input.name ?? '', input.subject ?? '']
      .filter(Boolean)
      .join(' ');

    const draft = stripCodeFences(
      await this.completeChat({
        modelUsed,
        systemContent,
        userContent: userParts.join('\n'),
        ragQuery,
      }),
    );
    return { draft, modelUsed };
  }

  async fetchModels(baseUrl: string, apiKey: string): Promise<{ id: string; label: string }[]> {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw AppException.badRequest(
        `Failed to fetch models from provider: ${response.status} — ${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ id: string; object?: string }>;
    };

    return (data?.data ?? [])
      .filter((m) => m.object === 'model' || !m.object)
      .map((m) => ({ id: m.id, label: m.id }));
  }

  /** Allowed models for compose UIs that are not integrations admins. */
  async getComposeModels(): Promise<{
    models: { id: string; label: string }[];
    defaultModel: string | null;
  }> {
    const defaultModel = await this.settings.getDefaultModel();
    const allowedModels = await this.settings.getAllowedModels();
    const toEntries = (ids: string[]) => ids.map((m) => ({ id: m, label: m }));

    if (allowedModels.length === 0) {
      const { apiKey, baseUrl } = await this.settings.getDecryptedApiKey().catch(() => ({
        apiKey: '',
        baseUrl: '',
      }));
      if (apiKey) {
        try {
          const all = await this.fetchModels(baseUrl, apiKey);
          return { models: all, defaultModel };
        } catch {
          return { models: [], defaultModel };
        }
      }
      return { models: [], defaultModel };
    }

    try {
      const { apiKey, baseUrl } = await this.settings.getDecryptedApiKey();
      const allModels = await this.fetchModels(baseUrl, apiKey);
      const allIds = new Set(allModels.map((m) => m.id));
      const models = allowedModels
        .filter((m) => allIds.has(m))
        .map((m) => {
          const found = allModels.find((x) => x.id === m);
          return { id: m, label: found?.label ?? m };
        });
      return { models, defaultModel };
    } catch {
      return { models: toEntries(allowedModels), defaultModel };
    }
  }

  private async resolveModel(requested?: string): Promise<string> {
    const allowedModels = await this.settings.getAllowedModels();
    const defaultModel = await this.settings.getDefaultModel();

    if (requested) {
      if (allowedModels.length > 0 && !allowedModels.includes(requested)) {
        throw AppException.badRequest(`Model "${requested}" is not in the allowed models list`);
      }
      return requested;
    }
    if (defaultModel) return defaultModel;
    if (allowedModels.length > 0) return allowedModels[0];
    throw AppException.badRequest('No model specified and no default model configured');
  }

  private async completeChat(input: {
    modelUsed: string;
    systemContent: string;
    userContent: string;
    /** Preferred RAG query; defaults to a slice of userContent. */
    ragQuery?: string;
  }): Promise<string> {
    const { apiKey, baseUrl } = await this.settings.getDecryptedApiKey();

    let pokeloSnippets = '';
    if (this.pokeloContext) {
      const query = (input.ragQuery ?? input.userContent).slice(0, 800);
      pokeloSnippets = await this.resolvePokeloSnippets({
        query,
        apiKey,
        baseUrl,
        modelUsed: input.modelUsed,
      }).catch(() => '');
    }

    const systemContent = [input.systemContent, pokeloSnippets].filter(Boolean).join('\n\n');

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.modelUsed,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: input.userContent },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      this.logger.error(`AI provider error ${response.status}: ${errorText}`);
      throw AppException.badRequest(
        `AI provider returned ${response.status}: ${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const draft = data?.choices?.[0]?.message?.content?.trim() ?? '';
    if (!draft) {
      throw AppException.badRequest('AI provider returned an empty response');
    }
    return draft;
  }

  /**
   * Multi-project Pokelo RAG (ADR-0022):
   * - 0 bound → ''
   * - 1–2 bound → direct search (no extra LLM round-trip)
   * - 3+ → cheap router LLM picks primary (+ optional followUp), then search
   */
  private async resolvePokeloSnippets(input: {
    query: string;
    apiKey: string;
    baseUrl: string;
    modelUsed: string;
  }): Promise<string> {
    if (!this.pokeloContext) return '';

    const bound = (await this.pokeloContext.listBoundProjects?.().catch(() => [])) ?? [];
    if (bound.length === 0) {
      return this.pokeloContext.fetchContext(input.query).catch(() => '');
    }

    // One or two projects: search them all — router adds latency/cost for little gain
    // and some providers reject the router's stricter completion params (HTTP 400).
    if (bound.length <= 2) {
      return this.pokeloContext.fetchContext(input.query, {
        projectIds: bound.map((p) => p.id),
      });
    }

    const route = await this.routePokeloProjects({
      query: input.query,
      projects: bound,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      modelUsed: input.modelUsed,
    });

    const primaryIds = route.primary.length > 0 ? route.primary : [bound[0].id];
    let snippets = await this.pokeloContext.fetchContext(input.query, {
      projectIds: primaryIds,
    });

    // Second pass: also pull from another brand/project when the router asked for it.
    const followUp = route.followUp.filter((id) => !primaryIds.includes(id));
    if (followUp.length > 0) {
      const more = await this.pokeloContext.fetchContext(input.query, {
        projectIds: followUp,
      });
      if (more) {
        snippets = [snippets, more].filter(Boolean).join('\n\n');
      }
    }

    return snippets;
  }

  private async routePokeloProjects(input: {
    query: string;
    projects: Array<{ id: string; name: string }>;
    apiKey: string;
    baseUrl: string;
    modelUsed: string;
  }): Promise<{ primary: string[]; followUp: string[] }> {
    const catalog = input.projects.map((p) => `- ${p.name} (${p.id})`).join('\n');

    const system = [
      'You route knowledge-base lookups for a CRM AI assistant.',
      'Given a drafting query and available Pokelo projects (brands/products),',
      'choose which projects to search.',
      'Return ONLY compact JSON: {"primary":["uuid",...],"followUp":["uuid",...]}',
      'Rules:',
      '- primary: 1–2 most relevant projects to search first',
      '- followUp: 0–1 extra project if a second brand/product may add useful context',
      '- use only IDs from the catalog',
      '- if unsure, put the broadest/most central project in primary and leave followUp empty',
    ].join(' ');

    const user = [
      'Available projects:',
      catalog,
      '',
      'Drafting query:',
      input.query.slice(0, 800),
    ].join('\n');

    try {
      // Keep the body aligned with completeChat — many OpenAI-compatible providers
      // reject max_tokens and/or temperature: 0 (HTTP 400) while accepting the draft call.
      const response = await fetch(`${input.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.modelUsed,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        this.logger.warn(
          `Pokelo router HTTP ${response.status} — falling back to all projects: ${errText.slice(0, 300)}`,
        );
        return {
          primary: input.projects.slice(0, 2).map((p) => p.id),
          followUp: input.projects.slice(2, 3).map((p) => p.id),
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data?.choices?.[0]?.message?.content ?? '';
      return parsePokeloRoute(
        raw,
        input.projects.map((p) => p.id),
      );
    } catch (err) {
      this.logger.warn(`Pokelo router failed: ${(err as Error).message}`);
      return {
        primary: input.projects.slice(0, 2).map((p) => p.id),
        followUp: input.projects.slice(2, 3).map((p) => p.id),
      };
    }
  }
}

/** Exported for unit tests. */
export function parsePokeloRoute(
  raw: string,
  allowedIds: string[],
): { primary: string[]; followUp: string[] } {
  const allowed = new Set(allowedIds);
  const empty = { primary: [] as string[], followUp: [] as string[] };
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return empty;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      primary?: unknown;
      followUp?: unknown;
    };
    const pick = (v: unknown, max: number) =>
      (Array.isArray(v) ? v : [])
        .filter((id): id is string => typeof id === 'string' && allowed.has(id))
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .slice(0, max);
    return {
      primary: pick(parsed.primary, 2),
      followUp: pick(parsed.followUp, 1),
    };
  } catch {
    return empty;
  }
}

function formatSpecFor(contentType: NewsletterContentType): string {
  switch (contentType) {
    case 'html':
      return [
        'Output format: HTML fragment for a Listmonk template body slot.',
        'Shape the copy like this structure (adapt wording to the brief):',
        '<h1>…</h1> then <p>…</p>, optional <div class="note-box"> with <strong>…</strong> and <ul><li>…</li></ul>,',
        'closing <p>…</p>, and a CTA <p><a href="https://example.com@TrackLink">Label →</a></p>.',
        'Use class="note-box" for callout blocks when highlighting a short list or tip.',
        'For trackable CTAs append @TrackLink to the href (Listmonk tracking), e.g. https://app.example.com/register@TrackLink.',
        'Do NOT output <html>, <head>, <body>, outer wrappers, header bars, or footer brand boxes — those live in the template.',
        'Do not wrap the answer in markdown code fences.',
      ].join(' ');
    case 'markdown':
      return [
        'Output format: Markdown body fragment for a Listmonk template.',
        'Use headings, paragraphs, lists, and links only — no HTML chrome, no fenced code block wrapper.',
        'The template already supplies header/footer; write inner content only.',
      ].join(' ');
    case 'plain':
      return [
        'Output format: plain text body fragment for a Listmonk template.',
        'No HTML tags, no Markdown syntax. Blank lines between paragraphs.',
        'No header/footer chrome — template provides that.',
      ].join(' ');
    case 'richtext':
      return [
        'Output format: simple HTML richtext fragment for Listmonk (paragraphs, bold/italic, lists, links).',
        'No full document, no template chrome, no scripts. Do not wrap in markdown code fences.',
      ].join(' ');
  }
}

/** Models often wrap output in ```html … ``` — strip for paste-into-editor use. */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const matched = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)\n?```$/);
  return matched ? matched[1].trim() : trimmed;
}

function buildThreadContext(
  thread: Awaited<ReturnType<MailThreadServiceLike['getThread']>>,
  leadContext: string,
): string {
  const parts: string[] = [];

  if (thread.subject) {
    parts.push(`Subject: ${thread.subject}`);
  }
  if (thread.contactEmail) {
    parts.push(`Contact email: ${thread.contactEmail}`);
  }
  if (thread.contactName) {
    parts.push(`Contact name: ${thread.contactName}`);
  }
  if (leadContext) {
    parts.push('');
    parts.push('Lead context:');
    parts.push(leadContext);
  }

  parts.push('');
  parts.push('Email thread (oldest first):');

  let budget = CHAR_BUDGET;
  const included: string[] = [];

  for (const msg of thread.messages) {
    const entry = [
      `[${msg.direction.toUpperCase()}] ${msg.fromAddress ?? 'unknown'}:`,
      msg.bodyText.slice(0, 4000),
    ].join('\n');
    if (budget - entry.length < 0 && included.length > 0) break;
    included.push(entry);
    budget -= entry.length;
  }

  parts.push(...included);
  parts.push('');
  parts.push('Please draft a reply to the last inbound message above.');

  return parts.join('\n');
}

function buildLeadOnlyContext(leadContext: string): string {
  return [
    'Lead context:',
    leadContext,
    '',
    "There is no prior email thread. Draft a first outbound email responding to this lead's form submission.",
  ].join('\n');
}

/** Serialize form submission fields for the prompt (skip honeypot / empty). */
function formatSubmissionData(data: Record<string, unknown> | null | undefined): string {
  if (!data || typeof data !== 'object') return '';
  const lines = Object.entries(data)
    .filter(([key, value]) => key !== '_hp' && value != null && String(value).trim() !== '')
    .map(([key, value]) => {
      const label = key.replace(/_/g, ' ');
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return `${label}: ${text.slice(0, 4000)}`;
    });
  if (!lines.length) return '';
  return ['Form submission:', ...lines].join('\n');
}

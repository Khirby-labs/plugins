<template>
  <div class="space-y-5">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h3 class="text-base font-medium text-text-primary">{{ pageTitle }}</h3>
        <p class="text-sm text-text-muted mt-1">{{ t('campaigns.form.pageSubtitle') }}</p>
      </div>
      <button type="button" class="btn-ghost px-3 py-1.5 text-sm" @click="$emit('close')">
        {{ t('campaigns.form.backToList') }}
      </button>
    </div>

    <div v-if="loadingDetail" class="text-sm text-text-muted py-10 text-center">
      {{ t('actions.loading') }}
    </div>
    <form v-else class="space-y-4" @submit.prevent="submit">
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="crm-label">{{ t('campaigns.form.name') }}</label>
          <input v-model="form.name" type="text" required class="crm-input w-full" />
        </div>
        <div>
          <label class="crm-label">{{ t('campaigns.form.subject') }}</label>
          <input v-model="form.subject" type="text" required class="crm-input w-full" />
        </div>
        <div>
          <label class="crm-label">{{ t('campaigns.form.fromEmail') }}</label>
          <input v-model="form.fromEmail" type="email" class="crm-input w-full" />
        </div>
        <div>
          <label class="crm-label">{{ t('campaigns.form.template') }}</label>
          <AppSelect
            v-model="templateModel"
            :options="templateOptions"
            :placeholder="
              templates.length
                ? t('campaigns.form.templatePlaceholder')
                : t('campaigns.form.templateEmpty')
            "
            :aria-label="t('campaigns.form.template')"
            :disabled="!templates.length"
            trigger-class="w-full"
          />
          <p v-if="!templates.length" class="text-xs text-text-ghost mt-1">
            {{ t('campaigns.form.templateEmptyHint') }}
          </p>
        </div>
      </div>

      <div>
        <label class="crm-label">{{ t('campaigns.form.lists') }}</label>
        <div
          class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 rounded-md border border-border bg-surface-panel p-3"
        >
          <label
            v-for="list in lists"
            :key="list.id"
            class="flex items-center gap-2 text-sm text-text-secondary"
          >
            <input
              v-model="form.lists"
              type="checkbox"
              :value="list.id"
              class="rounded border-border"
            />
            {{ list.name }}
          </label>
          <p v-if="!lists.length" class="text-xs text-text-ghost sm:col-span-2 lg:col-span-3">
            {{ t('campaigns.form.noLists') }}
          </p>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="crm-label">{{ t('campaigns.form.contentType') }}</label>
          <AppSelect
            v-model="form.contentType"
            :options="contentTypeOptions"
            :aria-label="t('campaigns.form.contentType')"
            trigger-class="w-full"
          />
        </div>
        <div class="flex flex-col justify-end gap-3 pb-0.5">
          <div class="flex items-center gap-2">
            <input
              id="lm-send-now"
              v-model="form.sendImmediately"
              type="checkbox"
              class="rounded border-border"
            />
            <label for="lm-send-now" class="text-sm text-text-secondary">
              {{ t('campaigns.form.sendImmediately') }}
            </label>
          </div>
          <div class="flex items-center gap-2">
            <input
              id="lm-reply-to"
              v-model="form.useMailboxReplyTo"
              type="checkbox"
              class="rounded border-border"
            />
            <label for="lm-reply-to" class="text-sm text-text-secondary">
              {{ t('campaigns.form.useMailboxReplyTo') }}
            </label>
          </div>
        </div>
      </div>

      <div v-if="!form.sendImmediately">
        <label class="crm-label">{{ t('campaigns.form.sendAt') }}</label>
        <AppDatePicker
          v-model="sendAtDay"
          :aria-label="t('campaigns.form.sendAt')"
          clearable
          trigger-class="w-full max-w-xs"
        />
      </div>

      <div
        v-if="aiAvailable && form.contentType !== 'visual'"
        class="space-y-2 rounded-md border border-border bg-surface-raise p-3"
      >
        <div class="flex items-baseline justify-between gap-2 flex-wrap">
          <label class="crm-label mb-0">{{ t('campaigns.form.ai.title') }}</label>
          <span class="text-xs text-text-ghost">{{
            t('campaigns.form.ai.formatHint', { format: contentTypeLabel })
          }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <select
            v-if="aiModels.length > 1"
            v-model="aiModel"
            class="crm-input py-1.5 px-2 text-sm max-w-[12rem]"
            :disabled="aiGenerating"
            :aria-label="t('campaigns.form.ai.model')"
          >
            <option v-for="m in aiModels" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
          <input
            v-model="aiInstruction"
            type="text"
            class="flex-1 crm-input py-1.5 px-2 text-sm min-w-[12rem]"
            :placeholder="t('campaigns.form.ai.instructionPlaceholder')"
            :disabled="aiGenerating"
            @keyup.enter="generateWithAi"
          />
          <button
            type="button"
            class="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50"
            :disabled="aiGenerating"
            @click="generateWithAi"
          >
            {{ aiGenerating ? t('campaigns.form.ai.generating') : t('campaigns.form.ai.generate') }}
          </button>
        </div>
        <p v-if="aiError" class="text-xs text-danger">{{ aiError }}</p>
      </div>

      <div
        v-if="form.contentType !== 'visual'"
        style="display: flex; flex-direction: row; align-items: flex-start; gap: 1rem; width: 100%"
      >
        <div class="space-y-2" style="flex: 1 1 0; min-width: 0; max-width: 50%">
          <label class="crm-label">{{ t('campaigns.form.body') }}</label>
          <p class="text-xs text-text-muted">{{ t('campaigns.form.bodyTemplateHint') }}</p>
          <textarea
            v-model="form.body"
            rows="22"
            required
            class="crm-input w-full font-mono text-sm min-h-[28rem]"
          />
        </div>
        <div class="space-y-2" style="flex: 1 1 0; min-width: 0; max-width: 50%">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <label class="crm-label mb-0">{{ t('campaigns.form.preview.title') }}</label>
            <span class="text-xs text-text-ghost">
              {{
                previewLoading
                  ? t('campaigns.form.preview.updating')
                  : previewSource === 'listmonk'
                    ? t('campaigns.form.preview.sourceListmonk')
                    : t('campaigns.form.preview.sourceLocal')
              }}
            </span>
          </div>
          <p
            v-if="!form.templateId"
            class="text-xs text-text-muted rounded-md border border-border bg-surface-raise p-3"
          >
            {{ t('campaigns.form.preview.needTemplate') }}
          </p>
          <p v-else-if="previewError" class="text-xs text-danger">{{ previewError }}</p>
          <div
            v-else
            ref="previewShell"
            class="relative rounded-md border border-border bg-surface-input overflow-auto"
            :style="{ minHeight: '28rem', height: previewShellHeight }"
          >
            <iframe
              ref="previewFrame"
              class="absolute top-0 left-1/2 border-0 bg-white origin-top"
              sandbox="allow-same-origin"
              :title="t('campaigns.form.preview.title')"
              :srcdoc="previewSrcdoc"
              :style="{
                width: previewContentWidth,
                height: previewContentHeight,
                transform: `translateX(-50%) scale(${previewScale})`,
              }"
              @load="fitPreviewFrame"
            />
          </div>
        </div>
      </div>
      <p
        v-else
        class="text-xs text-text-muted rounded-md border border-border bg-surface-raise p-3"
      >
        {{ t('campaigns.form.visualHint') }}
      </p>

      <div v-if="error" class="crm-error">{{ error }}</div>
      <div class="flex justify-end gap-2 pt-1">
        <button type="button" class="btn-ghost" @click="$emit('close')">
          {{ t('actions.cancel') }}
        </button>
        <button type="submit" :disabled="saving" class="btn-primary disabled:opacity-50">
          {{
            saving
              ? isEdit
                ? t('actions.saving')
                : t('actions.creating')
              : isEdit
                ? t('campaigns.form.save')
                : t('campaigns.form.submit')
          }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { apiGet, apiPost, apiPut } from '@khirby/web-api';
import AppSelect from '@khirby/web-ui/AppSelect';
import AppDatePicker from '@khirby/web-ui/AppDatePicker';
import { useListmonkI18n } from './i18n';

type IsoDay = string;

const PREVIEW_FIT_CSS = [
  'html,body{margin:0!important;padding:0!important;}',
  'img{max-width:100%!important;height:auto!important;}',
].join('');

/** Ensure a full document + viewport so email layouts can be measured and scaled. */
function preparePreviewSrcdoc(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PREVIEW_FIT_CSS}</style></head><body></body></html>`;
  }
  const styleTag = `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${PREVIEW_FIT_CSS}</style>`;
  if (/<html[\s>]/i.test(trimmed)) {
    if (/<head[\s>]/i.test(trimmed)) {
      return trimmed.replace(/<head([^>]*)>/i, `<head$1>${styleTag}`);
    }
    return trimmed.replace(/<html([^>]*)>/i, `<html$1><head>${styleTag}</head>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${styleTag}</head><body>${trimmed}</body></html>`;
}

const props = defineProps<{
  /** When set, form loads and PUTs that campaign. */
  campaignId?: number | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved'): void;
}>();

const { t } = useListmonkI18n();

interface ListOption {
  id: number;
  name: string;
}
interface TemplateOption {
  id: number;
  name: string;
  isDefault?: boolean;
  type?: string;
}
interface CampaignDetail {
  id: number;
  name: string;
  subject: string;
  fromEmail: string;
  status: string;
  type: 'regular' | 'optin';
  contentType: string;
  body: string;
  lists: { id: number; name: string }[];
  templateId: number | null;
  sendAt: string | null;
  replyToAddress: string | null;
}

const isEdit = computed(() => props.campaignId != null);
const pageTitle = computed(() =>
  isEdit.value ? t('campaigns.form.editTitle') : t('campaigns.form.title'),
);

const lists = ref<ListOption[]>([]);
const templates = ref<TemplateOption[]>([]);
const saving = ref(false);
const loadingDetail = ref(false);
const error = ref('');
const sendAtDay = ref<IsoDay | null>(null);

const aiAvailable = ref(false);
const aiModels = ref<{ id: string; label: string }[]>([]);
const aiModel = ref('');
const aiInstruction = ref('');
const aiGenerating = ref(false);
const aiError = ref('');

const previewHtml = ref('');
const previewLoading = ref(false);
const previewError = ref('');
const previewSource = ref<'listmonk' | 'local' | null>(null);
const previewFrame = ref<HTMLIFrameElement | null>(null);
const previewShell = ref<HTMLElement | null>(null);
const previewScale = ref(1);
const previewContentWidth = ref('100%');
const previewContentHeight = ref('28rem');
const previewShellHeight = ref('28rem');
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewRo: ResizeObserver | null = null;

const previewSrcdoc = computed(() => preparePreviewSrcdoc(previewHtml.value));

function measureEmailBox(doc: Document): { width: number; height: number } {
  const tables = Array.from(doc.querySelectorAll('table')) as HTMLElement[];
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const table of tables) {
    const w = table.offsetWidth;
    const h = table.offsetHeight;
    const area = w * h;
    // Prefer the main campaign card (typical 480–720px wide)
    if (w >= 280 && area > bestArea) {
      best = table;
      bestArea = area;
    }
  }
  if (best) {
    return {
      width: Math.max(best.offsetWidth, 320),
      height: Math.max(
        best.offsetHeight,
        doc.documentElement.scrollHeight,
        doc.body?.scrollHeight ?? 0,
        240,
      ),
    };
  }
  return {
    width: Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth ?? 0, 320),
    height: Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 240),
  };
}

function fitPreviewFrame() {
  const iframe = previewFrame.value;
  const shell = previewShell.value;
  if (!iframe || !shell) return;
  try {
    const doc = iframe.contentDocument;
    if (!doc?.documentElement) return;

    const box = measureEmailBox(doc);
    const shellWidth = Math.max(shell.clientWidth - 16, 200);
    // Fit the email card to the panel (upscale allowed so a ~600px template fills a wide column)
    const scale = Math.min(Math.max(shellWidth / box.width, 0.6), 1.75);

    previewScale.value = scale;
    previewContentWidth.value = `${box.width}px`;
    // Give the iframe enough height for full document (footer below the card)
    const docHeight = Math.max(
      box.height,
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0,
    );
    previewContentHeight.value = `${docHeight}px`;
    previewShellHeight.value = `${Math.max(Math.ceil(docHeight * scale) + 16, 28 * 16)}px`;
  } catch {
    previewScale.value = 1;
    previewContentWidth.value = '100%';
    previewContentHeight.value = '28rem';
    previewShellHeight.value = '28rem';
  }
}
const form = ref({
  name: '',
  subject: '',
  fromEmail: '',
  lists: [] as number[],
  templateId: null as number | null,
  type: 'regular' as 'regular' | 'optin',
  contentType: 'html' as string,
  body: '',
  sendImmediately: false,
  useMailboxReplyTo: true,
});

const contentTypeOptions = computed(() =>
  (['richtext', 'html', 'markdown', 'plain'] as const).map((value) => ({
    value,
    label: t(`campaigns.contentType.${value}`),
  })),
);

const contentTypeLabel = computed(() => {
  const key = form.value.contentType;
  if (key === 'richtext' || key === 'html' || key === 'markdown' || key === 'plain') {
    return t(`campaigns.contentType.${key}`);
  }
  return key;
});

const selectedTemplateName = computed(() => {
  if (form.value.templateId == null) return null;
  return templates.value.find((tpl) => tpl.id === form.value.templateId)?.name ?? null;
});

const templateOptions = computed(() =>
  templates.value.map((tpl) => ({
    value: String(tpl.id),
    label: tpl.isDefault ? t('campaigns.form.templateDefaultLabel', { name: tpl.name }) : tpl.name,
  })),
);

const templateModel = computed({
  get: () => (form.value.templateId != null ? String(form.value.templateId) : ''),
  set: (v: string) => {
    form.value.templateId = v ? parseInt(v, 10) : null;
  },
});

watch(
  () => form.value.sendImmediately,
  (now) => {
    if (now) sendAtDay.value = null;
  },
);

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    void refreshPreview();
  }, 400);
}

async function refreshPreview() {
  const contentType = form.value.contentType;
  if (
    form.value.templateId == null ||
    (contentType !== 'html' &&
      contentType !== 'markdown' &&
      contentType !== 'plain' &&
      contentType !== 'richtext')
  ) {
    previewHtml.value = '';
    previewSource.value = null;
    previewError.value = '';
    return;
  }
  previewLoading.value = true;
  previewError.value = '';
  try {
    const result = await apiPost<{ html: string; source: 'listmonk' | 'local' }>(
      '/api/plugins/listmonk/campaigns/preview',
      {
        templateId: form.value.templateId,
        contentType,
        body: form.value.body,
        campaignId: props.campaignId ?? undefined,
      },
    );
    previewHtml.value = result.html;
    previewSource.value = result.source;
    await nextTick();
    fitPreviewFrame();
  } catch (e: unknown) {
    previewError.value = e instanceof Error ? e.message : t('campaigns.form.preview.error');
    previewHtml.value = '';
    previewSource.value = null;
  } finally {
    previewLoading.value = false;
  }
}

watch(
  () => [form.value.templateId, form.value.contentType, form.value.body, props.campaignId] as const,
  () => schedulePreview(),
);

watch(previewSrcdoc, () => {
  setTimeout(() => fitPreviewFrame(), 80);
});

watch(previewShell, (el, prev) => {
  if (prev) previewRo?.unobserve(prev);
  if (el) previewRo?.observe(el);
});

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
  previewRo?.disconnect();
  previewRo = null;
});

function pickDefaultTemplate() {
  if (form.value.templateId != null) return;
  const preferred = templates.value.find((tpl) => tpl.isDefault) ?? templates.value[0];
  if (preferred) form.value.templateId = preferred.id;
}

function applyDetail(camp: CampaignDetail) {
  form.value = {
    name: camp.name,
    subject: camp.subject,
    fromEmail: camp.fromEmail ?? '',
    lists: camp.lists.map((l) => l.id),
    templateId: camp.templateId,
    type: camp.type ?? 'regular',
    contentType: camp.contentType === 'visual' ? 'html' : camp.contentType,
    body: camp.body ?? '',
    sendImmediately: false,
    useMailboxReplyTo: Boolean(camp.replyToAddress),
  };
  sendAtDay.value = camp.sendAt ? camp.sendAt.slice(0, 10) : null;
}

async function probeAiCompose() {
  try {
    const status = await apiGet<{ available: boolean; defaultModel: string | null }>(
      '/api/plugins/ai-compose/availability',
    );
    if (!status.available) {
      aiAvailable.value = false;
      return;
    }
    aiAvailable.value = true;
    try {
      const models = await apiGet<{
        models: { id: string; label: string }[];
        defaultModel: string | null;
      }>('/api/plugins/ai-compose/models/compose');
      aiModels.value = models.models ?? [];
      const preferred =
        models.defaultModel && aiModels.value.some((m) => m.id === models.defaultModel)
          ? models.defaultModel
          : (aiModels.value[0]?.id ?? '');
      aiModel.value = preferred;
    } catch {
      aiModels.value = [];
      aiModel.value = '';
    }
  } catch {
    aiAvailable.value = false;
  }
}

async function generateWithAi() {
  const contentType = form.value.contentType;
  if (
    contentType !== 'html' &&
    contentType !== 'markdown' &&
    contentType !== 'plain' &&
    contentType !== 'richtext'
  ) {
    return;
  }
  aiGenerating.value = true;
  aiError.value = '';
  try {
    const result = await apiPost<{ draft: string; modelUsed: string }>(
      '/api/plugins/ai-compose/generate',
      {
        contentType,
        name: form.value.name || undefined,
        subject: form.value.subject || undefined,
        instruction: aiInstruction.value.trim() || undefined,
        existingBody: form.value.body.trim() || undefined,
        templateName: selectedTemplateName.value || undefined,
        model: aiModel.value || undefined,
      },
    );
    form.value.body = result.draft;
  } catch (e: unknown) {
    aiError.value = e instanceof Error ? e.message : t('campaigns.form.ai.error');
  } finally {
    aiGenerating.value = false;
  }
}

onMounted(async () => {
  loadingDetail.value = true;
  error.value = '';
  void probeAiCompose();
  previewRo = new ResizeObserver(() => fitPreviewFrame());
  try {
    const [listRes, tplRes, defaults] = await Promise.all([
      apiGet<ListOption[]>('/api/plugins/listmonk/lists'),
      apiGet<TemplateOption[]>('/api/plugins/listmonk/templates'),
      apiGet<{ fromEmail: string | null }>('/api/plugins/listmonk/from-defaults'),
    ]);
    lists.value = listRes;
    templates.value = tplRes;

    if (props.campaignId != null) {
      const camp = await apiGet<CampaignDetail>(
        `/api/plugins/listmonk/campaigns/${props.campaignId}`,
      );
      applyDetail(camp);
      if (form.value.templateId == null) pickDefaultTemplate();
    } else {
      if (defaults.fromEmail) form.value.fromEmail = defaults.fromEmail;
      pickDefaultTemplate();
    }
    schedulePreview();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('campaigns.form.loadMetaFailed');
  } finally {
    loadingDetail.value = false;
    await nextTick();
    if (previewShell.value) previewRo?.observe(previewShell.value);
  }
});

async function submit() {
  if (!form.value.lists.length) {
    error.value = t('campaigns.form.listsRequired');
    return;
  }
  if (form.value.templateId == null) {
    error.value = t('campaigns.form.templateRequired');
    return;
  }
  saving.value = true;
  error.value = '';
  const payload = {
    name: form.value.name,
    subject: form.value.subject,
    lists: form.value.lists,
    fromEmail: form.value.fromEmail || undefined,
    type: form.value.type,
    contentType: form.value.contentType,
    body: form.value.contentType === 'visual' ? '' : form.value.body,
    templateId: form.value.templateId,
    sendAt: sendAtDay.value ? `${sendAtDay.value}T09:00:00.000Z` : undefined,
    sendImmediately: form.value.sendImmediately,
    useMailboxReplyTo: form.value.useMailboxReplyTo,
  };
  try {
    if (props.campaignId != null) {
      await apiPut(`/api/plugins/listmonk/campaigns/${props.campaignId}`, payload);
    } else {
      await apiPost('/api/plugins/listmonk/campaigns', payload);
    }
    emit('saved');
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('campaigns.form.saveFailed');
  } finally {
    saving.value = false;
  }
}
</script>

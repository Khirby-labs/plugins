<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="text-sm text-text-muted">{{ t('campaigns.subtitle') }}</p>
      <button type="button" class="btn-primary px-3 py-1.5 text-sm" @click="emit('create')">
        {{ t('campaigns.new') }}
      </button>
    </div>

    <div v-if="error" class="crm-error">{{ error }}</div>

    <AppTable
      :loading="loading"
      :columns="columns"
      :rows="rows"
      :caption="t('campaigns.caption')"
      :empty-text="t('campaigns.empty')"
      clickable
      @row-click="onRowClick"
    >
      <template #cell-status="{ value }">
        <span
          class="inline-flex px-2 py-0.5 text-xs rounded-md font-medium border"
          :class="statusClass(String(value))"
        >
          {{ statusLabel(String(value)) }}
        </span>
      </template>
      <template #cell-sent="{ row }">
        <span class="tabular-nums text-text-secondary">
          {{ n((row as CampaignRow).sent, 'integer') }}
        </span>
      </template>
      <template #cell-openRate="{ row }">
        <span class="tabular-nums text-text-secondary">{{ openRate(row as CampaignRow) }}</span>
      </template>
      <template #cell-clickRate="{ row }">
        <span class="tabular-nums text-text-secondary">{{ clickRate(row as CampaignRow) }}</span>
      </template>
      <template #cell-createdAt="{ value }">
        <span class="tabular-nums text-text-secondary">{{
          formatCreatedAt(String(value ?? ''))
        }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center gap-1 justify-end flex-wrap" @click.stop>
          <button
            v-for="action in actionsFor(row as CampaignRow)"
            :key="actionKey(action)"
            type="button"
            class="btn-ghost px-2 py-1 text-xs"
            :disabled="actingId === (row as CampaignRow).id"
            @click="runAction(row as CampaignRow, action)"
          >
            {{ action.label }}
          </button>
        </div>
      </template>
    </AppTable>

    <CampaignStats v-if="selected" :campaign="selected" @close="selected = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { apiGet, apiPut, apiDelete } from '@khirby/web-api';
import AppTable, { type TableColumn } from '@khirby/web-ui/AppTable';
import { useConfirm } from '@khirby/web-ui/useConfirm';
import { useListmonkI18n } from './i18n';
import CampaignStats from './CampaignStats.vue';

const emit = defineEmits<{
  (e: 'create'): void;
  (e: 'edit', id: number): void;
}>();

export interface CampaignRow {
  id: number;
  name: string;
  subject: string;
  status: string;
  sent: number;
  views: number;
  clicks: number;
  repliesCount: number;
  createdAt: string;
  replyToAddress: string | null;
}

const { t, n } = useListmonkI18n();
// Named askConfirm — design-guard treats bare confirm( as window.confirm.
const askConfirm = useConfirm();

const columns = computed<TableColumn[]>(() => [
  { key: 'name', label: t('campaigns.columns.name') },
  { key: 'status', label: t('campaigns.columns.status') },
  { key: 'sent', label: t('campaigns.columns.sent'), align: 'right' },
  { key: 'openRate', label: t('campaigns.columns.openRate'), align: 'right' },
  { key: 'clickRate', label: t('campaigns.columns.clickRate'), align: 'right' },
  { key: 'createdAt', label: t('campaigns.columns.date') },
  { key: 'actions', label: t('campaigns.columns.actions'), align: 'right' },
]);

const STATUS_TOKENS = ['draft', 'running', 'scheduled', 'paused', 'finished', 'cancelled'] as const;

function statusLabel(value: string): string {
  return STATUS_TOKENS.includes(value as (typeof STATUS_TOKENS)[number])
    ? t(`campaigns.status.${value}`)
    : value;
}

function statusClass(value: string): string {
  switch (value) {
    case 'running':
      return 'bg-success/15 text-success border-success/20';
    case 'scheduled':
      return 'bg-info/15 text-info border-info/20';
    case 'paused':
      return 'bg-warning/15 text-warning border-warning/20';
    case 'finished':
      return 'bg-surface-raise text-text-secondary border-border';
    case 'cancelled':
      return 'bg-danger/15 text-danger border-danger/20';
    default:
      return 'bg-surface-raise text-text-muted border-border';
  }
}

/** Local wall clock as `2026-05-19 18:28` (not raw ISO). */
function formatCreatedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso || '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openRate(row: CampaignRow): string {
  if (!row.sent) return '—';
  return `${Math.round((row.views / row.sent) * 100)}%`;
}

function clickRate(row: CampaignRow): string {
  if (!row.sent) return '—';
  return `${Math.round((row.clicks / row.sent) * 100)}%`;
}

type RowAction =
  | { kind: 'edit'; label: string }
  | { kind: 'status'; status: 'running' | 'paused' | 'cancelled' | 'draft'; label: string }
  | { kind: 'delete'; label: string };

function actionKey(action: RowAction): string {
  if (action.kind === 'status') return `status-${action.status}`;
  return action.kind;
}

function actionsFor(row: CampaignRow): RowAction[] {
  switch (row.status) {
    case 'draft':
      return [
        { kind: 'edit', label: t('campaigns.actions.edit') },
        { kind: 'status', status: 'running', label: t('campaigns.actions.send') },
        { kind: 'delete', label: t('campaigns.actions.delete') },
      ];
    case 'scheduled':
      return [
        { kind: 'edit', label: t('campaigns.actions.edit') },
        { kind: 'status', status: 'running', label: t('campaigns.actions.send') },
        { kind: 'status', status: 'cancelled', label: t('campaigns.actions.cancel') },
      ];
    case 'running':
      return [{ kind: 'status', status: 'paused', label: t('campaigns.actions.pause') }];
    case 'paused':
      return [
        { kind: 'edit', label: t('campaigns.actions.edit') },
        { kind: 'status', status: 'running', label: t('campaigns.actions.resume') },
        { kind: 'status', status: 'cancelled', label: t('campaigns.actions.cancel') },
      ];
    default:
      return [];
  }
}

const rows = ref<CampaignRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selected = ref<CampaignRow | null>(null);
const actingId = ref<number | null>(null);

async function fetchCampaigns() {
  loading.value = true;
  error.value = null;
  try {
    const res = await apiGet<{ results: CampaignRow[]; total: number }>(
      '/api/plugins/listmonk/campaigns',
    );
    rows.value = res.results;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('campaigns.loadFailed');
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

function onRowClick(row: Record<string, unknown>) {
  selected.value = row as unknown as CampaignRow;
}

async function runAction(row: CampaignRow, action: RowAction) {
  if (action.kind === 'edit') {
    emit('edit', row.id);
    return;
  }
  if (action.kind === 'delete') {
    const confirmed = await askConfirm({
      title: t('campaigns.delete.title'),
      message: t('campaigns.delete.message', { name: row.name }),
      confirmLabel: t('campaigns.delete.confirm'),
    });
    if (!confirmed) return;
  }
  actingId.value = row.id;
  error.value = null;
  try {
    if (action.kind === 'delete') {
      await apiDelete(`/api/plugins/listmonk/campaigns/${row.id}`);
    } else {
      await apiPut(`/api/plugins/listmonk/campaigns/${row.id}/status`, {
        status: action.status,
      });
    }
    await fetchCampaigns();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('campaigns.actionFailed');
  } finally {
    actingId.value = null;
  }
}

onMounted(fetchCampaigns);
defineExpose({ refresh: fetchCampaigns });
</script>

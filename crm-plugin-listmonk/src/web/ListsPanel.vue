<template>
  <div class="space-y-5">
    <div v-if="error" class="crm-error">{{ error }}</div>

    <div v-if="lists.length" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="crm-panel px-4 py-3.5">
        <p class="text-xs font-medium text-text-ghost uppercase tracking-wider">
          {{ t('lists.stats.lists') }}
        </p>
        <p class="mt-1 text-2xl font-semibold text-text-primary tabular-nums">
          {{ n(lists.length, 'integer') }}
        </p>
      </div>
      <div class="crm-panel px-4 py-3.5">
        <p class="text-xs font-medium text-text-ghost uppercase tracking-wider">
          {{ t('lists.stats.active') }}
        </p>
        <p class="mt-1 text-2xl font-semibold text-text-primary tabular-nums">
          {{ n(activeCount, 'integer') }}
        </p>
      </div>
      <div class="crm-panel px-4 py-3.5">
        <p class="text-xs font-medium text-text-ghost uppercase tracking-wider">
          {{ t('lists.stats.subscribers') }}
        </p>
        <p class="mt-1 text-2xl font-semibold text-text-primary tabular-nums">
          {{ n(totalSubscribers, 'integer') }}
        </p>
      </div>
    </div>

    <p class="text-sm text-text-muted">{{ t('lists.formMappingHint') }}</p>

    <AppTable
      :loading="loading"
      :columns="columns"
      :rows="lists"
      :caption="t('lists.caption')"
      :empty-text="t('lists.empty')"
    >
      <template #cell-type="{ value }">
        <span
          class="inline-flex px-2 py-0.5 text-xs rounded-md border border-border bg-surface-raise text-text-secondary"
        >
          {{ typeLabel(value as string) }}
        </span>
      </template>
      <template #cell-status="{ value }">
        <span
          class="inline-flex px-2 py-0.5 text-xs rounded-md font-medium"
          :class="
            value === 'active'
              ? 'bg-success/15 text-success border border-success/20'
              : 'bg-surface-raise text-text-muted border border-border'
          "
        >
          {{ statusLabel(value as string) }}
        </span>
      </template>
      <template #cell-subscriberCount="{ value }">
        <span class="tabular-nums text-text-secondary font-medium">
          {{ n(value as number, 'integer') }}
        </span>
      </template>
      <template #cell-formId="{ row }">
        <div class="min-w-[12rem] max-w-[16rem]" @click.stop>
          <AppSelect
            :model-value="(row as ListmonkList).formId ?? ''"
            :options="formSelectOptions"
            :placeholder="t('lists.formNone')"
            :aria-label="t('lists.columns.form')"
            :disabled="savingListId === (row as ListmonkList).id"
            trigger-class="w-full"
            @update:model-value="(v) => onFormChange(row as ListmonkList, v)"
          />
        </div>
      </template>
    </AppTable>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { apiGet, apiPut } from '@khirby/web-api';
import AppTable, { type TableColumn } from '@khirby/web-ui/AppTable';
import AppSelect from '@khirby/web-ui/AppSelect';
import { useListmonkI18n } from './i18n';

interface ListmonkList {
  id: number;
  name: string;
  type: string;
  status: string;
  subscriberCount: number;
  formId: string | null;
  formName: string | null;
}

interface FormOption {
  id: string;
  name: string;
}

const { t, n } = useListmonkI18n();

const columns = computed<TableColumn[]>(() => [
  { key: 'name', label: t('lists.columns.name') },
  { key: 'type', label: t('lists.columns.type') },
  { key: 'status', label: t('lists.columns.status') },
  { key: 'subscriberCount', label: t('lists.columns.subscribers'), align: 'right' },
  { key: 'formId', label: t('lists.columns.form') },
]);

const TYPE_TOKENS = ['public', 'private'];
const STATUS_TOKENS = ['active', 'archived'];

function typeLabel(value: string): string {
  return TYPE_TOKENS.includes(value) ? t(`lists.type.${value}`) : value;
}

function statusLabel(value: string): string {
  return STATUS_TOKENS.includes(value) ? t(`lists.status.${value}`) : value;
}

const lists = ref<ListmonkList[]>([]);
const formOptions = ref<FormOption[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const savingListId = ref<number | null>(null);

const formSelectOptions = computed(() => [
  { value: '', label: t('lists.formNone') },
  ...formOptions.value.map((f) => ({ value: f.id, label: f.name })),
]);

const activeCount = computed(() => lists.value.filter((l) => l.status === 'active').length);
const totalSubscribers = computed(() => lists.value.reduce((sum, l) => sum + l.subscriberCount, 0));

async function fetchLists() {
  loading.value = true;
  error.value = null;
  try {
    const [listRes, forms] = await Promise.all([
      apiGet<ListmonkList[]>('/api/plugins/listmonk/lists'),
      apiGet<FormOption[]>('/api/plugins/listmonk/lists/form-options'),
    ]);
    lists.value = listRes;
    formOptions.value = forms;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('lists.loadFailed');
    lists.value = [];
  } finally {
    loading.value = false;
  }
}

async function onFormChange(row: ListmonkList, formId: string) {
  const next = formId || null;
  if ((row.formId ?? null) === next) return;
  savingListId.value = row.id;
  error.value = null;
  try {
    await apiPut(`/api/plugins/listmonk/lists/${row.id}/form`, { formId: next });
    row.formId = next;
    row.formName = next ? (formOptions.value.find((f) => f.id === next)?.name ?? null) : null;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('lists.formSaveFailed');
    await fetchLists();
  } finally {
    savingListId.value = null;
  }
}

onMounted(fetchLists);
defineExpose({ refresh: fetchLists });
</script>

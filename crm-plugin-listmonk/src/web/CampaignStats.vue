<template>
  <div class="crm-panel p-4 space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h3 class="text-sm font-semibold text-text-primary">{{ campaign.name }}</h3>
        <p class="text-xs text-text-muted mt-0.5">{{ campaign.subject }}</p>
      </div>
      <button type="button" class="btn-ghost px-2 py-1 text-xs" @click="$emit('close')">
        {{ t('actions.close') }}
      </button>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div>
        <p class="text-xs text-text-ghost uppercase tracking-wider">
          {{ t('campaigns.stats.sent') }}
        </p>
        <p class="mt-1 text-lg font-semibold tabular-nums text-text-primary">
          {{ n(campaign.sent, 'integer') }}
        </p>
      </div>
      <div>
        <p class="text-xs text-text-ghost uppercase tracking-wider">
          {{ t('campaigns.stats.opens') }}
        </p>
        <p class="mt-1 text-lg font-semibold tabular-nums text-text-primary">{{ openPct }}</p>
      </div>
      <div>
        <p class="text-xs text-text-ghost uppercase tracking-wider">
          {{ t('campaigns.stats.clicks') }}
        </p>
        <p class="mt-1 text-lg font-semibold tabular-nums text-text-primary">{{ clickPct }}</p>
      </div>
      <div>
        <p class="text-xs text-text-ghost uppercase tracking-wider">
          {{ t('campaigns.stats.replies') }}
        </p>
        <p class="mt-1 text-lg font-semibold tabular-nums text-text-primary">
          {{ n(repliesCount, 'integer') }}
        </p>
      </div>
    </div>

    <div class="flex gap-1 rounded-md bg-surface-input p-1 border border-border" role="tablist">
      <button
        v-for="tab in metricTabs"
        :key="tab"
        type="button"
        role="tab"
        :aria-selected="metric === tab"
        class="flex-1 text-xs font-medium py-1.5 rounded-md transition-colors"
        :class="
          metric === tab
            ? 'bg-surface-panel text-text-primary'
            : 'text-text-muted hover:text-text-secondary'
        "
        @click="metric = tab"
      >
        {{ t(`campaigns.stats.metric.${tab}`) }}
      </button>
    </div>

    <div v-if="loading" class="text-sm text-text-muted">{{ t('actions.loading') }}</div>
    <div v-else-if="error" class="crm-error">{{ error }}</div>
    <div v-else-if="!items.length" class="text-sm text-text-ghost">
      {{ t('campaigns.stats.empty') }}
    </div>
    <table v-else class="w-full text-sm">
      <thead>
        <tr class="text-left text-text-ghost text-xs uppercase tracking-wider">
          <th class="pb-2 font-medium">{{ t('campaigns.stats.day') }}</th>
          <th class="pb-2 font-medium text-right">{{ t('campaigns.stats.count') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.timestamp" class="border-t border-border-subtle">
          <td class="py-1.5 text-text-secondary font-mono text-xs">
            {{ item.timestamp.slice(0, 10) }}
          </td>
          <td class="py-1.5 text-right tabular-nums text-text-primary">
            {{ n(item.count, 'integer') }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { apiGet } from '@khirby/web-api';
import { useListmonkI18n } from './i18n';
import type { CampaignRow } from './CampaignList.vue';

const props = defineProps<{ campaign: CampaignRow }>();
defineEmits<{ (e: 'close'): void }>();

const { t, n } = useListmonkI18n();

const metricTabs = ['views', 'clicks', 'bounces'] as const;
type Metric = (typeof metricTabs)[number];
const metric = ref<Metric>('views');
const items = ref<{ campaignId: number; count: number; timestamp: string }[]>([]);
const repliesCount = ref(props.campaign.repliesCount);
const loading = ref(false);
const error = ref<string | null>(null);

const openPct = computed(() => {
  if (!props.campaign.sent) return '—';
  return `${Math.round((props.campaign.views / props.campaign.sent) * 100)}%`;
});

const clickPct = computed(() => {
  if (!props.campaign.sent) return '—';
  return `${Math.round((props.campaign.clicks / props.campaign.sent) * 100)}%`;
});

async function load() {
  loading.value = true;
  error.value = null;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  try {
    const res = await apiGet<{
      items: { campaignId: number; count: number; timestamp: string }[];
      repliesCount: number;
    }>(
      `/api/plugins/listmonk/campaigns/${props.campaign.id}/stats?type=${metric.value}&from=${from}&to=${to}`,
    );
    items.value = res.items;
    repliesCount.value = res.repliesCount;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('campaigns.stats.loadFailed');
    items.value = [];
  } finally {
    loading.value = false;
  }
}

watch(metric, load);
watch(
  () => props.campaign.id,
  () => {
    repliesCount.value = props.campaign.repliesCount;
    void load();
  },
);

onMounted(load);
</script>

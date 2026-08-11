<template>
  <div class="flex flex-col w-full space-y-5">
    <div class="crm-page-header">
      <div>
        <h2 class="crm-page-title">{{ t('title') }}</h2>
        <p class="text-sm text-text-muted mt-1">
          {{ t('subtitle') }}
          <RouterLink to="/plugins" class="text-accent hover:text-accent-hover transition-colors">
            {{ t('lists.configureLink') }}
          </RouterLink>
        </p>
      </div>
      <button
        v-if="active !== 'compose'"
        class="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50"
        :disabled="refreshing"
        @click="refresh"
      >
        {{ refreshing ? t('actions.refreshing') : t('actions.refresh') }}
      </button>
    </div>

    <div
      class="flex gap-1 rounded-md bg-surface-input p-1 border border-border w-full sm:w-auto sm:inline-flex"
      role="tablist"
      :aria-label="t('tabsAria')"
    >
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="active === tab.key"
        class="flex-1 sm:flex-none px-4 text-xs font-medium py-1.5 rounded-md transition-colors"
        :class="
          active === tab.key
            ? 'bg-surface-panel text-text-primary'
            : 'text-text-muted hover:text-text-secondary'
        "
        @click="active = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <CampaignList
      v-show="active === 'campaigns'"
      ref="campaignsRef"
      @create="openCompose(null)"
      @edit="openCompose"
    />
    <ListsPanel v-if="active === 'lists'" ref="listsRef" />
    <CampaignForm
      v-if="composeOpen"
      v-show="active === 'compose'"
      :key="composeKey"
      :campaign-id="composeId"
      @close="closeCompose"
      @saved="onComposeSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useListmonkI18n } from './i18n';
import CampaignList from './CampaignList.vue';
import CampaignForm from './CampaignForm.vue';
import ListsPanel from './ListsPanel.vue';

type TabKey = 'campaigns' | 'lists' | 'compose';

const { t } = useListmonkI18n();
const active = ref<TabKey>('campaigns');
const composeId = ref<number | null>(null);
const composeOpen = ref(false);
const refreshing = ref(false);
const campaignsRef = ref<{ refresh: () => Promise<void> } | null>(null);
const listsRef = ref<{ refresh: () => Promise<void> } | null>(null);

const composeKey = computed(() => (composeId.value != null ? `edit-${composeId.value}` : 'create'));

const tabs = computed<{ key: TabKey; label: string }[]>(() => {
  const base: { key: TabKey; label: string }[] = [
    { key: 'campaigns', label: t('tabs.campaigns') },
    { key: 'lists', label: t('tabs.lists') },
  ];
  if (composeOpen.value) {
    base.push({
      key: 'compose',
      label: composeId.value != null ? t('tabs.editCampaign') : t('tabs.newCampaign'),
    });
  }
  return base;
});

function openCompose(id: number | null) {
  composeId.value = id;
  composeOpen.value = true;
  active.value = 'compose';
}

function closeCompose() {
  composeOpen.value = false;
  composeId.value = null;
  active.value = 'campaigns';
}

async function onComposeSaved() {
  closeCompose();
  await campaignsRef.value?.refresh();
}

async function refresh() {
  refreshing.value = true;
  try {
    if (active.value === 'campaigns') await campaignsRef.value?.refresh();
    else if (active.value === 'lists') await listsRef.value?.refresh();
  } finally {
    refreshing.value = false;
  }
}
</script>

<script setup lang="ts" generic="T extends string | number">
import { computed } from 'vue';
import { echoSystem } from '@/native/echoSystem';

export interface SegmentedOption<V extends string | number = string | number> {
  id: V;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: T;
    options: ReadonlyArray<SegmentedOption<T>>;
    tabularNums?: boolean;
    variant?: 'default' | 'pill';
    size?: 'sm' | 'md';
  }>(),
  {
    tabularNums: false,
    variant: 'default',
    size: 'sm',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: T];
  change: [value: T];
}>();

const count = computed(() => Math.max(1, props.options.length));
const activeIndex = computed(() => {
  const idx = props.options.findIndex((o) => o.id === props.modelValue);
  return idx >= 0 ? idx : 0;
});

const groupStyle = computed(() => ({
  gridTemplateColumns: `repeat(${count.value}, minmax(0, 1fr))`,
}));

const thumbStyle = computed(() => {
  const insetPx = props.variant === 'pill' ? 8 : 6;
  return {
    width: `calc((100% - ${insetPx}px) / ${count.value})`,
    transform: `translate3d(${activeIndex.value * 100}%, 0, 0)`,
  };
});

function selectOption(id: T) {
  if (id === props.modelValue) return;
  echoSystem.haptic('selection');
  emit('update:modelValue', id);
  emit('change', id);
}
</script>

<template>
  <div
    class="pt-seg-group"
    :class="variant === 'pill' ? '!p-1 !rounded-full' : ''"
    :style="groupStyle"
    role="tablist"
    data-segmented-control
  >
    <div
      class="pt-seg-thumb"
      :class="variant === 'pill' ? '!top-1 !bottom-1 !left-1 !rounded-full' : ''"
      :style="thumbStyle"
    />
    <button
      v-for="opt in options"
      :key="String(opt.id)"
      type="button"
      role="tab"
      :aria-selected="modelValue === opt.id"
      class="pt-seg-btn bg-transparent"
      :class="[
        modelValue === opt.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
        tabularNums ? 'tabular-nums' : '',
        size === 'md' ? '!h-8 !text-[12.5px]' : '',
        variant === 'pill' ? '!rounded-full' : '',
      ]"
      @click="selectOption(opt.id)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

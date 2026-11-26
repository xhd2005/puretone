import { computed, ref, type Ref } from 'vue';
import { echoSystem } from '@/native/echoSystem';

export interface DraggableSheetOptions {
  /** Height detents as viewport height ratios (ascending), e.g. [0.60, 0.92] */
  detents?: number[];
  /** Index into detents when sheet opens */
  initialDetentIndex?: number;
  /** Optional ref to inner scrollable element for seamless pull-down at top */
  scrollElRef?: Ref<HTMLElement | null>;
  /** Called when user drags past dismiss threshold or flicks downward */
  onDismiss: () => void;
}

/**
 * Pure GPU offset calculator (zero CSS height reflows!):
 * Keeps the sheet at fixed max detent height and expresses intermediate detents & drags
 * purely via Y-axis translate3d(0, offsetPx, 0) with gentle upward rubber-banding.
 */
export function computeDetentOffsetPx(
  detents: number[],
  detentIndex: number,
  viewportH: number,
  dragDeltaY: number,
): number {
  const vh = Math.max(400, Number.isFinite(viewportH) ? viewportH : 840);
  if (!detents.length) {
    return dragDeltaY >= 0 ? Math.round(dragDeltaY) : Math.round(dragDeltaY * 0.16);
  }
  const sorted = [...detents].sort((a, b) => a - b);
  const clampedIdx = Math.min(Math.max(0, detentIndex), sorted.length - 1);
  const maxPx = sorted[sorted.length - 1] * vh;
  const baseOffset = Math.max(0, maxPx - sorted[clampedIdx] * vh);
  const raw = baseOffset + dragDeltaY;
  if (raw < 0) {
    // Subtle rubber-band resistance above max detent
    return Math.round(raw * 0.16);
  }
  return Math.round(raw);
}

/**
 * 120fps GPU-composited iOS bottom sheet drag controller.
 * IMPORTANT: Always wrap the panel inside an outer `.lg-sheet-slide` handled by Vue
 * `<Transition name="lg-modal">` so enter/leave slide-up animations are NEVER overridden!
 */
export function useDraggableSheet(options: DraggableSheetOptions) {
  const detents = options.detents && options.detents.length ? [...options.detents].sort((a, b) => a - b) : [];
  const defaultIdx = Math.min(
    Math.max(0, options.initialDetentIndex ?? Math.max(0, detents.length - 1)),
    Math.max(0, detents.length - 1),
  );

  const detentIndex = ref(defaultIdx);
  const isDragging = ref(false);
  const dragDeltaY = ref(0);

  let startY = 0;
  let lastY = 0;
  let lastAt = 0;
  let velocityY = 0; // px/ms
  let active = false;

  function reset() {
    detentIndex.value = defaultIdx;
    isDragging.value = false;
    dragDeltaY.value = 0;
    active = false;
  }

  function getViewportH(): number {
    return typeof window !== 'undefined' ? Math.max(480, window.innerHeight) : 840;
  }

  const sheetStyle = computed((): Record<string, string> => {
    const vh = getViewportH();
    const maxDetent = detents.length ? detents[detents.length - 1] : 0;
    const offsetY = computeDetentOffsetPx(detents, detentIndex.value, vh, isDragging.value ? dragDeltaY.value : 0);

    const style: Record<string, string> = {};
    if (maxDetent > 0) {
      style.height = `${Math.round(maxDetent * vh)}px`;
    }
    if (isDragging.value) {
      style.transform = `translate3d(0, ${offsetY}px, 0)`;
      style.transition = 'none';
    } else if (offsetY !== 0) {
      style.transform = `translate3d(0, ${offsetY}px, 0)`;
      style.transition = 'transform 340ms var(--spring-ease)';
    } else {
      style.transform = 'translate3d(0, 0, 0)';
      style.transition = 'transform 340ms var(--spring-ease)';
    }
    return style;
  });

  function beginDrag(clientY: number) {
    active = true;
    isDragging.value = true;
    startY = clientY;
    lastY = clientY;
    lastAt = performance.now();
    velocityY = 0;
    dragDeltaY.value = 0;
  }

  function updateDrag(clientY: number) {
    if (!active) return;
    const now = performance.now();
    const dt = Math.max(1, now - lastAt);
    velocityY = (clientY - lastY) / dt;
    lastY = clientY;
    lastAt = now;
    dragDeltaY.value = clientY - startY;
  }

  function endDrag() {
    if (!active) return;
    active = false;
    isDragging.value = false;

    const dy = dragDeltaY.value;
    const vy = velocityY;
    dragDeltaY.value = 0;

    if (detents.length > 0) {
      const vh = getViewportH();
      const basePx = detents[detentIndex.value] * vh;
      const projectedH = basePx - dy - vy * 140;
      const minPx = detents[0] * vh;

      // Fast downward flick or pulled clearly below lowest detent -> dismiss
      if ((vy > 0.72 && detentIndex.value === 0) || projectedH < minPx - 115 || (vy > 1.2 && dy > 85)) {
        echoSystem.haptic('light');
        options.onDismiss();
        return;
      }

      // Snap to closest detent
      let bestIdx = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < detents.length; i += 1) {
        const dist = Math.abs(projectedH - detents[i] * vh);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx !== detentIndex.value) {
        detentIndex.value = bestIdx;
        echoSystem.haptic('selection');
      }
      return;
    }

    // Single-detent sheet dismiss check
    if (dy > 96 || (vy > 0.62 && dy > 38)) {
      echoSystem.haptic('light');
      options.onDismiss();
    }
  }

  // Handle/Header direct touch handlers
  function onHandleTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    beginDrag(t.clientY);
  }

  function onHandleTouchMove(e: TouchEvent) {
    if (!active) return;
    const t = e.touches[0];
    if (!t) return;
    if (e.cancelable) e.preventDefault();
    updateDrag(t.clientY);
  }

  function onHandleTouchEnd() {
    endDrag();
  }

  // Scroll-container top-chaining (pull down smoothly when scrolled to very top)
  let bodyStartY = 0;
  let bodyTracking = false;

  function onBodyTouchStart(e: TouchEvent) {
    const scroller = options.scrollElRef?.value;
    if (!scroller || scroller.scrollTop > 2) {
      bodyTracking = false;
      return;
    }
    bodyStartY = e.touches[0]?.clientY ?? 0;
    bodyTracking = true;
  }

  function onBodyTouchMove(e: TouchEvent) {
    if (!bodyTracking) return;
    const scroller = options.scrollElRef?.value;
    const curY = e.touches[0]?.clientY ?? bodyStartY;
    const dy = curY - bodyStartY;

    if (!active) {
      if (dy > 14 && (!scroller || scroller.scrollTop <= 2)) {
        beginDrag(bodyStartY);
        updateDrag(curY);
      } else if (dy < -6) {
        bodyTracking = false;
      }
    } else {
      if (e.cancelable) e.preventDefault();
      updateDrag(curY);
    }
  }

  function onBodyTouchEnd() {
    bodyTracking = false;
    if (active) endDrag();
  }

  return {
    detentIndex,
    isDragging,
    sheetStyle,
    reset,
    onHandleTouchStart,
    onHandleTouchMove,
    onHandleTouchEnd,
    onBodyTouchStart,
    onBodyTouchMove,
    onBodyTouchEnd,
  };
}

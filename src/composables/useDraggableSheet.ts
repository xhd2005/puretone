import { computed, ref, type Ref } from 'vue';
import { echoSystem } from '@/native/echoSystem';

export interface DraggableSheetOptions {
  /** Height detents as viewport height ratios (ascending), e.g. [0.58, 0.92] */
  detents?: number[];
  /** Index into detents when sheet opens */
  initialDetentIndex?: number;
  /** Optional ref to inner scrollable element for seamless pull-down at top */
  scrollElRef?: Ref<HTMLElement | null>;
  /** Called when user drags past dismiss threshold or flicks downward */
  onDismiss: () => void;
}

/**
 * iOS-style magnetic draggable bottom sheet controller.
 * Supports multi-detent height snapping (half <-> full <-> dismiss) + rubber-band resistance
 * + velocity flick detection + seamless chaining when inner list is scrolled to top.
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

    if (detents.length > 0) {
      const basePx = Math.round(detents[detentIndex.value] * vh);
      const maxPx = Math.round(detents[detents.length - 1] * vh);
      const minPx = Math.round(detents[0] * vh);

      if (!isDragging.value) {
        return {
          height: `${basePx}px`,
          transform: 'translate3d(0, 0, 0)',
          transition: 'height 380ms var(--spring-ease), transform 380ms var(--spring-ease)',
        };
      }

      const rawTargetH = basePx - dragDeltaY.value;
      if (rawTargetH > maxPx) {
        // Gentle upward rubber-band beyond max detent
        const extra = (rawTargetH - maxPx) * 0.22;
        return {
          height: `${Math.round(maxPx + extra)}px`,
          transform: 'translate3d(0, 0, 0)',
          transition: 'none',
        };
      }
      if (rawTargetH >= minPx) {
        return {
          height: `${Math.round(rawTargetH)}px`,
          transform: 'translate3d(0, 0, 0)',
          transition: 'none',
        };
      }
      // Below min detent -> keep minPx height and smoothly translate downward toward dismissal
      const downOffset = minPx - rawTargetH;
      return {
        height: `${minPx}px`,
        transform: `translate3d(0, ${Math.round(downOffset)}px, 0)`,
        transition: 'none',
      };
    }

    // Auto-height sheet (pull down to dismiss, subtle rubber-band upward)
    if (!isDragging.value) {
      return {
        transform: 'translate3d(0, 0, 0)',
        transition: 'transform 360ms var(--spring-ease)',
      };
    }
    const y = dragDeltaY.value >= 0 ? dragDeltaY.value : dragDeltaY.value * 0.18;
    return {
      transform: `translate3d(0, ${Math.round(y)}px, 0)`,
      transition: 'none',
    };
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

      // Fast downward flick or pulled significantly below lowest detent -> dismiss
      if ((vy > 0.72 && detentIndex.value === 0) || projectedH < minPx - 125 || (vy > 1.25 && dy > 90)) {
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
    if (dy > 105 || (vy > 0.65 && dy > 42)) {
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

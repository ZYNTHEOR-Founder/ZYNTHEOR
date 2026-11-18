/**
 * Global UI Button Interaction Error Interceptor
 *
 * Captures and reports failing, blocked, occluded, handlerless, or throwing
 * button/trigger interactions to the browser console with structured element
 * state and handler failure trace logs, cleanly distinguishing UI-only
 * interaction errors from backend API errors, and notifies subscribers when a
 * critical user action fails.
 */

export type ButtonFailureCategory = 'UI_INTERACTION_ERROR' | 'BACKEND_API_ERROR';

export type ButtonFailureKind =
  | 'disabled_control'
  | 'occluded_trigger'
  | 'missing_handler'
  | 'uncaught_handler_error'
  | 'async_handler_rejection'
  | 'http_api_error'
  | 'network_api_error';

export interface TriggerSnapshot {
  tag: string;
  id: string | null;
  testId: string | null;
  ariaLabel: string | null;
  text: string;
  type: string | null;
  disabled: boolean;
  ariaDisabled: boolean;
  pointerEvents: string;
  selector: string;
  timestamp: number;
}

export interface ElementStateSnapshot {
  disabled: boolean;
  ariaDisabled: boolean;
  pointerEvents: string;
  hidden: boolean;
  connected: boolean;
  closestForm: boolean;
  boundingRect: { x: number; y: number; width: number; height: number } | null;
  occludingElement?: string | null;
  occludingZIndex?: string | null;
}

export interface HandlerFailureContext {
  eventType: string;
  hasReactProps: boolean;
  reactHandlerKeys: string[];
  hasNativeOnClick: boolean;
  isFormSubmit: boolean;
  source?: string;
  stack?: string;
}

export interface BackendApiFailureContext {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  error?: string;
}

export interface ButtonFailureReport {
  id: string;
  category: ButtonFailureCategory;
  kind: ButtonFailureKind;
  critical: boolean;
  timestamp: number;
  message: string;
  trigger: TriggerSnapshot;
  elementState: ElementStateSnapshot;
  handlerContext: HandlerFailureContext;
  apiContext?: BackendApiFailureContext;
}

interface InteractionContext {
  trigger: TriggerSnapshot;
  elementState: ElementStateSnapshot;
  handlerContext: HandlerFailureContext;
  eventType: string;
}

export interface ButtonInterceptorOptions {
  correlationWindowMs?: number;
  logSuccessfulClicks?: boolean;
}

type FailureListener = (report: ButtonFailureReport) => void;

const INTERACTIVE_SELECTOR =
  'button, [role="button"], input[type="button"], input[type="submit"], a[href], [data-testid]';
const DEFAULT_WINDOW_MS = 2500;

let activeCleanup: (() => void) | null = null;
const failureListeners = new Set<FailureListener>();
let failureSeq = 0;

export function onButtonFailure(listener: FailureListener): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

function notifyFailureListeners(report: ButtonFailureReport): void {
  for (const listener of failureListeners) {
    try {
      listener(report);
    } catch {
      // Listener errors must never destabilize interaction diagnostics
    }
  }
}

function compactSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const testId = el.getAttribute('data-testid');
  if (testId) return `${tag}[data-testid="${testId}"]`;
  if (el.id) return `${tag}#${el.id}`;
  const aria = el.getAttribute('aria-label');
  if (aria) return `${tag}[aria-label="${aria.slice(0, 40)}"]`;
  const cls =
    typeof el.className === 'string'
      ? el.className
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .join('.')
      : '';
  return cls ? `${tag}.${cls}` : tag;
}

export function describeTriggerElement(el: Element): TriggerSnapshot {
  const htmlEl = el as HTMLElement;
  const computed =
    typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(el)
      : null;
  const text = (htmlEl.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const disabledAttr = (el as HTMLButtonElement).disabled === true || el.hasAttribute('disabled');
  const ariaDisabled = el.getAttribute('aria-disabled') === 'true';

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    testId: el.getAttribute('data-testid'),
    ariaLabel: el.getAttribute('aria-label'),
    text,
    type: el.getAttribute('type'),
    disabled: disabledAttr,
    ariaDisabled,
    pointerEvents: computed?.pointerEvents ?? 'auto',
    selector: compactSelector(el),
    timestamp: Date.now(),
  };
}

function inspectHandlerDetails(el: Element): {
  hasHandler: boolean;
  hasReactProps: boolean;
  reactHandlerKeys: string[];
  hasNativeOnClick: boolean;
  isFormSubmit: boolean;
} {
  let hasReactProps = false;
  const reactHandlerKeys: string[] = [];
  let hasNativeOnClick = false;
  const isFormSubmit =
    (el.tagName === 'BUTTON' || el.tagName === 'INPUT') &&
    el.getAttribute('type') === 'submit' &&
    Boolean(el.closest('form'));

  let cur: Element | null = el;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const htmlCur = cur as HTMLElement & Record<string, unknown>;
    if (typeof htmlCur.onclick === 'function' || typeof htmlCur.onpointerdown === 'function') {
      hasNativeOnClick = true;
    }

    for (const k of Object.keys(htmlCur)) {
      if (k.startsWith('__reactProps$')) {
        hasReactProps = true;
        const props = htmlCur[k] as Record<string, unknown> | undefined;
        if (props) {
          for (const handlerName of [
            'onClick',
            'onClickCapture',
            'onPointerDown',
            'onMouseDown',
            'onTouchEnd',
          ]) {
            if (typeof props[handlerName] === 'function') {
              reactHandlerKeys.push(`${compactSelector(cur)}:${handlerName}`);
            }
          }
        }
      }
    }

    if (cur.tagName === 'A' && cur.hasAttribute('href')) {
      return {
        hasHandler: true,
        hasReactProps,
        reactHandlerKeys,
        hasNativeOnClick,
        isFormSubmit,
      };
    }

    cur = cur.parentElement;
  }

  const hasAnyHandler =
    hasNativeOnClick || reactHandlerKeys.length > 0 || isFormSubmit || !hasReactProps;

  return {
    hasHandler: hasAnyHandler,
    hasReactProps,
    reactHandlerKeys,
    hasNativeOnClick,
    isFormSubmit,
  };
}

function captureElementState(
  el: Element,
  snapshot: TriggerSnapshot,
  occlusion?: { blockingElement: string; blockingZIndex: string }
): ElementStateSnapshot {
  const htmlEl = el as HTMLElement & {
    isConnected?: boolean;
    getBoundingClientRect?: () => DOMRect;
  };
  let rect: ElementStateSnapshot['boundingRect'] = null;
  if (typeof htmlEl.getBoundingClientRect === 'function') {
    const r = htmlEl.getBoundingClientRect();
    rect = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }
  const computed =
    typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? (window.getComputedStyle(el) as CSSStyleDeclaration & { visibility?: string; display?: string })
      : null;

  return {
    disabled: snapshot.disabled,
    ariaDisabled: snapshot.ariaDisabled,
    pointerEvents: snapshot.pointerEvents,
    hidden:
      el.hasAttribute('hidden') ||
      computed?.display === 'none' ||
      computed?.visibility === 'hidden',
    connected: htmlEl.isConnected !== false,
    closestForm: Boolean(el.closest('form')),
    boundingRect: rect,
    occludingElement: occlusion?.blockingElement ?? null,
    occludingZIndex: occlusion?.blockingZIndex ?? null,
  };
}

function emitDetailedTrace(
  level: 'warn' | 'error',
  headline: string,
  legacyLogPayload: Record<string, unknown>,
  report: ButtonFailureReport
): void {
  const groupFn = typeof console.groupCollapsed === 'function' ? console.groupCollapsed : null;
  const groupEndFn = typeof console.groupEnd === 'function' ? console.groupEnd : null;
  const traceFn = typeof console.trace === 'function' ? console.trace : null;

  if (level === 'warn') {
    console.warn(headline, legacyLogPayload);
  } else {
    console.error(headline, legacyLogPayload);
  }

  if (groupFn && groupEndFn) {
    try {
      groupFn(
        `[UI-Button-Trace][${report.category}] ${report.kind} -> ${report.trigger.selector}`
      );
      console.log('Element State:', report.elementState);
      console.log('Handler Context:', report.handlerContext);
      if (report.apiContext) {
        console.log('Backend API Context:', report.apiContext);
      }
      if (traceFn) {
        traceFn('Interaction stack trace');
      }
    } finally {
      groupEndFn();
    }
  }

  notifyFailureListeners(report);
}

function findTriggerFromElements(elements: EventTarget[] | Element[]): Element | null {
  for (const node of elements) {
    if (node instanceof Element) {
      const match = node.closest(INTERACTIVE_SELECTOR);
      if (match) return match;
    }
  }
  return null;
}

function safeRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function safeRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request && input.method) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

export function installButtonErrorInterceptor(options: ButtonInterceptorOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  if (activeCleanup) {
    return activeCleanup;
  }

  const windowMs = options.correlationWindowMs ?? DEFAULT_WINDOW_MS;
  let lastInteraction: InteractionContext | null = null;
  let lastDisabledWarnAt = 0;

  const isRecent = (ctx: InteractionContext | null): ctx is InteractionContext =>
    Boolean(ctx && Date.now() - ctx.trigger.timestamp <= windowMs);

  const buildInteractionContext = (
    trigger: Element,
    eventType: string,
    occlusion?: { blockingElement: string; blockingZIndex: string }
  ): InteractionContext => {
    const snapshot = describeTriggerElement(trigger);
    const handlerInfo = inspectHandlerDetails(trigger);
    return {
      trigger: snapshot,
      elementState: captureElementState(trigger, snapshot, occlusion),
      handlerContext: {
        eventType,
        hasReactProps: handlerInfo.hasReactProps,
        reactHandlerKeys: handlerInfo.reactHandlerKeys,
        hasNativeOnClick: handlerInfo.hasNativeOnClick,
        isFormSubmit: handlerInfo.isFormSubmit,
      },
      eventType,
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    try {
      const pointEls =
        typeof document.elementsFromPoint === 'function'
          ? document.elementsFromPoint(event.clientX, event.clientY)
          : [];
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const trigger = findTriggerFromElements(pointEls) || findTriggerFromElements(path);
      if (!trigger) return;

      const ctx = buildInteractionContext(trigger, 'pointerdown');
      lastInteraction = ctx;
      const snapshot = ctx.trigger;

      if (snapshot.disabled || snapshot.ariaDisabled || snapshot.pointerEvents === 'none') {
        const now = Date.now();
        if (now - lastDisabledWarnAt > 200) {
          lastDisabledWarnAt = now;
          const reason = snapshot.disabled
            ? 'HTML disabled attribute is set'
            : snapshot.ariaDisabled
              ? 'aria-disabled="true" is set'
              : 'CSS pointer-events: none';
          emitDetailedTrace(
            'warn',
            '[UI-Button-Interceptor] Interaction blocked on disabled/inert control:',
            {
              category: 'UI_INTERACTION_ERROR',
              selector: snapshot.selector,
              text: snapshot.text,
              disabled: snapshot.disabled,
              ariaDisabled: snapshot.ariaDisabled,
              pointerEvents: snapshot.pointerEvents,
              reason,
              elementState: ctx.elementState,
              handlerContext: ctx.handlerContext,
            },
            {
              id: `btn-err-${++failureSeq}`,
              category: 'UI_INTERACTION_ERROR',
              kind: 'disabled_control',
              critical: false,
              timestamp: Date.now(),
              message: `${snapshot.text || snapshot.selector}: ${reason}`,
              trigger: snapshot,
              elementState: ctx.elementState,
              handlerContext: ctx.handlerContext,
            }
          );
        }
        return;
      }

      const topEl =
        typeof document.elementFromPoint === 'function'
          ? document.elementFromPoint(event.clientX, event.clientY)
          : null;
      if (topEl && topEl !== trigger && !trigger.contains(topEl) && !topEl.contains(trigger)) {
        const blockingStyle = window.getComputedStyle(topEl);
        const blockingElement = compactSelector(topEl);
        const occludedState = captureElementState(trigger, snapshot, {
          blockingElement,
          blockingZIndex: blockingStyle.zIndex,
        });
        emitDetailedTrace(
          'warn',
          '[UI-Button-Interceptor] Trigger occluded by overlapping element:',
          {
            category: 'UI_INTERACTION_ERROR',
            trigger: snapshot.selector,
            triggerText: snapshot.text,
            blockingElement,
            blockingZIndex: blockingStyle.zIndex,
            coordinates: { x: Math.round(event.clientX), y: Math.round(event.clientY) },
            elementState: occludedState,
            handlerContext: ctx.handlerContext,
          },
          {
            id: `btn-err-${++failureSeq}`,
            category: 'UI_INTERACTION_ERROR',
            kind: 'occluded_trigger',
            critical: true,
            timestamp: Date.now(),
            message: `Trigger '${snapshot.text || snapshot.selector}' is occluded by '${blockingElement}' (z-index: ${blockingStyle.zIndex}).`,
            trigger: snapshot,
            elementState: occludedState,
            handlerContext: ctx.handlerContext,
          }
        );
      }
    } catch {
      // Diagnostics must never break user interaction
    }
  };

  const onClickCapture = (event: MouseEvent) => {
    try {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const fallbackTarget = event.target instanceof Element ? [event.target] : [];
      const trigger = findTriggerFromElements(path.length ? path : fallbackTarget);
      if (!trigger) return;

      const ctx = buildInteractionContext(trigger, 'click');
      lastInteraction = ctx;
      const snapshot = ctx.trigger;

      if (snapshot.disabled || snapshot.ariaDisabled) {
        emitDetailedTrace(
          'warn',
          '[UI-Button-Interceptor] Click intercepted on disabled control:',
          {
            ...snapshot,
            category: 'UI_INTERACTION_ERROR',
            elementState: ctx.elementState,
            handlerContext: ctx.handlerContext,
          },
          {
            id: `btn-err-${++failureSeq}`,
            category: 'UI_INTERACTION_ERROR',
            kind: 'disabled_control',
            critical: false,
            timestamp: Date.now(),
            message: `Control '${snapshot.text || snapshot.selector}' is disabled.`,
            trigger: snapshot,
            elementState: ctx.elementState,
            handlerContext: ctx.handlerContext,
          }
        );
        return;
      }

      const handlerDetails = inspectHandlerDetails(trigger);
      if (trigger.tagName === 'BUTTON' && !handlerDetails.hasHandler) {
        emitDetailedTrace(
          'warn',
          '[UI-Button-Interceptor] Button clicked without an attached click handler:',
          {
            category: 'UI_INTERACTION_ERROR',
            selector: snapshot.selector,
            text: snapshot.text,
            type: snapshot.type,
            elementState: ctx.elementState,
            handlerContext: ctx.handlerContext,
          },
          {
            id: `btn-err-${++failureSeq}`,
            category: 'UI_INTERACTION_ERROR',
            kind: 'missing_handler',
            critical: true,
            timestamp: Date.now(),
            message: `Button '${snapshot.text || snapshot.selector}' has no attached click or submit handler.`,
            trigger: snapshot,
            elementState: ctx.elementState,
            handlerContext: ctx.handlerContext,
          }
        );
      } else if (options.logSuccessfulClicks) {
        console.debug('[UI-Button-Interceptor] Trigger activated:', snapshot);
      }
    } catch {
      // Never interfere with click propagation
    }
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const trigger = target.closest(INTERACTIVE_SELECTOR);
    if (!trigger) return;
    lastInteraction = buildInteractionContext(trigger, `keydown:${event.key}`);
  };

  const onWindowError = (event: ErrorEvent) => {
    if (!isRecent(lastInteraction)) return;
    const source = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined;
    const message = event.message || event.error?.message || 'Unknown error';
    const handlerCtx: HandlerFailureContext = {
      ...lastInteraction.handlerContext,
      source,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    };
    emitDetailedTrace(
      'error',
      '[UI-Button-Interceptor] Button handler threw an uncaught error:',
      {
        category: 'UI_INTERACTION_ERROR',
        trigger: lastInteraction.trigger,
        eventType: lastInteraction.eventType,
        message,
        source,
        error: event.error,
        elementState: lastInteraction.elementState,
        handlerContext: handlerCtx,
      },
      {
        id: `btn-err-${++failureSeq}`,
        category: 'UI_INTERACTION_ERROR',
        kind: 'uncaught_handler_error',
        critical: true,
        timestamp: Date.now(),
        message,
        trigger: lastInteraction.trigger,
        elementState: lastInteraction.elementState,
        handlerContext: handlerCtx,
      }
    );
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (!isRecent(lastInteraction)) return;
    const reason =
      event.reason instanceof Error
        ? { name: event.reason.name, message: event.reason.message, stack: event.reason.stack }
        : event.reason;
    const message =
      event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'Async rejection');
    const handlerCtx: HandlerFailureContext = {
      ...lastInteraction.handlerContext,
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
    };
    emitDetailedTrace(
      'error',
      '[UI-Button-Interceptor] Async button handler rejected:',
      {
        category: 'UI_INTERACTION_ERROR',
        trigger: lastInteraction.trigger,
        eventType: lastInteraction.eventType,
        reason,
        elementState: lastInteraction.elementState,
        handlerContext: handlerCtx,
      },
      {
        id: `btn-err-${++failureSeq}`,
        category: 'UI_INTERACTION_ERROR',
        kind: 'async_handler_rejection',
        critical: true,
        timestamp: Date.now(),
        message,
        trigger: lastInteraction.trigger,
        elementState: lastInteraction.elementState,
        handlerContext: handlerCtx,
      }
    );
  };

  let restoreFetch: (() => void) | null = null;
  const rawFetch = typeof window.fetch === 'function' ? window.fetch : null;
  const originalFetch = rawFetch ? rawFetch.bind(window) : null;
  if (rawFetch && originalFetch) {
    const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const capturedInteraction = isRecent(lastInteraction) ? lastInteraction : null;
      const url = safeRequestUrl(input);
      const method = safeRequestMethod(input, init);
      try {
        const res = await originalFetch(input, init);
        if (!res.ok && capturedInteraction) {
          const apiCtx: BackendApiFailureContext = {
            method,
            url,
            status: res.status,
            statusText: res.statusText,
          };
          emitDetailedTrace(
            'error',
            '[UI-Button-Interceptor] HTTP request triggered by button returned error:',
            {
              category: 'BACKEND_API_ERROR',
              trigger: capturedInteraction.trigger,
              method,
              url,
              status: res.status,
              statusText: res.statusText,
              elementState: capturedInteraction.elementState,
              handlerContext: capturedInteraction.handlerContext,
            },
            {
              id: `btn-err-${++failureSeq}`,
              category: 'BACKEND_API_ERROR',
              kind: 'http_api_error',
              critical: true,
              timestamp: Date.now(),
              message: `${method} ${url} returned HTTP ${res.status} ${res.statusText || ''}`.trim(),
              trigger: capturedInteraction.trigger,
              elementState: capturedInteraction.elementState,
              handlerContext: capturedInteraction.handlerContext,
              apiContext: apiCtx,
            }
          );
        }
        return res;
      } catch (err) {
        if (capturedInteraction) {
          const errMessage = err instanceof Error ? err.message : String(err);
          const apiCtx: BackendApiFailureContext = {
            method,
            url,
            error: errMessage,
          };
          emitDetailedTrace(
            'error',
            '[UI-Button-Interceptor] Network request triggered by button failed:',
            {
              category: 'BACKEND_API_ERROR',
              trigger: capturedInteraction.trigger,
              method,
              url,
              error: errMessage,
              elementState: capturedInteraction.elementState,
              handlerContext: capturedInteraction.handlerContext,
            },
            {
              id: `btn-err-${++failureSeq}`,
              category: 'BACKEND_API_ERROR',
              kind: 'network_api_error',
              critical: true,
              timestamp: Date.now(),
              message: `${method} ${url} failed: ${errMessage}`,
              trigger: capturedInteraction.trigger,
              elementState: capturedInteraction.elementState,
              handlerContext: capturedInteraction.handlerContext,
              apiContext: apiCtx,
            }
          );
        }
        throw err;
      }
    };

    try {
      const ownDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
      const canRedefine = !ownDesc || ownDesc.configurable || ownDesc.writable === true;
      if (canRedefine) {
        Object.defineProperty(window, 'fetch', {
          value: wrappedFetch,
          configurable: true,
          writable: true,
          enumerable: ownDesc ? ownDesc.enumerable : true,
        });
        restoreFetch = () => {
          try {
            if (ownDesc) {
              Object.defineProperty(window, 'fetch', ownDesc);
            } else {
              delete (window as unknown as Record<string, unknown>).fetch;
              if (window.fetch !== rawFetch) {
                Object.defineProperty(window, 'fetch', {
                  value: rawFetch,
                  configurable: true,
                  writable: true,
                  enumerable: true,
                });
              }
            }
          } catch {
            // Best-effort cleanup in restricted browser sandboxes
          }
        };
      }
    } catch {
      // Some sandboxed environments lock down window.fetch; keep DOM/error listeners active without crashing
    }
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKeyDownCapture, true);
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  const cleanup = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('keydown', onKeyDownCapture, true);
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    if (activeCleanup === cleanup) {
      activeCleanup = null;
    }
  };

  activeCleanup = cleanup;
  return cleanup;
}

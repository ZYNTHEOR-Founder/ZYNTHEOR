/**
 * Unit Tests for Global UI Button Interaction Error Interceptor
 *
 * Exercises disabled/inert clicks, occluded trigger detection, missing React/DOM
 * handler warnings, uncaught error & unhandled rejection correlation, and
 * fetch HTTP >= 400 / network failure logging without mutating DOM or consuming bodies.
 */

import assert from 'node:assert/strict';
import {
  describeTriggerElement,
  installButtonErrorInterceptor,
  onButtonFailure,
  ButtonFailureReport,
} from '../src/utils/buttonErrorInterceptor.ts';

type ListenerFn = (ev: any) => void;

class MockElement {
  tagName: string;
  id = '';
  className = '';
  innerText = '';
  textContent = '';
  disabled = false;
  parentElement: MockElement | null = null;
  children: MockElement[] = [];
  attrs = new Map<string, string>();
  onclick: ((ev: any) => void) | null = null;
  onpointerdown: ((ev: any) => void) | null = null;
  [key: string]: any;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
    if (name === 'id') this.id = value;
    if (name === 'disabled') this.disabled = true;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name) || (name === 'disabled' && this.disabled);
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  contains(other: unknown): boolean {
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }

  closest(selector: string): MockElement | null {
    const tokens = selector.split(',').map((s) => s.trim());
    let cur: MockElement | null = this;
    while (cur) {
      for (const tok of tokens) {
        if (tok === 'button' && cur.tagName === 'BUTTON') return cur;
        if (tok === '[role="button"]' && cur.getAttribute('role') === 'button') return cur;
        if (tok === 'input[type="button"]' && cur.tagName === 'INPUT' && cur.getAttribute('type') === 'button') {
          return cur;
        }
        if (tok === 'input[type="submit"]' && cur.tagName === 'INPUT' && cur.getAttribute('type') === 'submit') {
          return cur;
        }
        if (tok === 'a[href]' && cur.tagName === 'A' && cur.hasAttribute('href')) return cur;
        if (tok === '[data-testid]' && cur.hasAttribute('data-testid')) return cur;
        if (tok === 'form' && cur.tagName === 'FORM') return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }
}

function createDomShim() {
  const docListeners = new Map<string, ListenerFn[]>();
  const winListeners = new Map<string, ListenerFn[]>();
  let elementsAtPoint: MockElement[] = [];
  let topElementAtPoint: MockElement | null = null;
  const computedStyles = new WeakMap<object, { pointerEvents: string; zIndex: string }>();

  const body = new MockElement('body');
  const documentElement = new MockElement('html');
  documentElement.appendChild(body);

  const docShim: any = {
    body,
    documentElement,
    elementsFromPoint: () => elementsAtPoint,
    elementFromPoint: () => topElementAtPoint,
    addEventListener(type: string, fn: ListenerFn) {
      const list = docListeners.get(type) ?? [];
      list.push(fn);
      docListeners.set(type, list);
    },
    removeEventListener(type: string, fn: ListenerFn) {
      const list = docListeners.get(type) ?? [];
      docListeners.set(
        type,
        list.filter((f) => f !== fn)
      );
    },
    dispatch(type: string, ev: any) {
      for (const fn of docListeners.get(type) ?? []) {
        fn(ev);
      }
    },
  };

  const originalFetchCalls: Array<{ url: string; method: string }> = [];
  let fetchResponder: (input: any, init?: any) => Promise<any> = async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 });

  const baseFetch = async (input: any, init?: any) => {
    originalFetchCalls.push({ url: String(input), method: init?.method || 'GET' });
    return fetchResponder(input, init);
  };

  const winShim: any = {
    fetch: baseFetch,
    getComputedStyle(el: MockElement) {
      return computedStyles.get(el) ?? { pointerEvents: 'auto', zIndex: 'auto' };
    },
    addEventListener(type: string, fn: ListenerFn) {
      const list = winListeners.get(type) ?? [];
      list.push(fn);
      winListeners.set(type, list);
    },
    removeEventListener(type: string, fn: ListenerFn) {
      const list = winListeners.get(type) ?? [];
      winListeners.set(
        type,
        list.filter((f) => f !== fn)
      );
    },
    dispatch(type: string, ev: any) {
      for (const fn of winListeners.get(type) ?? []) {
        fn(ev);
      }
    },
  };

  return {
    docShim,
    winShim,
    baseFetch,
    computedStyles,
    setPointHits(all: MockElement[], top: MockElement | null) {
      elementsAtPoint = all;
      topElementAtPoint = top;
    },
    setFetchResponder(fn: (input: any, init?: any) => Promise<any>) {
      fetchResponder = fn;
    },
  };
}

let passed = 0;
let failed = 0;

async function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${name}`);
    passed++;
  } catch (err: any) {
    process.stderr.write(`✖ ${name}: ${err?.message || err}\n`);
    failed++;
  }
}

async function main() {
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const prevElement = (globalThis as any).Element;

  const warns: any[][] = [];
  const errors: any[][] = [];
  const origWarn = console.warn;
  const origError = console.error;
  const origTrace = console.trace;

  console.warn = (...args: any[]) => warns.push(args);
  console.error = (...args: any[]) => errors.push(args);
  console.trace = () => {};

  const shim = createDomShim();
  (globalThis as any).Element = MockElement;
  (globalThis as any).document = shim.docShim;
  (globalThis as any).window = shim.winShim;

  try {
    const cleanup = installButtonErrorInterceptor({ correlationWindowMs: 2500 });

    await runCase('1. describeTriggerElement extracts compact selector & disabled metadata', () => {
      const btn = new MockElement('button');
      btn.setAttribute('data-testid', 'chat-send-btn');
      btn.textContent = 'ส่งข้อความ';
      btn.disabled = true;

      const snap = describeTriggerElement(btn as unknown as Element);
      assert.equal(snap.selector, 'button[data-testid="chat-send-btn"]');
      assert.equal(snap.disabled, true);
      assert.equal(snap.text, 'ส่งข้อความ');
    });

    await runCase('2. Warns on disabled control pointerdown & occluded trigger', () => {
      warns.length = 0;
      const disabledBtn = new MockElement('button');
      disabledBtn.setAttribute('data-testid', 'blocked-send');
      disabledBtn.disabled = true;
      disabledBtn.textContent = 'Send';
      shim.docShim.body.appendChild(disabledBtn);

      shim.setPointHits([disabledBtn], disabledBtn);
      shim.docShim.dispatch('pointerdown', {
        clientX: 12,
        clientY: 20,
        composedPath: () => [shim.docShim.body],
      });

      assert.equal(warns.length, 1);
      assert.match(String(warns[0][0]), /Interaction blocked on disabled\/inert control/);
      assert.equal(warns[0][1].selector, 'button[data-testid="blocked-send"]');

      // Occluded active button check
      const activeBtn = new MockElement('button');
      activeBtn.id = 'active-send';
      activeBtn.textContent = 'ส่ง';
      const overlay = new MockElement('div');
      overlay.className = 'fixed z-50';
      shim.computedStyles.set(overlay, { pointerEvents: 'auto', zIndex: '50' });
      shim.docShim.body.appendChild(activeBtn);
      shim.docShim.body.appendChild(overlay);

      shim.setPointHits([overlay, activeBtn], overlay);
      shim.docShim.dispatch('pointerdown', {
        clientX: 40,
        clientY: 50,
        composedPath: () => [overlay],
      });

      assert.equal(warns.length, 2);
      assert.match(String(warns[1][0]), /Trigger occluded by overlapping element/);
      assert.equal(warns[1][1].trigger, 'button#active-send');
      assert.equal(warns[1][1].blockingElement, 'div.fixed.z-50');
    });

    await runCase('3. Warns when React-mounted button lacks click handler', () => {
      warns.length = 0;
      const reactBtn = new MockElement('button');
      reactBtn.id = 'dead-react-btn';
      reactBtn.textContent = 'Dead Button';
      reactBtn['__reactProps$abc123'] = { children: 'Dead Button' };
      shim.docShim.body.appendChild(reactBtn);

      shim.docShim.dispatch('click', {
        target: reactBtn,
        composedPath: () => [reactBtn, shim.docShim.body],
      });

      assert.equal(warns.length, 1);
      assert.match(String(warns[0][0]), /Button clicked without an attached click handler/);
      assert.equal(warns[0][1].selector, 'button#dead-react-btn');
    });

    await runCase('4. Correlates uncaught error, unhandled rejection & HTTP error without consuming body', async () => {
      errors.length = 0;
      const liveBtn = new MockElement('button');
      liveBtn.setAttribute('data-testid', 'dispatch-btn');
      liveBtn['__reactProps$xyz'] = { onClick: () => {} };
      shim.docShim.body.appendChild(liveBtn);

      shim.docShim.dispatch('click', {
        target: liveBtn,
        composedPath: () => [liveBtn, shim.docShim.body],
      });

      shim.winShim.dispatch('error', {
        message: 'Boom in click handler',
        filename: 'App.tsx',
        lineno: 42,
        colno: 9,
        error: new Error('Boom in click handler'),
      });
      shim.winShim.dispatch('unhandledrejection', {
        reason: new Error('Async click failure'),
      });

      shim.setFetchResponder(
        async () =>
          new Response(JSON.stringify({ error: 'FAIL_CLOSED' }), {
            status: 503,
            statusText: 'Service Unavailable',
          })
      );
      const resp = await shim.winShim.fetch('/api/chat/message', { method: 'POST' });
      // Verify response body was NOT consumed by the interceptor
      const payload = await resp.json();
      assert.equal(payload.error, 'FAIL_CLOSED');

      assert.equal(errors.length, 3);
      assert.match(String(errors[0][0]), /Button handler threw an uncaught error/);
      assert.match(String(errors[1][0]), /Async button handler rejected/);
      assert.match(String(errors[2][0]), /HTTP request triggered by button returned error/);
      assert.equal(errors[2][1].status, 503);
      assert.equal(errors[2][1].trigger.selector, 'button[data-testid="dispatch-btn"]');
    });

    await runCase('5. Idempotent install and clean uninstall restores window.fetch', () => {
      const cleanupAgain = installButtonErrorInterceptor();
      assert.equal(cleanupAgain, cleanup);
      assert.notEqual(shim.winShim.fetch, shim.baseFetch);
      cleanup();
      assert.equal(shim.winShim.fetch, shim.baseFetch);
    });

    await runCase('6. Handles getter-only own, prototype, and non-configurable window.fetch safely', async () => {
      // Case A: configurable getter-only own property on window
      const getterWin = Object.create(shim.winShim);
      Object.defineProperty(getterWin, 'fetch', {
        get: () => shim.baseFetch,
        configurable: true,
        enumerable: true,
      });
      (globalThis as any).window = getterWin;

      const cleanupGetter = installButtonErrorInterceptor();
      try {
        shim.setFetchResponder(async () => new Response('fail', { status: 500, statusText: 'Err' }));
        errors.length = 0;
        const btn = new MockElement('button');
        btn.setAttribute('data-testid', 'getter-btn');
        btn['__reactProps$g'] = { onClick: () => {} };
        shim.docShim.dispatch('click', { target: btn, composedPath: () => [btn, shim.docShim.body] });
        const res = await getterWin.fetch('/api/test', { method: 'POST' });
        assert.equal(res.status, 500);
        assert.equal(errors.length, 1);
      } finally {
        cleanupGetter();
      }
      assert.equal(getterWin.fetch, shim.baseFetch);
      assert.equal(typeof Object.getOwnPropertyDescriptor(getterWin, 'fetch')?.get, 'function');

      // Case B: prototype getter-only property (e.g. Window.prototype.fetch)
      const proto = Object.create(shim.winShim);
      Object.defineProperty(proto, 'fetch', {
        get: () => shim.baseFetch,
        configurable: true,
        enumerable: true,
      });
      const inheritedWin = Object.create(proto);
      (globalThis as any).window = inheritedWin;
      const cleanupProto = installButtonErrorInterceptor();
      try {
        assert.notEqual(inheritedWin.fetch, shim.baseFetch);
      } finally {
        cleanupProto();
      }
      assert.equal(inheritedWin.fetch, shim.baseFetch);
      assert.equal(Object.getOwnPropertyDescriptor(inheritedWin, 'fetch'), undefined);

      // Case C: non-configurable getter-only property degrades cleanly without throwing
      const lockedWin = Object.create(shim.winShim);
      Object.defineProperty(lockedWin, 'fetch', {
        get: () => shim.baseFetch,
        configurable: false,
        enumerable: true,
      });
      (globalThis as any).window = lockedWin;
      const cleanupLocked = installButtonErrorInterceptor();
      try {
        assert.equal(lockedWin.fetch, shim.baseFetch);
      } finally {
        cleanupLocked();
      }
    });

    await runCase('7. Distinguishes UI_INTERACTION_ERROR vs BACKEND_API_ERROR and notifies subscribers', async () => {
      const received: ButtonFailureReport[] = [];
      const unsub = onButtonFailure((report) => received.push(report));
      (globalThis as any).window = shim.winShim;
      const cleanupSub = installButtonErrorInterceptor();

      try {
        // Trigger UI_INTERACTION_ERROR (React button without click handler)
        const deadBtn = new MockElement('button');
        deadBtn.id = 'no-handler-btn';
        deadBtn.textContent = 'Trigger';
        deadBtn['__reactProps$sub'] = { children: 'Trigger' };
        shim.docShim.body.appendChild(deadBtn);
        shim.docShim.dispatch('click', {
          target: deadBtn,
          composedPath: () => [deadBtn, shim.docShim.body],
        });

        assert.equal(received.length, 1);
        assert.equal(received[0].category, 'UI_INTERACTION_ERROR');
        assert.equal(received[0].kind, 'missing_handler');
        assert.equal(received[0].critical, true);
        assert.equal(received[0].handlerContext.hasReactProps, true);
        assert.equal(received[0].handlerContext.reactHandlerKeys.length, 0);
        assert.equal(received[0].elementState.disabled, false);

        // Trigger BACKEND_API_ERROR (button fetch returning HTTP 503)
        const apiBtn = new MockElement('button');
        apiBtn.setAttribute('data-testid', 'api-action-btn');
        apiBtn['__reactProps$api'] = { onClick: () => {} };
        shim.docShim.body.appendChild(apiBtn);
        shim.docShim.dispatch('click', {
          target: apiBtn,
          composedPath: () => [apiBtn, shim.docShim.body],
        });
        shim.setFetchResponder(async () => new Response('down', { status: 503, statusText: 'Unavailable' }));
        await shim.winShim.fetch('/api/native/inference', { method: 'POST' });

        assert.equal(received.length, 2);
        assert.equal(received[1].category, 'BACKEND_API_ERROR');
        assert.equal(received[1].kind, 'http_api_error');
        assert.equal(received[1].critical, true);
        assert.equal(received[1].apiContext?.status, 503);
        assert.equal(received[1].apiContext?.url, '/api/native/inference');
        assert.deepEqual(received[1].handlerContext.reactHandlerKeys, ['button[data-testid="api-action-btn"]:onClick']);
      } finally {
        unsub();
        cleanupSub();
      }
    });
  } finally {
    console.warn = origWarn;
    console.error = origError;
    console.trace = origTrace;
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
    (globalThis as any).Element = prevElement;
  }

  console.log(`\nPassed: ${passed}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

void main();

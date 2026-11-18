import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { REGEX_SEARCH_PRESETS, renderHighlightedLog } from '../src/App.tsx';
import {
  SENTIMENT_TREND_STORAGE_KEY,
  isAltVSentimentShortcut,
  readPersistedSentimentTrendVisibility,
  writePersistedSentimentTrendVisibility,
} from '../src/hooks/useSentimentTrendShortcut.ts';

function runTests() {
  console.log('1. Testing REGEX_SEARCH_PRESETS Warnings preset...');
  const warningsPreset = REGEX_SEARCH_PRESETS.find((p) => p.label === 'Warnings');
  assert.ok(warningsPreset, 'REGEX_SEARCH_PRESETS must include a "Warnings" preset');
  assert.equal(warningsPreset.pattern, '\\[WARN\\]\\s*.*');

  const warnRegex = new RegExp(warningsPreset.pattern);
  assert.equal(warnRegex.test('[WARN] Memory threshold above 85%'), true);
  assert.equal(warnRegex.test('[WARN]NoSpaceWarning'), true);
  assert.equal(warnRegex.test('[ERROR] Memory allocation failed'), false);

  console.log('2. Testing renderHighlightedLog dedicated warning highlight styles...');
  const warnHtmlDark = renderToStaticMarkup(
    React.createElement(React.Fragment, null, renderHighlightedLog('[WARN] Disk queue saturated', 'emerald_dark'))
  );
  assert.ok(warnHtmlDark.includes('data-log-highlight="warn-message"'), 'Dark theme must wrap [WARN] messages with warn-message style');
  assert.ok(warnHtmlDark.includes('data-log-highlight="warn-tag"'), 'Dark theme must render dedicated warn-tag badge');
  assert.ok(warnHtmlDark.includes('data-log-highlight="warn-text"'), 'Dark theme must highlight warning message body');
  assert.ok(warnHtmlDark.includes('[WARN]') && warnHtmlDark.includes('Disk queue saturated'));

  const warnHtmlContrast = renderToStaticMarkup(
    React.createElement(React.Fragment, null, renderHighlightedLog('[WARN] Retry backoff engaged', 'high_contrast', /backoff/i))
  );
  assert.ok(warnHtmlContrast.includes('data-log-highlight="warn-message"'));
  assert.ok(warnHtmlContrast.includes('bg-[var(--z-warn)] text-black'), 'High contrast theme should use high-contrast warn badge');
  assert.ok(warnHtmlContrast.includes('<mark'), 'Search highlight <mark> should remain functional inside warning messages');

  const errorHtml = renderToStaticMarkup(
    React.createElement(React.Fragment, null, renderHighlightedLog('[ERROR] Auth rejected', 'emerald_dark'))
  );
  assert.ok(!errorHtml.includes('data-log-highlight="warn-message"'), '[ERROR] must not receive warning-message highlight');

  console.log('3. Testing Alt + V shortcut matcher and persistence helpers...');
  assert.equal(
    isAltVSentimentShortcut({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: 'v' }),
    true
  );
  assert.equal(
    isAltVSentimentShortcut({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: 'V' }),
    true
  );
  assert.equal(
    isAltVSentimentShortcut({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: '√', code: 'KeyV' }),
    true
  );
  assert.equal(
    isAltVSentimentShortcut({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, key: 'v' }),
    false
  );
  assert.equal(
    isAltVSentimentShortcut({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: false, key: 'v' }),
    false
  );
  assert.equal(
    isAltVSentimentShortcut({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: true, key: 'V' }),
    false
  );
  assert.equal(
    isAltVSentimentShortcut({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: 'a' }),
    false
  );

  // Mock window.localStorage to test persistence helper in Node
  const memStorage = new Map<string, string>();
  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => memStorage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memStorage.set(k, v);
      },
    },
  };
  try {
    assert.equal(readPersistedSentimentTrendVisibility(true), true);
    writePersistedSentimentTrendVisibility(false);
    assert.equal(memStorage.get(SENTIMENT_TREND_STORAGE_KEY), 'false');
    assert.equal(readPersistedSentimentTrendVisibility(true), false);
    writePersistedSentimentTrendVisibility(true);
    assert.equal(readPersistedSentimentTrendVisibility(false), true);
  } finally {
    (globalThis as any).window = prevWindow;
  }

  console.log('4. Verifying App.tsx and CommandCenter.tsx Alt+V hook wiring...');
  const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const ccSrc = fs.readFileSync(path.resolve('src/components/modules/CommandCenter.tsx'), 'utf8');
  assert.ok(appSrc.includes('useSentimentTrendShortcut'), 'App.tsx must use useSentimentTrendShortcut hook');
  assert.ok(appSrc.includes('Alt + V'), 'App.tsx shortcuts modal must document Alt + V');
  assert.ok(ccSrc.includes('useSentimentTrendShortcut'), 'CommandCenter.tsx must support useSentimentTrendShortcut');
  assert.ok(ccSrc.includes('command-center-sentiment-trend-chart'), 'CommandCenter.tsx must render toggleable sentiment trend chart');
  assert.ok(ccSrc.includes('command-center-toggle-sentiment-trend'), 'CommandCenter.tsx must include toggle button with Alt+V hint');

  console.log('ALL WARNINGS PRESET & ALT+V SENTIMENT TREND HOOK TESTS PASSED.');
}

runTests();

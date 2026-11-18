import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { REGEX_SEARCH_PRESETS, renderHighlightedLog } from '../src/App';
import { isAltVShortcutEvent } from '../src/hooks/useSentimentTrendShortcut';
import { CommandCenter } from '../src/components/modules/CommandCenter';
import { LanguageProvider } from '../src/context/LanguageContext';

function run() {
  console.log('1. Testing REGEX_SEARCH_PRESETS Warnings preset...');
  const warningsPreset = REGEX_SEARCH_PRESETS.find((p) => p.label === 'Warnings');
  assert.ok(warningsPreset, 'REGEX_SEARCH_PRESETS must include a "Warnings" preset');
  assert.equal(warningsPreset.pattern, '\\[WARN\\]\\s*.*');

  const warnRe = new RegExp(warningsPreset.pattern, 'i');
  assert.equal(warnRe.test('[WARN] Cache TTL near expiration'), true);
  assert.equal(warnRe.test('[WARN]'), true);
  assert.equal(warnRe.test('[DONE] Build completed'), false);
  assert.equal(warnRe.test('[ERROR] Auth failed'), false);

  console.log('2. Testing renderHighlightedLog dedicated warning message styling...');
  const warnEmeraldHtml = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      renderHighlightedLog('[WARN] Latency exceeded 250ms budget', 'emerald_dark', /250ms/gi)
    )
  );
  assert.ok(warnEmeraldHtml.includes('data-log-highlight="warn-message"'), 'Must render dedicated warn-message highlight wrapper');
  assert.ok(warnEmeraldHtml.includes('data-log-highlight="warn-tag"'), 'Must render dedicated warn-tag badge');
  assert.ok(warnEmeraldHtml.includes('data-log-highlight="warn-text"'), 'Must render dedicated warn-text body');
  assert.ok(warnEmeraldHtml.includes('--z-warn'), 'Must use --z-warn warning visual tokens');
  assert.ok(warnEmeraldHtml.includes('<mark') && warnEmeraldHtml.includes('250ms'), 'Must preserve nested search <mark> highlights inside warning body');

  const warnHighContrastHtml = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      renderHighlightedLog('[WARN] High contrast check', 'high_contrast')
    )
  );
  assert.ok(warnHighContrastHtml.includes('data-log-highlight="warn-message"'));
  assert.ok(warnHighContrastHtml.includes('border-[var(--z-warn)]'));

  const errorHtml = renderToStaticMarkup(
    React.createElement(React.Fragment, null, renderHighlightedLog('[ERROR] Connection refused', 'emerald_dark'))
  );
  assert.equal(errorHtml.includes('data-log-highlight="warn-message"'), false);
  assert.ok(errorHtml.includes('--z-danger'));

  console.log('3. Testing Alt + V keyboard shortcut predicate...');
  assert.equal(isAltVShortcutEvent({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: 'v', code: 'KeyV' }), true);
  assert.equal(isAltVShortcutEvent({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: 'V', code: 'KeyV' }), true);
  assert.equal(isAltVShortcutEvent({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: '√', code: 'KeyV' }), true);
  assert.equal(isAltVShortcutEvent({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, key: 'v', code: 'KeyV' }), false);
  assert.equal(isAltVShortcutEvent({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: false, key: 'v', code: 'KeyV' }), false);
  assert.equal(isAltVShortcutEvent({ altKey: true, ctrlKey: false, metaKey: true, shiftKey: false, key: 'v', code: 'KeyV' }), false);
  assert.equal(isAltVShortcutEvent({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: true, key: 'v', code: 'KeyV' }), false);
  assert.equal(isAltVShortcutEvent({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key: 'a', code: 'KeyA' }), false);

  console.log('4. Testing CommandCenter Sentiment Trend chart visibility toggling...');
  const sampleLogs = [
    '[INIT] Start task',
    '[WARN] Latency spike',
    '[DONE] Completed verification (exitCode: 0)',
  ];
  const visibleHtml = renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(CommandCenter, {
        statusData: null,
        onNavigate: () => {},
        onOpenQuickTask: () => {},
        workflowLogs: sampleLogs,
        showSentimentTrend: true,
        onToggleSentimentTrend: () => {},
      })
    )
  );
  assert.ok(visibleHtml.includes('data-testid="command-center-sentiment-trend"'));
  assert.ok(visibleHtml.includes('data-testid="command-center-sentiment-trend-chart"'));
  assert.ok(visibleHtml.includes('aria-pressed="true"'));
  assert.ok(visibleHtml.includes('Alt+V'));

  const hiddenHtml = renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(CommandCenter, {
        statusData: null,
        onNavigate: () => {},
        onOpenQuickTask: () => {},
        workflowLogs: sampleLogs,
        showSentimentTrend: false,
        onToggleSentimentTrend: () => {},
      })
    )
  );
  assert.ok(hiddenHtml.includes('data-testid="command-center-sentiment-trend"'));
  assert.equal(hiddenHtml.includes('data-testid="command-center-sentiment-trend-chart"'), false);
  assert.ok(hiddenHtml.includes('aria-pressed="false"'));

  console.log('5. Verifying App.tsx & hook integration...');
  const hookSrc = fs.readFileSync(path.resolve('src/hooks/useSentimentTrendShortcut.ts'), 'utf8');
  assert.ok(hookSrc.includes("window.addEventListener('keydown'"));
  assert.ok(hookSrc.includes("window.removeEventListener('keydown'"));

  const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes('useSentimentTrendShortcut'));
  assert.ok(appSrc.includes('quickLogs.length > 0 && showSentimentTrend'));
  assert.ok(appSrc.includes('data-testid="toggle-sentiment-trend"'));
  assert.ok(appSrc.includes('Alt + V'));

  console.log('\nALL WARNING LOG PRESET & ALT+V SENTIMENT SHORTCUT TESTS PASSED.');
}

run();

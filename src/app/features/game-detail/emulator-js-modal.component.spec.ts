import { describe, expect, it } from 'vitest';

import { shouldHandleEmulatorJsExitMessage } from './emulator-js-modal.component';

/** Must match `assets/emulatorjs/play.html`. */
const EMULATOR_EXIT_DATA = {
  source: 'game-shelf-emulatorjs',
  type: 'emulator-exit',
} as const;

function makeMessage(init: {
  origin?: string;
  source: MessageEventSource | null;
  data?: unknown;
}): MessageEvent<unknown> {
  return new MessageEvent('message', {
    origin: init.origin ?? window.location.origin,
    source: init.source,
    data: init.data ?? EMULATOR_EXIT_DATA,
  });
}

describe('shouldHandleEmulatorJsExitMessage', () => {
  it('returns true for a valid exit message when iframe contentWindow is not resolved (regression)', () => {
    expect(
      shouldHandleEmulatorJsExitMessage(makeMessage({ source: window }), {
        isOpen: true,
        iframeContentWindow: null,
      })
    ).toBe(true);
  });

  it('returns true when message source matches iframe contentWindow', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const inner = iframe.contentWindow;
    if (!inner) {
      throw new Error('Expected iframe.contentWindow');
    }
    try {
      expect(
        shouldHandleEmulatorJsExitMessage(makeMessage({ source: inner }), {
          isOpen: true,
          iframeContentWindow: inner,
        })
      ).toBe(true);
    } finally {
      iframe.remove();
    }
  });

  it('returns false when iframe is known but message source is not the iframe window', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const inner = iframe.contentWindow;
    if (!inner) {
      throw new Error('Expected iframe.contentWindow');
    }
    try {
      expect(
        shouldHandleEmulatorJsExitMessage(makeMessage({ source: window }), {
          isOpen: true,
          iframeContentWindow: inner,
        })
      ).toBe(false);
    } finally {
      iframe.remove();
    }
  });

  it('returns false when the modal is not open', () => {
    expect(
      shouldHandleEmulatorJsExitMessage(makeMessage({ source: window }), {
        isOpen: false,
        iframeContentWindow: null,
      })
    ).toBe(false);
  });

  it('returns false when event origin does not match the page', () => {
    expect(
      shouldHandleEmulatorJsExitMessage(
        makeMessage({
          origin: 'https://evil.example',
          source: window,
        }),
        {
          isOpen: true,
          iframeContentWindow: null,
        }
      )
    ).toBe(false);
  });

  it('returns false for payloads that are not the emulator exit contract', () => {
    expect(
      shouldHandleEmulatorJsExitMessage(
        makeMessage({
          source: window,
          data: { source: 'other', type: 'emulator-exit' },
        }),
        {
          isOpen: true,
          iframeContentWindow: null,
        }
      )
    ).toBe(false);
  });
});

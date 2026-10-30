import { act } from 'react';
import { setTimeout as pause } from 'node:timers/promises';

export async function press(ui, input) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    // Flush pending effects so the current screen owns the next keypress.
    await act(async () => {});
    await act(async () => {
      ui.stdin.write(input);
      // Allow Ink to resolve a standalone Escape before flushing its updates.
      await pause(100);
    });
  } finally {
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

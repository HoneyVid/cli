import { setTimeout as delay } from 'node:timers/promises';
import { vi } from 'vitest';

/** Keep polling sleeps, deadline checks and HTTP aborts on one virtual clock. */
export function mockPollingClock() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  // Native AbortSignal.timeout uses internal timers that Vitest cannot advance.
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return controller.signal;
  });
  vi.mocked(delay).mockImplementation(async (ms, value) => {
    await vi.advanceTimersByTimeAsync(ms ?? 0);
    return value;
  });
  const json = Response.prototype.json;
  const body = vi.spyOn(Response.prototype, 'json').mockImplementation(function (this: Response) {
    const reading = json.call(this);
    // The server sends partial JSON with this marker. Start the real body read
    // before advancing to its abort deadline; never race real network latency.
    if (this.headers.has('x-test-stalled-body')) vi.advanceTimersToNextTimer();
    return reading;
  });
  return () => {
    body.mockRestore();
    timeout.mockRestore();
    vi.useRealTimers();
  };
}

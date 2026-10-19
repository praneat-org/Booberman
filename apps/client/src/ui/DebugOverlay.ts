import type { Transport, Unsubscribe } from '../net/Transport';
import { type DebugStats, formatDebug, PingTracker } from '../view/debugStats';

const PING_INTERVAL_MS = 1000;
const REFRESH_MS = 250;

/**
 * `?debug=1`: a small DOM readout (ping, snapshots in the buffer, latest tick) and the 1 s
 * `ping { ts }` loop that feeds it. Returns the unsubscribe that removes everything it added.
 */
export function attachDebugOverlay(
  transport: Transport,
  stats: () => Omit<DebugStats, 'pingMs'>,
): Unsubscribe {
  const tracker = new PingTracker();
  const el = document.createElement('pre');
  el.dataset.testid = 'debug-overlay';
  el.style.cssText =
    'position:fixed;left:4px;top:4px;margin:0;padding:2px 4px;z-index:10;pointer-events:none;' +
    'font:10px/1.2 monospace;color:#9f9;background:rgba(0,0,0,.6);';
  document.body.appendChild(el);

  const offPong = transport.onPong((msg) => tracker.record(msg.ts, performance.now()));
  const ping = setInterval(() => transport.ping(performance.now()), PING_INTERVAL_MS);
  const refresh = () => {
    el.textContent = formatDebug({ ...stats(), pingMs: tracker.pingMs });
  };
  const redraw = setInterval(refresh, REFRESH_MS);
  refresh();

  return () => {
    offPong();
    clearInterval(ping);
    clearInterval(redraw);
    el.remove();
  };
}

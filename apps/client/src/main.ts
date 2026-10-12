import { PROTOCOL_VERSION } from '@booberman/protocol';
import { checkHealth } from './net/health';
import { appTitle } from './title';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  root.textContent = appTitle(PROTOCOL_VERSION);
  const status = document.createElement('p');
  status.id = 'health';
  status.textContent = 'worker: …';
  root.append(status);

  void checkHealth().then((result) => {
    status.textContent =
      result.status === 'ok'
        ? `worker: ok (protocol v${result.health.protocol})`
        : `worker: ${result.reason}`;
  });
}

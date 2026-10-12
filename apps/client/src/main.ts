import { PROTOCOL_VERSION } from '@booberman/protocol';
import { appTitle } from './title';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  root.textContent = appTitle(PROTOCOL_VERSION);
}

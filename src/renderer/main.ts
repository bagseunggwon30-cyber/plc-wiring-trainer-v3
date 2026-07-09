import { buildMetadata } from './build-metadata';

const metadata = buildMetadata(__APP_VERSION__);
window.APP_VERSION = metadata.version;
document.title = `${metadata.title} · 제어반 레일/배전`;
document.querySelectorAll<HTMLElement>('[data-app-version]').forEach((element) => {
  element.textContent = metadata.displayVersion;
});

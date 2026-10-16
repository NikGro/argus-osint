import { t } from './i18n.js';

export function systemLogs(container, { api, el, iconActionButton, toast }) {
  container.replaceChildren();
  container.append(el('h2', {}, t('Systemlogs')));
  const search = el('input', {
    type: 'search',
    placeholder: t('Systemlogs durchsuchen'),
    'aria-label': t('Systemlogs durchsuchen')
  });
  const limit = el('input', {
    type: 'number',
    min: 0,
    step: 1,
    value: 0,
    'aria-label': t('Exportzeilen (0 = alle)')
  });
  const output = el('pre', { class: 'system-log-lines', tabindex: 0 });
  const status = el('p', { role: 'status' });
  const more = iconActionButton(t('Weitere laden'), () => load(true), 'plus');
  let offset = 0,
    generation = 0,
    timer;
  async function load(append = false) {
    const revision = ++generation;
    try {
      const data = await api(
        '/api/system-logs?q=' +
          encodeURIComponent(search.value) +
          '&offset=' +
          (append ? offset : 0)
      );
      if (revision !== generation || !container.isConnected) return;
      if (!append) output.textContent = '';
      output.textContent +=
        (data.lines || []).map((row) => row.text).join('\n') +
        ((data.lines || []).length ? '\n' : '');
      offset = (append ? offset : 0) + (data.lines || []).length;
      status.textContent = t('Logzeilen: {count}', { count: data.total || 0 });
      more.hidden = offset >= (data.total || 0);
    } catch (error) {
      toast(error.message);
    }
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(), 200);
  });
  const exportButton = iconActionButton(
    t('Exportieren'),
    () => {
      if (!limit.checkValidity()) {
        limit.reportValidity();
        return;
      }
      const link = el('a', {
        href:
          '/api/system-logs/export?q=' +
          encodeURIComponent(search.value) +
          '&limit=' +
          (Number(limit.value) || 0),
        download: 'argus-system-logs.txt'
      });
      link.click();
    },
    'download'
  );
  const clear = iconActionButton(
    t('Systemlogs leeren'),
    async () => {
      try {
        await api('/api/system-logs/clear', {});
        await load();
      } catch (error) {
        toast(error.message);
      }
    },
    'trash',
    'danger-filled'
  );
  const controls = el('div', { class: 'system-log-controls' });
  const exportLabel = el('label', {}, t('Exportzeilen (0 = alle)'));
  exportLabel.append(limit);
  controls.append(
    search,
    iconActionButton(t('Aktualisieren'), () => load(), 'refresh'),
    exportLabel,
    exportButton,
    clear
  );
  container.append(controls, status, output, more);
  load();
}

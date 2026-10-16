import { t } from './i18n.js';

export function systemLogs(container, { api, el, iconActionButton, toast }) {
  clearTimeout(container.logTimer);
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
    timer,
    loading = false;
  const automatic = el('input', { type: 'checkbox' });
  const follow = el('input', { type: 'checkbox' });
  automatic.checked = localStorage.getItem('argus.logs.autoRefresh') === 'true';
  follow.checked = localStorage.getItem('argus.logs.autoScroll') !== 'false';
  const options = el('div', { class: 'system-log-options' });
  for (const [input, text, key] of [
    [automatic, 'Automatisch aktualisieren', 'autoRefresh'],
    [follow, 'Automatisch nach unten scrollen', 'autoScroll']
  ]) {
    const label = el('label', { class: 'checkbox-label' });
    label.append(input, document.createTextNode(t(text)));
    input.addEventListener('change', () => {
      localStorage.setItem('argus.logs.' + key, String(input.checked));
      if (input === follow && follow.checked) output.scrollTop = output.scrollHeight;
    });
    options.append(label);
  }
  async function load(append = false) {
    if (loading) return;
    loading = true;
    const revision = ++generation;
    try {
      const data = await api(
        '/api/system-logs?q=' +
          encodeURIComponent(search.value) +
          '&offset=' +
          (append ? offset : 0)
      );
      if (revision !== generation || !container.isConnected) return;
      const lines = [...(data.lines || [])]
        .reverse()
        .map((row) => row.text)
        .join('\n');
      const oldTop = output.scrollTop,
        oldHeight = output.scrollHeight;
      if (append) output.textContent = lines + '\n' + output.textContent;
      else output.textContent = lines;
      if (append) output.scrollTop = oldTop + output.scrollHeight - oldHeight;
      else if (follow.checked) output.scrollTop = output.scrollHeight;
      else output.scrollTop = oldTop;
      offset = (append ? offset : 0) + (data.lines || []).length;
      status.textContent = t('Logzeilen: {count}', { count: data.total || 0 });
      more.hidden = offset >= (data.total || 0);
    } catch (error) {
      toast(error.message);
    } finally {
      loading = false;
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
  container.append(controls, options, status, output, more);
  load();
  const refresh = async () => {
    if (!container.isConnected) return;
    if (automatic.checked && !document.hidden && !container.closest('main')?.hidden) await load();
    container.logTimer = setTimeout(refresh, 5000);
  };
  container.logTimer = setTimeout(refresh, 5000);
}

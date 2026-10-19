import { t } from '../i18n.js';
var logs_default = {
  name: 'logs',
  dependencies: ['$', 'api', 'el', 'save', 'show'],
  create({ workspaceState, logsState, $, api, el, save, show }) {
    let generation = 0;
    async function renderLogs(append = false) {
      if (!workspaceState.project) return;
      const current = ++generation;
      const response = await api(
        '/api/projects/' +
          workspaceState.project.id +
          '/logs?q=' +
          encodeURIComponent($('logsSearch').value) +
          '&offset=' +
          (append ? logsState.logRecords.length : 0)
      );
      if (current !== generation) return;
      logsState.logRecords = append ? [...logsState.logRecords, ...response.rows] : response.rows;
      $('logsCount').textContent = logsState.logRecords.length + ' ' + t('ui.rows');
      $('logsBody').replaceChildren(
        ...logsState.logRecords.map((row) => el('div', { class: 'log-line' }, row.text))
      );
      if (!logsState.logRecords.length)
        $('logsBody').append(el('p', { class: 'empty-state' }, t('ui.no_matching_log_entries')));
      $('logsMore').hidden = !response.more;
    }
    async function openLogs() {
      await save();
      logsState.logRecords = [];
      show('logsView');
      await renderLogs();
    }
    function exportLogs() {
      const limit = Number($('logsLimit').value);
      if (!Number.isInteger(limit) || limit < 0) throw Error(t('ui.invalid_row_count'));
      const link = el('a', {
        href:
          '/api/projects/' +
          workspaceState.project.id +
          '/logs-export?limit=' +
          limit +
          '&q=' +
          encodeURIComponent($('logsSearch').value),
        download: 'argus-logs.txt'
      });
      document.body.append(link);
      link.click();
      link.remove();
    }
    async function clearLogs() {
      await save();
      const result = await api('/api/projects/' + workspaceState.project.id + '/logs-clear', {
        revision: workspaceState.project.revision
      });
      workspaceState.project = result;
      workspaceState.lastServerSnapshot = structuredClone(result.document);
      await renderLogs();
    }
    return { renderLogs, openLogs, exportLogs, clearLogs };
  }
};
export { logs_default };
export default logs_default;

import React, { memo, useRef, useState, useEffect, useMemo } from 'react';
import phoneCountries from '../phone-countries.js';
import locationCountries from '../location-countries.js';
import { language } from '../i18n.js';
import { t, diagnostic } from '../i18n.js';
import { providerFields, displayOptions } from '../app/labels.js';
import { hasMediaEditor, cropKeys, MediaEditor } from '../app/media-editor.js';
import {
  Button,
  Check,
  Field,
  Fields,
  Facts,
  Icon,
  ColorField,
  DetailSection,
  MediaFrame,
  MapPreview,
  SearchProfiles,
  Select
} from './ui/index.jsx';
import { Canvas } from './canvas.jsx';
import { workspacePreferences, saveWorkspacePreferences } from './workspace-preferences.js';

export function Workspace({ app }) {
  const { state: s, commands: c } = app;
  const upload = useRef(null);
  const layout = useRef(null);
  const [sizes, setSizes] = useState(workspacePreferences);
  const hasDetails =
    s.selectionState.selected.size > 0 ||
    s.selectionState.selectedEdges.size > 0 ||
    Boolean(app.ui.activeGroup);
  const rightHidden = s.canvasState.rightCollapsed || !hasDetails;
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const height = document.querySelector('.toolbar')?.getBoundingClientRect().height;
      if (height) document.documentElement.style.setProperty('--toolbar-height', height + 'px');
    });
    observer.observe(layout.current);
    return () => observer.disconnect();
  }, []);
  function togglePanel(key) {
    if (key === 'rightCollapsed' && !hasDetails) return;
    s.canvasState[key] = !s.canvasState[key];
    app.redraw();
  }
  function resize(event, target, direction) {
    const element = document.getElementById(target),
      start = event.clientX,
      width = element.getBoundingClientRect().width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (next) =>
      (element.style.width =
        Math.max(220, Math.min(600, width + (next.clientX - start) * direction)) + 'px');
    const finish = () => {
      const key = target === 'palette' ? 'leftWidth' : 'rightWidth';
      const value = element.getBoundingClientRect().width;
      setSizes((previous) => ({ ...previous, [key]: value }));
      saveWorkspacePreferences({ [key]: value });
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }
  return (
    <main id="workspace" hidden={app.ui.view !== 'workspace'}>
      <div ref={layout}>
        <Toolbar app={app} />
      </div>
      <div className="workspace-body">
        <aside id="palette" style={{ width: sizes.leftWidth }} hidden={s.canvasState.leftCollapsed}>
          <Palette app={app} />
        </aside>
        <div
          id="leftResize"
          className="panel-resize left"
          hidden={s.canvasState.leftCollapsed}
          onPointerDown={(event) => resize(event, 'palette', 1)}
        />
        <section className="canvas" id="canvasWrap">
          <Canvas app={app} />
          <div id="mapOverlays" />
          <Button
            id="toggleLeft"
            className={'panel-toggle left' + (!s.canvasState.leftCollapsed ? ' joined' : '')}
            icon={s.canvasState.leftCollapsed ? 'chevron-right' : 'chevron-left'}
            only
            onClick={() => {
              togglePanel('leftCollapsed');
            }}
          >
            {t('ui.tool_menu')}
          </Button>
          <Button
            id="toggleRight"
            className={'panel-toggle right' + (!rightHidden ? ' joined' : '')}
            disabled={!hasDetails}
            icon={s.canvasState.rightCollapsed ? 'chevron-left' : 'chevron-right'}
            only
            onClick={() => {
              togglePanel('rightCollapsed');
            }}
          >
            {t('ui.node_details')}
          </Button>
        </section>
        <div
          id="rightResize"
          className="panel-resize right"
          hidden={rightHidden}
          onPointerDown={(event) => resize(event, 'inspector', -1)}
        />
        <aside id="inspector" style={{ width: sizes.rightWidth }} hidden={rightHidden}>
          <StableInspector app={app} />
        </aside>
      </div>
      <input
        ref={upload}
        id="fileInput"
        type="file"
        hidden
        multiple
        onChange={(event) =>
          app.safely(async () => {
            for (const file of event.target.files)
              await c.uploadNodeFile(
                file,
                s.uploadsState.pendingUploadType,
                s.uploadsState.pendingImagePosition?.x,
                s.uploadsState.pendingImagePosition?.y
              );
            upload.current.value = '';
            s.uploadsState.pendingImagePosition = null;
          })
        }
      />
      <p id="graphKeyboardHint" className="sr-only">
        {t('ui.space_to_pan_ctrl_wheel_to_zoom')}
      </p>
    </main>
  );
}

function Dropdown({ label, icon, danger, children }) {
  return (
    <details className="toolbar-dropdown">
      <summary className={danger ? 'danger-filled' : ''}>
        <Icon name={icon} />
        <span>{label}</span>
        <Icon name="chevron-down" />
      </summary>
      <div
        className="toolbar-dropdown-menu"
        onClick={(event) => {
          if (event.target.closest('button')) event.currentTarget.parentElement.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
function Toolbar({ app }) {
  const { commands: c, state: s } = app;
  const btn = (id, label, icon, onClick, disabled = false, only = false, cls = '') => (
    <Button
      key={id}
      id={id}
      app={app}
      icon={icon}
      only={only}
      className={cls}
      onClick={onClick}
      disabled={disabled}
    >
      {t(label)}
    </Button>
  );
  const none =
    !s.selectionState.selected.size &&
    !s.selectionState.selectedGroups.size &&
    !s.selectionState.selectedGroup &&
    !s.selectionState.selectedEdges.size;
  const doc = s.workspaceState.project?.document;
  const groupIds = new Set(
    [...s.selectionState.selectedGroups, s.selectionState.selectedGroup].filter(Boolean)
  );
  const selectedGroups = doc?.groups.filter((group) => groupIds.has(group.id)) || [];
  const canGroup = Boolean(s.selectionState.selected.size || selectedGroups.length);
  const canDetach = selectedGroups.length
    ? selectedGroups.some((group) => group.parent_id)
    : doc?.groups.some((group) => group.members.some((id) => s.selectionState.selected.has(id)));
  const detach = () => {
    if (!selectedGroups.length) return c.detachNodes([...s.selectionState.selected]);
    for (const group of selectedGroups) delete group.parent_id;
    doc.groups = c.pruneGroups(doc.groups, new Set(doc.nodes.map((node) => node.id)));
    c.change();
    c.render();
    c.inspectGroup(selectedGroups[0]);
  };
  const running = s.executionState.activeActors.size;
  const queued = s.executionState.actorQueue.length;
  return (
    <div className={'toolbar'} role="toolbar" aria-label={t('ui.project_tools')}>
      <div className="tool-group">{btn('back', 'Hauptmenü', 'home', c.home, false, true)}</div>
      <div className="tool-group">
        {btn(
          'undo',
          'Rückgängig',
          'undo',
          () => c.applyHistory('undo'),
          !s.historyState.undoStack.length,
          true
        )}
        {btn(
          'redo',
          'Wiederholen',
          'redo',
          () => c.applyHistory('redo'),
          !s.historyState.redoStack.length,
          true
        )}
      </div>
      <div className="tool-group">
        <Dropdown label={t('ui.group_b4c02265')} icon="group">
          {btn('groupNodes', 'Gruppieren', 'group', c.createGroupFromSelection, !canGroup)}
          {btn(
            'ungroupNodes',
            'Gruppe aufheben',
            'ungroup',
            c.dissolveSelectedGroups,
            !selectedGroups.length
          )}
          {btn('detachNodes', 'Aus Gruppe lösen', 'ungroup', detach, !canDetach)}
          {btn('expandAllGroups', 'Alle Gruppen aufklappen', 'chevron-down', () =>
            c.setAllGroups(false)
          )}
          {btn('collapseAllGroups', 'Alle Gruppen einklappen', 'chevron-right', () =>
            c.setAllGroups(true)
          )}
        </Dropdown>
        <Dropdown label={t('ui.arrange_b6a83ebd')} icon="cleanup">
          {['hierarchy', 'grid', 'radial'].map((mode) =>
            btn(
              'cleanup-' + mode,
              {
                hierarchy: 'Hierarchisch',
                grid: 'Raster je Arbeitsschritt',
                radial: 'Kreis je Arbeitsschritt'
              }[mode],
              'arrange',
              () => c.arrangeProject(mode)
            )
          )}
        </Dropdown>
      </div>
      <div className="tool-group">
        <Dropdown label={t('ui.delete')} icon="trash" danger>
          {btn(
            'deleteSelected',
            'Objekt löschen',
            'trash',
            c.deleteSelection,
            none,
            false,
            'danger-filled'
          )}
          {btn(
            'deleteDescendants',
            'Objekt und Nachkommen löschen',
            'trash',
            c.deleteSelectionWithChildren,
            none,
            false,
            'danger-filled'
          )}
        </Dropdown>
      </div>
      <div className="tool-group">
        {btn('zoomOut', 'Verkleinern', 'search-minus', () => c.zoomStep(-1), false, true)}
        <input
          id="zoomLevel"
          aria-label={t('ui.zoom_percentage')}
          defaultValue="100%"
          onBlur={(event) => {
            const percent = Number(event.target.value.replace('%', ''));
            if (!Number.isFinite(percent) || percent < 15 || percent > 250)
              return c.toast(t('ui.zoom_must_be_between_15_and_250_percent'));
            const box = document.getElementById('graph').getBoundingClientRect();
            c.zoomAt(box.width / 2, box.height / 2, percent / 100);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {btn('zoomIn', 'Vergrößern', 'search-plus', () => c.zoomStep(1), false, true)}
        {btn('fit', 'Zentrieren', 'center', c.centerProject)}
      </div>
      <div className="tool-group">
        {btn('logs', 'Logs', 'logs', c.openLogs)}
        {btn('report', 'Report ↗', 'file', async () => {
          await c.save();
          c.show('reportView');
        })}
      </div>
      <div className="tool-group execution-group">
        <div className={'execution-status' + (!running && !queued ? ' idle' : '')} role="status">
          <Icon name={running ? 'spinner' : 'clock'} />
          {running} {t('ui.running_870fa7cc')} · {queued} {t('ui.queued')}
          {s.executionState.vpnWaiting && <span>{t('ui.waiting_for_vpn')}</span>}
        </div>
        {btn(
          'cancelActor',
          'Tool abbrechen',
          'close',
          c.cancelCurrentActor,
          !running,
          true,
          'danger-filled'
        )}
      </div>
    </div>
  );
}

function Palette({ app }) {
  const { commands: c, state: s } = app;
  const [height, setHeight] = useState(() => workspacePreferences().paletteHeight),
    [panels, setPanels] = useState({}),
    [queries, setQueries] = useState({ node: '', actor: '' }),
    [sorts, setSorts] = useState({ node: 'az', actor: 'category_az' }),
    [filters, setFilters] = useState({ node: [], actor: [] });
  const inputs = c.selectedData();
  const inputKey = inputs
    .map((node) => node.id)
    .sort()
    .join(',');
  useEffect(() => {
    document.getElementById('actorPalette')?.scrollTo(0, 0);
  }, [inputKey]);
  useEffect(() => {
    saveWorkspacePreferences({ paletteHeight: height });
  }, [height]);
  const nodes = [...s.pluginsState.dataTypes.values()]
    .filter((entry) => entry.installed)
    .map(({ node }) => ({
      id: node.type,
      label: c.dataLabel(node.type),
      category: c.dataCategory(node.type),
      node
    }));
  const tools = s.pluginsState.catalog.flatMap((plugin) =>
    (plugin.actions || []).map((action) => ({
      id: plugin.id + ':' + action.id,
      label: c.pluginText(plugin, action.name),
      category: c.actionCategory(plugin, action),
      plugin,
      action
    }))
  );
  function section(kind, entries, title) {
    const filtered = entries.filter(
      (entry) =>
        (entry.label + ' ' + entry.category).toLowerCase().includes(queries[kind].toLowerCase()) &&
        (!filters[kind].length || filters[kind].includes(entry.category))
    );
    filtered.sort(
      (a, b) =>
        (sorts[kind].startsWith('category') ? a.category.localeCompare(b.category) : 0) ||
        a.label.localeCompare(b.label)
    );
    if (sorts[kind].endsWith('za')) filtered.reverse();
    if (kind === 'actor' && inputs.length)
      filtered.sort(
        (a, b) =>
          Number(c.actorIncompatible(a.action, inputs, true)) -
          Number(c.actorIncompatible(b.action, inputs, true))
      );
    let last = null;
    return (
      <>
        <div className="palette-heading">
          <h2>{t(title)}</h2>
          <div className="palette-tools">
            {[
              ['search', 'Suchen'],
              ['filter', 'Filtern'],
              ['sort', 'Sortieren']
            ].map(([icon, label]) => (
              <Button
                key={icon}
                id={kind + icon[0].toUpperCase() + icon.slice(1) + 'Toggle'}
                only
                icon={icon}
                className={'borderless' + (panels[kind + icon] ? ' active' : '')}
                aria-expanded={!!panels[kind + icon]}
                onClick={() => setPanels({ ...panels, [kind + icon]: !panels[kind + icon] })}
              >
                {t(label)}
              </Button>
            ))}
          </div>
        </div>
        {panels[kind + 'search'] && (
          <input
            type="search"
            value={queries[kind]}
            placeholder={t('ui.search_51942c20')}
            onChange={(event) => setQueries({ ...queries, [kind]: event.target.value })}
          />
        )}
        {panels[kind + 'sort'] && (
          <Select
            label={t('ui.sort')}
            id={kind + 'Sort'}
            value={sorts[kind]}
            options={[
              { value: 'az', label: 'A–Z' },
              { value: 'za', label: 'Z–A' },
              { value: 'category_az', label: t('ui.by_category') }
            ]}
            onChange={(value) => setSorts({ ...sorts, [kind]: value })}
          />
        )}
        {panels[kind + 'filter'] && (
          <div className="palette-filters">
            {[...new Set(entries.map((item) => item.category))].sort().map((category) => (
              <Check
                key={category}
                checked={filters[kind].includes(category)}
                onChange={(value) =>
                  setFilters({
                    ...filters,
                    [kind]: value
                      ? [...filters[kind], category]
                      : filters[kind].filter((item) => item !== category)
                  })
                }
              >
                {t(category)}
              </Check>
            ))}
          </div>
        )}
        <div className="palette-list" id={kind === 'actor' ? 'actorPalette' : 'dataPalette'}>
          {filtered.map((entry) => {
            const heading = sorts[kind].startsWith('category') && last !== entry.category;
            last = entry.category;
            return (
              <React.Fragment key={entry.id}>
                {heading && <div className="palette-category-divider">{t(entry.category)}</div>}
                <Button
                  app={app}
                  className={
                    'palette-item ' +
                    (kind === 'actor'
                      ? 'actor-item' +
                        (inputs.length && !c.actorIncompatible(entry.action, inputs, true)
                          ? ' compatible'
                          : '')
                      : '')
                  }
                  icon={
                    kind === 'actor'
                      ? c.actorIcon(entry.plugin.id, entry.action.id)
                      : c.dataIcon(entry.node.type)
                  }
                  disabled={kind === 'actor' && c.actorIncompatible(entry.action, inputs, true)}
                  draggable
                  data-plugin={entry.plugin?.id}
                  data-action={entry.action?.id}
                  data-type={entry.node?.type}
                  onDragStart={(event) =>
                    event.dataTransfer.setData(
                      'application/x-argus-palette',
                      JSON.stringify(
                        kind === 'actor'
                          ? { kind: 'actor', plugin: entry.plugin.id, action: entry.action.id }
                          : { kind: 'node', type: entry.node.type }
                      )
                    )
                  }
                  onClick={() =>
                    kind === 'actor'
                      ? c.addActor(entry.plugin, entry.action)
                      : c.addData(entry.node.type)
                  }
                >
                  {entry.label}
                </Button>
              </React.Fragment>
            );
          })}
        </div>
      </>
    );
  }
  return (
    <>
      <section id="dataWindow" style={{ height, flex: '0 0 ' + height + 'px' }}>
        {section('node', nodes, 'Daten')}
      </section>
      <div
        id="paletteSplit"
        role="separator"
        tabIndex={0}
        aria-label={t('ui.resize_sections')}
        onPointerDown={(event) => {
          const handle = event.currentTarget,
            y = event.clientY,
            start = height;
          handle.setPointerCapture(event.pointerId);
          const move = (next) => setHeight(Math.max(120, Math.min(650, start + next.clientY - y)));
          const finish = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', finish);
            handle.removeEventListener('pointercancel', finish);
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', finish);
          handle.addEventListener('pointercancel', finish);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown')
            setHeight(Math.max(120, height + (event.key === 'ArrowUp' ? -20 : 20)));
        }}
      />
      <section id="toolsWindow">{section('actor', tools, 'Tools')}</section>
    </>
  );
}

// Geometry changes during dragging do not alter inspector fields. Avoid rebuilding
// large provider/evidence forms for each pointer frame; refresh at release.
const StableInspector = memo(
  Inspector,
  (_previous, next) =>
    next.app.state.canvasState.drag?.kind === 'nodes' && next.app.state.canvasState.drag.moved
);
function Inspector({ app }) {
  const { state: s, commands: c } = app;
  const doc = s.workspaceState.project?.document;
  if (!doc) return null;
  const group = doc.groups.find((item) => item.id === app.ui.activeGroup);
  const nodes = doc.nodes.filter((node) => s.selectionState.selected.has(node.id));
  if (group) {
    const members = doc.nodes.filter((node) => c.groupNodeIds(group).has(node.id));
    return (
      <>
        <span className="node-kind">{t('ui.group_b4c02265').toUpperCase()}</span>
        <h2>{t('ui.group_details')}</h2>
        <Field
          label={t('ui.label')}
          value={c.groupTitle(group)}
          onChange={(value) => {
            group.label = value;
            group.label_custom = true;
            delete group.label_key;
            c.change();
            c.render();
          }}
        />
        <DetailSection className="group-controls">
          <Button
            className="wide"
            icon={group.collapsed ? 'chevron-right' : 'chevron-down'}
            onClick={() => c.toggleGroup(group)}
          >
            {t(group.collapsed ? 'Aufklappen' : 'Einklappen')}
          </Button>
        </DetailSection>
        <DetailSection className="node-report-section">
          <Check
            checked={members.length > 0 && members.every((node) => node.report)}
            onChange={(value) => {
              members.forEach((node) => (node.report = value));
              c.change();
            }}
          >
            {t('ui.include_group_in_report')}
          </Check>
        </DetailSection>
        {doc.groups.filter((child) => child.parent_id === group.id).length > 0 && (
          <DetailSection className="group-children">
            {doc.groups
              .filter((child) => child.parent_id === group.id)
              .map((child) => (
                <Button key={child.id} className="wide" onClick={() => c.inspectGroup(child)}>
                  {c.groupTitle(child)}
                </Button>
              ))}
          </DetailSection>
        )}
        <DetailSection className="group-controls">
          <Button className="wide" onClick={() => c.dissolveGroup(group)} icon="ungroup">
            {t('ui.ungroup_a7471297')}
          </Button>
        </DetailSection>
        <DetailSection className="node-delete-section">
          <Button className="danger-filled wide" icon="trash" onClick={() => c.deleteGroup(group)}>
            {t('ui.delete_group')}
          </Button>
        </DetailSection>
      </>
    );
  }
  if (!nodes.length)
    return (
      <>
        {doc.edges
          .filter((edge) => s.selectionState.selectedEdges.has(edge.id))
          .map((edge) => (
            <section key={edge.id}>
              <h2>{t('ui.connection_details')}</h2>
              <Field
                label={t('ui.label')}
                value={edge.label}
                onChange={(value) => {
                  edge.label = value;
                  c.change();
                  c.render();
                }}
              />
              <Button
                icon="trash"
                className="danger-filled wide"
                onClick={() => c.deleteEdges([edge.id])}
              >
                {t('ui.delete_connection')}
              </Button>
            </section>
          ))}
      </>
    );
  if (nodes.length > 1)
    return (
      <>
        <h2>
          {nodes.length} {t('ui.nodes_selected_c456770e')}
        </h2>
        <DetailSection className="node-report-section">
          <Check
            checked={nodes.every((node) => node.report)}
            onChange={(value) => {
              nodes.forEach((node) => (node.report = value));
              c.change();
            }}
          >
            {t('ui.include_all_in_report')}
          </Check>
        </DetailSection>
        <DetailSection className="node-delete-section">
          <Button
            icon="trash"
            className="danger-filled wide node-delete"
            onClick={() => c.deleteNodes(nodes.map((node) => node.id))}
          >
            {t('ui.delete_nodes')}
          </Button>
        </DetailSection>
      </>
    );
  return <NodeDetails key={nodes[0].id} app={app} node={nodes[0]} />;
}

function NodeDetails({ app, node }) {
  const { commands: c, state: s } = app;
  const doc = s.workspaceState.project.document;
  const plugin = s.pluginsState.catalog.find((item) => item.id === node.data.plugin);
  const action = plugin?.actions.find((item) => item.id === node.data.action);
  const actor = node.type === 'actor';
  const commit = (key, value) => {
    if (actor) node.data.params = { ...node.data.params, [key]: value };
    else node.data[key] = value;
    c.change(node.id);
    c.render();
  };
  const data = actor
    ? { ...action?.default_params, ...node.data.params }
    : c.editableNodeData(node);
  const exclude = actor
    ? Object.keys(data).filter(
        (key) =>
          key.startsWith('use_') ||
          ['source', 'source_order', 'search_profiles'].includes(key) ||
          action?.settings_only?.includes(key) ||
          Object.values(providerFields).flat().includes(key) ||
          action?.parameter_schema?.[key]?.secret ||
          (hasMediaEditor(node) && [...cropKeys, 'start_seconds', 'end_seconds'].includes(key))
      )
    : [];
  if (['phone', 'email'].includes(node.type)) exclude.push('value');
  if (node.type === 'location') exclude.push('country', 'country_code');
  if (node.type === 'profile') exclude.push('provider');
  if (node.type === 'database') exclude.push('database_id', 'database_title');
  if (actor && ['database_search', 'deepface'].includes(node.data.plugin))
    exclude.push('column_id');
  if (node.type === 'datetime') exclude.push('date', 'time', 'timezone');
  const sourceIds = new Set(
    doc.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source)
  );
  const source = doc.nodes.find(
    (item) =>
      sourceIds.has(item.id) && item.type === (node.data.plugin === 'video' ? 'video' : 'image')
  );
  const fileURL = node.data.file_id && '/api/files/' + node.data.file_id;
  const running = s.executionState.activeActors.has(node.id);
  const preparing = s.executionState.preflighting.has(node.id);
  const queued = s.executionState.actorQueue.some((job) => job.id === node.id);
  const availableTags = (s.preferencesState.appSettings.tags || []).filter(
    (tag) => !(node.tags || []).includes(tag.id)
  );
  return (
    <>
      <span className="node-kind">{c.dataLabel(node.type).toUpperCase()}</span>
      <h2>{t('ui.node_details')}</h2>
      {actor && (
        <DetailSection className="tool-run-section">
          <Button
            app={app}
            className={'primary wide' + (running || preparing ? ' tool-executing' : '')}
            aria-busy={running || preparing}
            icon={running || preparing ? 'spinner' : queued ? 'clock' : 'play'}
            disabled={
              running ||
              preparing ||
              Boolean(
                action &&
                c.actorIncompatible(
                  action,
                  doc.nodes.filter((item) => sourceIds.has(item.id) && item.type !== 'actor')
                )
              ) ||
              s.executionState.actorQueue.some((job) => job.id === node.id)
            }
            onClick={() => c.run(node)}
          >
            {t(
              running || preparing
                ? 'Wird ausgeführt …'
                : queued
                  ? 'In Warteschlange'
                  : s.executionState.activeActors.size
                    ? 'Zur Warteschlange hinzufügen'
                    : 'Tool ausführen'
            )}
          </Button>
        </DetailSection>
      )}
      <DetailSection className={'node-title-section' + (actor ? ' actor-title' : '')}>
        <Field
          label={t('ui.title')}
          value={c.nodeTitle(node)}
          onChange={(value) => {
            node.label = value;
            delete node.evidence.label_key;
            node.evidence.label_custom = true;
            if (node.type === 'error') node.data.title = value;
            c.change(node.id);
          }}
        />
      </DetailSection>
      {node.type === 'database' && (
        <DatabaseReference
          app={app}
          node={node}
          onChange={(value) => commit('database_id', value)}
        />
      )}
      {actor &&
        ['database_search', 'deepface'].includes(node.data.plugin) &&
        doc.nodes.some((item) => sourceIds.has(item.id) && item.type === 'database') && (
          <DatabaseColumn
            app={app}
            node={node}
            source={doc.nodes.find((item) => sourceIds.has(item.id) && item.type === 'database')}
            onChange={(value) => commit('column_id', value)}
          />
        )}
      {node.type === 'email' && (
        <Field
          label={t('ui.email')}
          value={node.data.value || ''}
          schema={{ type: 'email' }}
          onChange={(value) => commit('value', value)}
        />
      )}
      {node.type === 'phone' && <PhoneField app={app} node={node} commit={commit} />}
      {node.type === 'location' && (
        <div className="country-input">
          <Field
            label={t('ui.country')}
            value={node.data.country_code || ''}
            schema={{
              enum: ['', ...locationCountries],
              labels: Object.fromEntries(
                ['', ...locationCountries].map((code) => [
                  code,
                  code
                    ? new Intl.DisplayNames([language], { type: 'region' }).of(code)
                    : t('ui.any')
                ])
              )
            }}
            onChange={(code) => {
              node.data.country_code = code;
              node.data.country = code
                ? new Intl.DisplayNames([language], { type: 'region' }).of(code)
                : '';
              c.change(node.id);
            }}
          />
          <Field label={t('ui.code')} value={node.data.country_code || ''} disabled />
        </div>
      )}
      {node.type === 'datetime' && <DateTimeFields node={node} commit={commit} />}
      {node.type === 'profile' && (
        <>
          <Field
            label={t('ui.provider')}
            value={
              s.pluginsState.providerIndex.has(c.providerSearchKey(node.data.provider))
                ? c.providerName(node.data.provider)
                : t('ui.other_custom_fbc668fd')
            }
            schema={{
              enum: [
                ...s.pluginsState.providerCatalogue.map((item) => item.name),
                t('ui.other_custom_fbc668fd')
              ]
            }}
            onChange={(value) =>
              commit(
                'provider',
                s.pluginsState.providerCatalogue.find((item) => item.name === value)?.id ||
                  'custom:'
              )
            }
          />
          {(!s.pluginsState.providerIndex.has(c.providerSearchKey(node.data.provider)) ||
            String(node.data.provider).startsWith('custom:')) && (
            <Field
              label={t('ui.custom_provider')}
              value={String(node.data.provider || '').replace(/^custom:/, '')}
              onChange={(value) => commit('provider', 'custom:' + value)}
            />
          )}
        </>
      )}
      <Fields
        values={data}
        schema={action?.parameter_schema}
        sections={action?.parameter_sections}
        translate={(text) => c.pluginText(plugin || c.nodePlugin(node.type), text)}
        exclude={exclude}
        label={(key) => c.pluginText(plugin || c.nodePlugin(node.type), c.fieldName(key))}
        onChange={commit}
        help={action?.parameter_help}
      />
      {hasMediaEditor(node) && (
        <MediaEditor
          node={node}
          source={source}
          onChange={(values) => {
            node.data.params = { ...node.data.params, ...values };
            c.change(node.id);
          }}
        />
      )}
      {action?.research_profiles && (
        <section className="tool-search-profiles">
          <h3>{t('ui.search_profiles_for_this_search')}</h3>
          {Object.entries(action.research_profiles)
            .filter(([provider]) => action.default_params['use_' + provider] !== false)
            .map(([provider, catalog]) => (
              <details key={provider} className="provider-profiles">
                <summary>{provider}</summary>
                <SearchProfiles
                  catalog={catalog}
                  value={
                    node.data.params?.search_profiles?.[provider] ??
                    action.default_params.search_profiles?.[provider] ??
                    []
                  }
                  onChange={(value) =>
                    commit('search_profiles', {
                      ...node.data.params?.search_profiles,
                      [provider]: value
                    })
                  }
                />
              </details>
            ))}
        </section>
      )}
      {['note', 'marker'].includes(node.type) && (
        <section>
          <ColorField
            label={t('ui.color')}
            value={node.appearance?.color || '#ffcc70'}
            onChange={(color) => {
              if (/^#[0-9a-f]{6}$/i.test(color)) {
                node.appearance = { ...node.appearance, color };
                c.change(node.id);
              }
            }}
          />
          {['width', 'height'].map((key) => (
            <Field
              key={key}
              label={t(key === 'width' ? 'Breite' : 'Höhe')}
              value={node.appearance?.[key] || (key === 'width' ? 320 : 180)}
              schema={{
                min: key === 'width' ? 200 : 120,
                max: key === 'width' ? 900 : 800,
                step: 1
              }}
              onChange={(value) => {
                node.appearance = { ...node.appearance, [key]: value };
                c.change(node.id);
              }}
            />
          ))}
        </section>
      )}
      {(displayOptions[node.type] || []).length > 0 && (
        <section className="node-display-section">
          <h3>{t('ui.quick_actions_glances')}</h3>
          {c.resourceActions(node).map((item) => (
            <Button
              app={app}
              key={item.key}
              className="primary wide"
              icon={item.icon}
              onClick={() => c.openNodeResource(node, item.provider)}
            >
              {t(item.label)}
            </Button>
          ))}
          {(displayOptions[node.type] || []).map(([key, label]) => (
            <Check
              key={key}
              checked={node.display?.[key]}
              onChange={(value) => {
                node.display = { ...node.display, [key]: value };
                c.change(node.id);
              }}
            >
              {t(label)}
            </Check>
          ))}
        </section>
      )}
      {node.type === 'video' && fileURL && (
        <MediaFrame className="media-frame preview" src={fileURL} video />
      )}
      {node.type === 'image' && fileURL && (
        <MediaFrame className="media-frame preview" src={fileURL} alt={node.label} />
      )}
      {node.type === 'location' && c.mapsUrl(node, true) && (
        <MapPreview className="detail-map" src={c.mapsUrl(node, true)} title={node.label} />
      )}
      {!actor && node.type !== 'marker' && (
        <>
          {!['error', 'note'].includes(node.type) && (
            <section className="verification-section">
              <Field
                label={t('ui.verification')}
                value={node.verification || 'unverified'}
                schema={{
                  enum: ['unverified', 'unclear', 'verified'],
                  labels: {
                    unverified: t('ui.unverified'),
                    unclear: t('ui.unclear'),
                    verified: t('ui.verified')
                  }
                }}
                onChange={(value) => {
                  node.verification = value;
                  c.change(node.id);
                }}
              />
            </section>
          )}
          <section className="node-tags-section">
            <h3>{t('ui.tags')}</h3>
            <div className="tag-badges">
              {(node.tags || []).map((id) => {
                const tag = s.preferencesState.appSettings.tags?.find((item) => item.id === id);
                return (
                  tag && (
                    <span key={id} className="tag" style={{ borderColor: tag.color }}>
                      {tag.name}
                      <Button
                        only
                        icon="close"
                        className="danger-text"
                        onClick={() => {
                          node.tags = node.tags.filter((value) => value !== id);
                          c.change(node.id);
                        }}
                      >
                        {t('ui.remove')}
                      </Button>
                    </span>
                  )
                );
              })}
            </div>
            <Select
              label={t('ui.add_tag')}
              placeholder={t('ui.add_tag_7d178046')}
              value=""
              options={availableTags.map((tag) => ({ value: tag.id, label: tag.name }))}
              onChange={(id) => {
                if (id) {
                  node.tags = [...(node.tags || []), id];
                  c.change(node.id);
                }
              }}
            />
          </section>
        </>
      )}
      <DetailSection className="node-report-section">
        <Check
          checked={node.report}
          onChange={(value) => {
            node.report = value;
            c.change(node.id);
          }}
        >
          {t('ui.include_in_report')}
        </Check>
      </DetailSection>
      <Provenance value={node.evidence} />
      {doc.runs
        .filter((run) => run.actor_id === node.id)
        .slice(-5)
        .reverse()
        .map((run) => (
          <section key={run.id} className={'run ' + run.status}>
            <strong>{t(run.status)}</strong>
            {run.error && <p>{diagnostic(run.error)}</p>}
            {run.warnings?.map((warning, index) => (
              <p key={index}>{diagnostic(warning)}</p>
            ))}
          </section>
        ))}
      <DetailSection className="node-delete-section">
        <Button
          app={app}
          icon="trash"
          className="danger-filled wide node-delete"
          onClick={() => c.deleteNodes([node.id])}
        >
          {t('ui.delete_node')}
        </Button>
      </DetailSection>
    </>
  );
}

function Provenance({ value }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="provenance"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t('ui.source_origin')}</summary>
      {open && <Facts value={value} />}
    </details>
  );
}

function DatabaseReference({ app, node, onChange }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    app.commands
      .api('/api/databases')
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [app]);
  return (
    <DetailSection>
      <label>{t('ui.database')}</label>
      <Select
        label={t('ui.choose_database')}
        value={node.data.database_id}
        options={items.map((item) => ({ value: item.id, label: item.title }))}
        onChange={(id) => {
          const selected = items.find((item) => item.id === id);
          node.data.database_title = selected?.title || '';
          if (!node.evidence?.label_custom) node.label = selected?.title || node.label;
          onChange(id);
        }}
      />
      {error && <p role="alert">{error}</p>}
      {!items.length && !error && <p>{t('ui.create_or_import_databases_from_the_main_menu')}</p>}
    </DetailSection>
  );
}

function DatabaseColumn({ app, node, source, onChange }) {
  const [fields, setFields] = useState([]);
  useEffect(() => {
    let alive = true;
    if (source.data.database_id)
      app.commands
        .api('/api/databases/' + source.data.database_id + '/schema')
        .then((database) => {
          if (alive) setFields(database.fields);
        })
        .catch(() => {
          if (alive) setFields([]);
        });
    return () => {
      alive = false;
    };
  }, [app, source.data.database_id]);
  const available = fields.filter(
    (field) => node.data.plugin !== 'deepface' || field.type === 'image'
  );
  return (
    <div className="react-field">
      <label>{t('ui.reference_column')}</label>
      <Select
        label={t('ui.reference_column')}
        value={node.data.params?.column_id || ''}
        options={available.map((field) => ({ value: field.id, label: field.name }))}
        onChange={onChange}
      />
    </div>
  );
}

function PhoneField({ app, node, commit }) {
  const parsed = app.commands.splitPhoneNumber(node.data.value, node.display?.phoneRegion),
    [region, setRegion] = useState(parsed.region || ''),
    [number, setNumber] = useState(parsed.national || '');
  const names = new Intl.DisplayNames([language], { type: 'region' });
  function update(value, nextRegion = region) {
    let national = value,
      selected = nextRegion;
    if (value.trim().startsWith('+')) {
      const match = app.commands.splitPhoneNumber(value, nextRegion);
      selected = match.region;
      national = match.national;
      setRegion(selected);
    }
    setNumber(national);
    node.display = { ...node.display, phoneRegion: selected };
    commit('value', national ? (phoneCountries[selected]?.code || '') + national : '');
  }
  return (
    <div className="react-field">
      <label>{t('ui.phone_number')}</label>
      <div className="phone-input">
        <Select
          label={t('ui.country_calling_code')}
          value={region}
          displayValue={phoneCountries[region]?.code || '+'}
          options={[
            ...Object.entries(phoneCountries).map(([code, info]) => ({
              value: code,
              label: info.code + ' · ' + names.of(code)
            }))
          ]}
          onChange={(value) => {
            setRegion(value);
            update(number, value);
          }}
        />
        <input
          type="tel"
          aria-label={t('ui.phone_number')}
          value={number}
          onChange={(event) => update(event.target.value)}
        />
      </div>
    </div>
  );
}

function DateTimeFields({ node, commit }) {
  const zones = useMemo(
    () => [
      ...new Set(
        ['UTC', node.data.timezone, ...(Intl.supportedValuesOf?.('timeZone') || [])].filter(Boolean)
      )
    ],
    [node.data.timezone]
  );
  const zoneLabels = useMemo(() => {
    const time = node.data.time || '12:00';
    let date = new Date(
      (node.data.date || new Date().toISOString().slice(0, 10)) +
        'T' +
        time +
        (time.split(':').length === 2 ? ':00Z' : 'Z')
    );
    if (!Number.isFinite(date.getTime())) date = new Date();
    return Object.fromEntries(
      zones.map((zone) => {
        try {
          const offset = new Intl.DateTimeFormat('en', {
            timeZone: zone,
            timeZoneName: 'shortOffset'
          })
            .formatToParts(date)
            .find((part) => part.type === 'timeZoneName')
            .value.replace('GMT', 'UTC');
          return [zone, zone.replaceAll('_', ' ') + ' (' + offset + ')'];
        } catch {
          return [zone, zone];
        }
      })
    );
  }, [zones, node.data.date, node.data.time]);
  return (
    <>
      <Field
        label={t('ui.date')}
        value={node.data.date || ''}
        schema={{ type: 'date' }}
        onChange={(value) => commit('date', value)}
      />
      <Field
        label={t('ui.time')}
        value={node.data.time || ''}
        schema={{ type: 'time' }}
        onChange={(value) => commit('time', value)}
      />
      <Field
        label={t('ui.time_zone')}
        value={node.data.timezone || 'UTC'}
        schema={{ enum: zones, labels: zoneLabels }}
        onChange={(value) => commit('timezone', value)}
      />
    </>
  );
}

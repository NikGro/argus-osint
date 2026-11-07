import { errorText } from '../errors.js';
import React, { useEffect, useRef, useState } from 'react';
import { pollJob } from '../jobs-client.js';
import { Button, Check, Fields, Icon, SearchProfiles, SortList } from './ui/index.jsx';
import { providerFields, displayOptions } from '../app/labels.js';

export function Plugins({ app }) {
  const { commands: c, state: s } = app;
  const hasTools = s.pluginsState.catalog.some((plugin) => plugin.actions?.length);
  const [query, setQuery] = useState(''),
    [library, setLibrary] = useState(!hasTools),
    [attention, setAttention] = useState({ installing: 0, failed: 0 }),
    [libraryVersion, setLibraryVersion] = useState(0);
  // Installed plugins whose update or repair is running or failed are not in
  // the catalogue until they work again; say so instead of hiding them.
  useEffect(() => {
    if (app.ui.view !== 'pluginsView' || library) return;
    app.safely(async () => {
      const { plugins: items } = await c.api('/api/plugin-library');
      setAttention({
        installing: items.filter((item) => item.progress?.state === 'installing').length,
        failed: items.filter((item) => item.progress?.state === 'failed').length
      });
    });
  }, [app.ui.view, library]);
  async function addRepository() {
    const url = await c.askText('Add community repository', 'Repository URL', '');
    if (!url?.trim()) return;
    if (
      !(await c.askConfirm(
        'Add community repository',
        'The repository makes its plugins visible in the library; nothing is installed yet. Add only sources whose author you know and whose code you can review before installing.'
      ))
    )
      return;
    await c.api('/api/repositories/add', { url: url.trim() });
    setLibraryVersion((version) => version + 1);
  }
  return (
    <main id="pluginsView" hidden={app.ui.view !== 'pluginsView'}>
      <div className="intro">
        <h1>{'Installed plugins'}</h1>
        <p>{'Search, configure and manage your installed plugins.'}</p>
      </div>
      <section className="home-tools">
        <input
          type="search"
          value={query}
          aria-label={'Search plugins'}
          placeholder={'Search plugins …'}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          className={library ? '' : 'primary'}
          icon={library ? 'close' : 'plus'}
          aria-expanded={library}
          aria-controls="pluginLibrary"
          onClick={() => setLibrary(!library)}
        >
          {library ? 'Close library' : 'Add plugins'}
        </Button>
        {library && (
          <Button
            app={app}
            icon="plus"
            className="push-end"
            onClick={() => app.safely(addRepository)}
          >
            {'Add community repository'}
          </Button>
        )}
      </section>
      {library && <Library app={app} query={query} version={libraryVersion} />}
      <div id="pluginList" className="plugin-list" hidden={library}>
        {[true, false].map((tools) => (
          <section key={String(tools)} className="installed-plugin-section">
            <h2>{tools ? 'Tools' : 'Data nodes'}</h2>
            {tools && (attention.installing > 0 || attention.failed > 0) && (
              <div className="plugin-attention" role="status">
                <p>
                  {attention.failed > 0
                    ? `${attention.failed} plugin${attention.failed === 1 ? '' : 's'} could not be installed and ${attention.failed === 1 ? 'is' : 'are'} unavailable.`
                    : `${attention.installing} plugin${attention.installing === 1 ? ' is' : 's are'} being installed or updated.`}
                </p>
                <Button app={app} icon="plugin" onClick={() => setLibrary(true)}>
                  {'Open library'}
                </Button>
              </div>
            )}
            {s.pluginsState.catalog
              .filter(
                (plugin) =>
                  Boolean(plugin.actions?.length) === tools &&
                  (c.pluginDisplayName(plugin) + ' ' + plugin.description + ' ' + plugin.id)
                    .toLowerCase()
                    .includes(query.toLowerCase())
              )
              .map((plugin) => (
                <Plugin key={plugin.id} app={app} plugin={plugin} />
              ))}
            {tools && !hasTools && (
              <p className="empty-state">
                {
                  'No tools installed yet. Choose in the plugin library above which research tools ARGUS should download.'
                }
              </p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

function Plugin({ app, plugin }) {
  const { commands: c, state: s } = app;
  const [open, setOpen] = useState(s.pluginsState.pluginSettingsOpen.has(plugin.id));
  const [settings, setSettings] = useState(() => ({
    ...plugin.settings,
    defaults: Object.fromEntries(
      (plugin.actions || []).map((action) => [action.id, { ...action.default_params }])
    ),
    nodes: { ...plugin.settings?.nodes }
  }));
  const [error, setError] = useState(''),
    [connecting, setConnecting] = useState(false);
  const timer = useRef(null),
    pending = useRef(null),
    running = useRef(false),
    current = useRef(settings);
  async function persist() {
    clearTimeout(timer.current);
    if (running.current || !pending.current) return;
    running.current = true;
    s.pluginsState.pendingPluginSaves.add(plugin.id);
    s.pluginsState.pendingPluginDirty.delete(plugin.id);
    const sent = pending.current;
    pending.current = null;
    app.redraw();
    try {
      await c.api('/api/plugin/settings', { id: plugin.id, settings: sent });
      await c.refreshCatalog();
      setError('');
      app.ui.pluginSaveErrors?.delete(plugin.id);
    } catch (problem) {
      setError(problem.message);
      app.ui.pluginSaveErrors ||= new Map();
      app.ui.pluginSaveErrors.set(plugin.id, problem.message);
      if (!pending.current) pending.current = sent;
    } finally {
      running.current = false;
      s.pluginsState.pendingPluginSaves.delete(plugin.id);
      if (pending.current) s.pluginsState.pendingPluginDirty.add(plugin.id);
      if (pending.current) timer.current = setTimeout(persist, 1000);
      app.redraw();
    }
  }
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current) persist();
    },
    []
  );
  function changed(next) {
    current.current = next;
    setSettings(next);
    pending.current = next;
    s.pluginsState.pendingPluginDirty.add(plugin.id);
    app.redraw();
    app.ui.pluginSaveErrors?.delete(plugin.id);
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 600);
  }
  const defaults = (action, key, value) =>
    changed({
      ...current.current,
      defaults: {
        ...current.current.defaults,
        [action.id]: { ...current.current.defaults[action.id], [key]: value }
      }
    });
  async function connect() {
    if (connecting) return;
    setConnecting(true);
    try {
      await persist();
      if (pending.current || running.current) throw Error('Wait for saving to complete.');
      let transient = {};
      for (let attempt = 0; attempt < 4; attempt++) {
        const job = await c.api('/api/plugin/connection', {
          id: plugin.id,
          action: plugin.connection_action.id,
          request_key: c.uid() + c.uid(),
          transient
        });
        const finished = await pollJob(job.id);
        if (finished.state !== 'completed')
          throw Error(errorText(finished.error_code || 'execution_interrupted'));
        if (finished.result?.input_request) {
          const values = await c.parameterModal(finished.result.input_request);
          if (values === null) return;
          transient = values;
          continue;
        }
        if (!finished.result?.authenticated)
          throw Error((finished.result?.warnings || []).join(' · ') || 'Login failed.');
        await c.refreshCatalog();
        c.toast('Instagram login successful.');
        return;
      }
      throw Error('Too many consecutive input requests.');
    } finally {
      setConnecting(false);
    }
  }
  return (
    <article className="plugin-row" data-plugin-row={plugin.id}>
      <div className="plugin-header">
        <Button
          only
          className="plugin-expand borderless"
          icon={open ? 'chevron-down' : 'chevron-right'}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (open) s.pluginsState.pluginSettingsOpen.delete(plugin.id);
            else s.pluginsState.pluginSettingsOpen.add(plugin.id);
          }}
        >
          {'Plugin settings'}
        </Button>
        <div className="plugin-copy">
          <strong>{c.pluginDisplayName(plugin)}</strong>
          <p>{plugin.description}</p>
        </div>
        <Button
          app={app}
          icon="trash"
          only
          className="danger-filled"
          onClick={async () => {
            if (
              !(await c.askConfirm(
                `Remove “${c.pluginDisplayName(plugin)}”?`,
                plugin.tools?.length
                  ? 'The plugin is uninstalled. Tools that no other installed plugin needs are deleted and downloaded again on the next install. Settings are kept.'
                  : 'The plugin is uninstalled. Its settings are kept and apply again if you reinstall it.'
              ))
            )
              return;
            await persist();
            await c.api('/api/plugin/remove', { id: plugin.id });
            await c.refreshCatalog();
            app.redraw();
          }}
        >
          {'Remove'}
        </Button>
      </div>
      <div className="plugin-settings" hidden={!open}>
        <small>
          {plugin.id} · {plugin.version || 'bundled'}
        </small>
        {(plugin.nodes || []).map((node) => (
          <section key={node.type}>
            <h3>{node.name}</h3>
            <section className="plugin-default-section">
              <h4>{'Defaults for new nodes'}</h4>
              <Fields
                values={
                  settings.nodes?.[node.type]?.defaults ||
                  s.workspaceState.templates[node.type] ||
                  {}
                }
                label={(key) => c.fieldName(key)}
                onChange={(key, value) =>
                  changed({
                    ...current.current,
                    nodes: {
                      ...current.current.nodes,
                      [node.type]: {
                        ...current.current.nodes?.[node.type],
                        defaults: {
                          ...(current.current.nodes?.[node.type]?.defaults ||
                            s.workspaceState.templates[node.type]),
                          [key]: value
                        }
                      }
                    }
                  })
                }
              />
            </section>
            {(displayOptions[node.type] || []).length > 0 && (
              <section className="plugin-display-section">
                <h4>{'Quick Actions & Glances'}</h4>
                {(displayOptions[node.type] || []).map(([key, label]) => (
                  <Check
                    key={key}
                    checked={
                      settings.nodes?.[node.type]?.display_defaults?.[key] ??
                      node.display_defaults?.[key]
                    }
                    onChange={(value) =>
                      changed({
                        ...current.current,
                        nodes: {
                          ...current.current.nodes,
                          [node.type]: {
                            ...current.current.nodes?.[node.type],
                            display_defaults: {
                              ...node.display_defaults,
                              ...current.current.nodes?.[node.type]?.display_defaults,
                              [key]: value
                            }
                          }
                        }
                      })
                    }
                  >
                    {label}
                  </Check>
                ))}
              </section>
            )}
            {['map_preview_sources', 'map_action_sources']
              .filter((key) => node[key])
              .map((key) => (
                <div key={key}>
                  <h4>{key}</h4>
                  <SortList
                    items={settings.nodes?.[node.type]?.[key] || node[key]}
                    remove={false}
                    onChange={(value) =>
                      changed({
                        ...current.current,
                        nodes: {
                          ...current.current.nodes,
                          [node.type]: { ...current.current.nodes?.[node.type], [key]: value }
                        }
                      })
                    }
                    renderItem={(item) => (
                      <Check
                        checked={item.enabled !== false}
                        onChange={(enabled) => {
                          const list = current.current.nodes?.[node.type]?.[key] || node[key];
                          changed({
                            ...current.current,
                            nodes: {
                              ...current.current.nodes,
                              [node.type]: {
                                ...current.current.nodes?.[node.type],
                                [key]: list.map((row) =>
                                  row.id === item.id ? { ...row, enabled } : row
                                )
                              }
                            }
                          });
                        }}
                      >
                        {item.name || item.id}
                      </Check>
                    )}
                  />
                </div>
              ))}
          </section>
        ))}
        {(plugin.actions || []).map((action) => {
          const params = settings.defaults[action.id] || {};
          const actual = (key) =>
            action.settings_only?.includes(key) ||
            action.parameter_schema?.[key]?.secret ||
            /password|token|secret|api_key|sessionid/.test(key) ||
            key.startsWith('use_') ||
            ['source', 'source_order'].includes(key) ||
            Object.values(providerFields).flat().includes(key);
          const order = params.source_order || [];
          return (
            <section key={action.id}>
              <h3>{action.name}</h3>
              <section className="plugin-config-section">
                <h4>{'Plugin settings'}</h4>
                <p className="source-help">
                  {'Applies to the whole plugin, including credentials and source configuration.'}
                </p>
                {order.length > 0 && (
                  <SortList
                    items={order.map((id) => ({ id }))}
                    remove={false}
                    numbered
                    renderDetails={({ id }) => (
                      <>
                        <Fields
                          values={Object.fromEntries(
                            (providerFields[id] || [])
                              .filter(
                                (key) =>
                                  key in params &&
                                  !(
                                    action.research_profiles?.[id] &&
                                    [
                                      'consensus_sites',
                                      'sherlock_sites',
                                      'maigret_sites',
                                      'holehe_sites'
                                    ].includes(key)
                                  )
                              )
                              .map((key) => [key, params[key]])
                          )}
                          schema={action.parameter_schema}
                          label={(key) => c.fieldName(key)}
                          onChange={(key, value) => defaults(action, key, value)}
                        />
                        {action.research_profiles?.[id] ? (
                          <section className="provider-defaults">
                            <h4>{'Defaults for new tools'}</h4>
                            <p className="source-help">
                              {'You can change these values for each tool in its node details.'}
                            </p>
                            <SearchProfiles
                              catalog={action.research_profiles[id]}
                              value={params.search_profiles?.[id] || []}
                              onChange={(value) =>
                                defaults(action, 'search_profiles', {
                                  ...params.search_profiles,
                                  [id]: value
                                })
                              }
                            />
                          </section>
                        ) : (
                          !(providerFields[id] || []).some((key) => key in params) && (
                            <p className="source-help">
                              {'No additional settings are required for this provider.'}
                            </p>
                          )
                        )}
                      </>
                    )}
                    onChange={(items) =>
                      defaults(
                        action,
                        'source_order',
                        items.map((item) => item.id)
                      )
                    }
                    renderItem={({ id }) => (
                      <Check
                        checked={params['use_' + id] !== false}
                        onChange={(value) => defaults(action, 'use_' + id, value)}
                      >
                        {c.sourceLabel(id)}
                      </Check>
                    )}
                  />
                )}
                <Fields
                  values={Object.fromEntries(
                    Object.entries(params).filter(
                      ([key]) =>
                        actual(key) &&
                        key !== 'source_order' &&
                        !(
                          order.length &&
                          (key.startsWith('use_') ||
                            Object.values(providerFields).flat().includes(key))
                        )
                    )
                  )}
                  schema={action.parameter_schema}
                  sections={action.parameter_sections}
                  label={(key) => c.fieldName(key)}
                  onChange={(key, value) => defaults(action, key, value)}
                  help={action.parameter_help}
                />
              </section>
              <section className="plugin-default-section">
                <h4>{'Defaults for new tools'}</h4>
                <p className="source-help">
                  {'You can change these values for each tool in its node details.'}
                </p>
                <Fields
                  values={Object.fromEntries(
                    Object.entries(params).filter(
                      ([key]) => !actual(key) && key !== 'search_profiles'
                    )
                  )}
                  schema={action.parameter_schema}
                  sections={action.parameter_sections}
                  label={(key) => c.fieldName(key)}
                  onChange={(key, value) => defaults(action, key, value)}
                  help={action.parameter_help}
                />
              </section>
            </section>
          );
        })}
        {plugin.connection_action && (
          <Button
            app={app}
            className="primary wide"
            icon={connecting ? 'spinner' : 'play'}
            disabled={connecting}
            onClick={connect}
          >
            {plugin.connection_action.label}
          </Button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </article>
  );
}

const MIB = 1024 ** 2;

function size(bytes) {
  return bytes >= 1024 * MIB
    ? (bytes / 1024 / MIB).toFixed(1) + ' GB'
    : Math.max(1, Math.round(bytes / MIB)) + ' MB';
}

function installStep(plugin) {
  const progress = plugin.progress || {};
  if (progress.step === 'tool') {
    const labels = (plugin.tool_status || []).map((tool) => tool.label);
    return `Installing tool ${Math.max(1, labels.indexOf(progress.detail) + 1)} of ${labels.length || 1}: ${progress.detail}`;
  }
  if (progress.step === 'download') return 'Downloading plugin files';
  if (progress.step === 'catalogue') return 'Updating site catalogues';
  return 'Waiting for another installation';
}

function LibraryPlugin({ app, plugin, reload }) {
  const { commands: c } = app;
  const progress = plugin.progress;
  const installing = progress?.state === 'installing';
  const failed = progress?.state === 'failed';
  const tools = plugin.tool_status || [];
  const installedSize = tools.reduce((sum, tool) => sum + (tool.size || 0), 0);
  async function install() {
    if (
      plugin.origin === 'community' &&
      !(await c.askConfirm(
        'Install community plugin',
        `ARGUS does not review community plugins. Python code from ${plugin.repo_url || plugin.id} (commit ${String(plugin.commit || '').slice(0, 12) || '–'}) runs without a sandbox and with all of ARGUS's permissions: it can read your projects, credentials and files and fetch web pages. Install only if you have reviewed the repository and trust its author.`
      ))
    )
      return;
    const started = await c.api('/api/plugin/install', { id: plugin.id });
    // Small plugins install immediately; large ones report progress via polling.
    if (!started?.installing) await c.refreshCatalog();
    await reload();
  }
  return (
    <article className="plugin-row library-plugin" data-library-plugin={plugin.id}>
      <div className="plugin-header">
        <div className="plugin-copy">
          <strong>{c.pluginDisplayName(plugin)}</strong>
          <p>{plugin.description}</p>
          {tools.length > 0 && (
            <p className="library-tools">
              {plugin.installed && installedSize
                ? `Tools: ${tools.map((tool) => tool.label).join(', ')} · ${size(installedSize)} used`
                : `Downloads on install: ${tools.map((tool) => tool.label).join(', ')}`}
            </p>
          )}
        </div>
        {installing ? (
          <span className="install-state" role="status">
            <Icon name="spinner" /> {installStep(plugin)}
          </span>
        ) : plugin.installed ? (
          <span className="install-state installed">
            <Icon name="check" /> {'Installed'}
          </span>
        ) : (
          <Button app={app} icon={failed ? 'refresh' : 'download'} onClick={install}>
            {failed ? 'Retry installation' : 'Install'}
          </Button>
        )}
      </div>
      {failed && (
        <div className="install-failure" role="alert">
          <p>{errorText(progress.error || 'tool_install_failed')}</p>
          {progress.log?.length > 0 && (
            <details>
              <summary>{'Show installation log'}</summary>
              <pre>{progress.log.join('\n')}</pre>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

function Library({ app, query, version }) {
  const { commands: c } = app;
  const [data, setData] = useState({ plugins: [], repositories: [] }),
    [loaded, setLoaded] = useState(false);
  const installing = useRef(new Set());
  const load = async () => {
    const next = await c.api('/api/plugin-library');
    const active = new Set(
      next.plugins.filter((p) => p.progress?.state === 'installing').map((p) => p.id)
    );
    // A finished installation changes the installed list and the tool palette.
    if ([...installing.current].some((id) => !active.has(id))) await c.refreshCatalog();
    installing.current = active;
    setData(next);
    setLoaded(true);
    app.redraw();
  };
  useEffect(() => {
    app.safely(load);
  }, [version]);
  const busy = data.plugins.some((plugin) => plugin.progress?.state === 'installing');
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => app.safely(load), 1500);
    return () => clearInterval(timer);
  }, [busy]);
  const visible = data.plugins.filter(
    (plugin) => plugin.origin !== 'builtin' || plugin.actions?.length || !plugin.installed
  );
  const matches = (plugin) =>
    (c.pluginDisplayName(plugin) + ' ' + plugin.id).toLowerCase().includes(query.toLowerCase());
  return (
    <section className="plugin-library" id="pluginLibrary">
      <h2>{'Plugin library'}</h2>
      {!loaded && (
        <p className="library-loading" role="status" aria-busy="true">
          <Icon name="spinner" /> {'Loading plugins …'}
        </p>
      )}
      {[
        ['Native plugins', visible.filter((p) => p.origin !== 'community')],
        ['Community plugins', visible.filter((p) => p.origin === 'community')]
      ].map(
        ([title, plugins]) =>
          plugins.length > 0 && (
            <section key={title} className="plugin-library-group">
              <h3>{title}</h3>
              <div className="plugin-library-list">
                {plugins.filter(matches).map((plugin) => (
                  <LibraryPlugin key={plugin.id} app={app} plugin={plugin} reload={load} />
                ))}
              </div>
            </section>
          )
      )}
      <h3>{'Community repositories'}</h3>
      {data.repositories.length ? (
        <div className="plugin-library-list">
          {data.repositories.map((repo) => (
            <article key={repo.id} className="plugin-row repository-row">
              <strong>{repo.url}</strong>
              {repo.error && <p>{repo.error}</p>}
              <div className="tile-actions">
                <Button
                  app={app}
                  icon="refresh"
                  onClick={async () => {
                    await c.api('/api/repositories/refresh', { id: repo.id });
                    await load();
                  }}
                >
                  {'Refresh'}
                </Button>
                <Button
                  app={app}
                  className="danger-filled"
                  icon="trash"
                  onClick={async () => {
                    await c.api('/api/repositories/remove', { id: repo.id });
                    await load();
                  }}
                >
                  {'Remove'}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-state">{'No community repositories added yet.'}</p>
      )}
    </section>
  );
}

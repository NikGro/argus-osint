import React, { useEffect, useRef, useState } from 'react';
import { t } from '../i18n.js';
import { pollJob } from '../jobs-client.js';
import { Button, Check, Field, Fields, SearchProfiles, SortList } from './ui/index.jsx';
import { providerFields, displayOptions } from '../app/labels.js';

export function Plugins({ app }) {
  const [query, setQuery] = useState(''),
    [library, setLibrary] = useState(false);
  const { commands: c, state: s } = app;
  return (
    <main id="pluginsView" hidden={app.ui.view !== 'pluginsView'}>
      <div className="intro">
        <h1>{t('ui.installed_plugins')}</h1>
        <p>{t('ui.search_configure_and_manage_your_installed_plugins')}</p>
      </div>
      <section className="home-tools">
        <input
          type="search"
          value={query}
          aria-label={t('ui.search_plugins_3313d63d')}
          placeholder={t('ui.search_plugins')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button className="primary" icon="plus" onClick={() => setLibrary(!library)}>
          {t('ui.add_plugins_a728662a')}
        </Button>
      </section>
      {library && <Library app={app} />}
      <div id="pluginList" className="plugin-list">
        {[false, true].map((tools) => (
          <section key={String(tools)} className="installed-plugin-section">
            <h2>{t(tools ? 'Tools' : 'Daten-Nodes')}</h2>
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
      if (pending.current || running.current) throw Error(t('ui.wait_for_saving_to_complete'));
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
          throw Error(t('errors.' + (finished.error_code || 'execution_interrupted')));
        if (finished.result?.input_request) {
          const values = await c.parameterModal(finished.result.input_request);
          if (values === null) return;
          transient = values;
          continue;
        }
        if (!finished.result?.authenticated)
          throw Error((finished.result?.warnings || []).join(' · ') || t('ui.login_failed'));
        await c.refreshCatalog();
        c.toast(t('ui.instagram_login_successful'));
        return;
      }
      throw Error(t('ui.too_many_consecutive_input_requests'));
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
          {t('ui.plugin_settings')}
        </Button>
        <div className="plugin-copy">
          <strong>{c.pluginDisplayName(plugin)}</strong>
          <p>{c.pluginText(plugin, plugin.description)}</p>
        </div>
        <Button
          app={app}
          icon="trash"
          only
          className="danger-filled"
          onClick={async () => {
            await persist();
            await c.api('/api/plugin/remove', { id: plugin.id });
            await c.refreshCatalog();
            app.redraw();
          }}
        >
          {t('ui.remove')}
        </Button>
      </div>
      <div className="plugin-settings" hidden={!open}>
        <small>
          {plugin.id} · {plugin.version || 'bundled'}
        </small>
        {(plugin.nodes || []).map((node) => (
          <section key={node.type}>
            <h3>{c.pluginText(plugin, node.name)}</h3>
            <section className="plugin-default-section">
              <h4>{t('ui.defaults_for_new_nodes')}</h4>
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
                <h4>{t('ui.quick_actions_glances')}</h4>
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
                    {t(label)}
                  </Check>
                ))}
              </section>
            )}
            {['map_preview_sources', 'map_action_sources']
              .filter((key) => node[key])
              .map((key) => (
                <div key={key}>
                  <h4>{t(key)}</h4>
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
              <h3>{c.pluginText(plugin, action.name)}</h3>
              <section className="plugin-config-section">
                <h4>{t('ui.plugin_settings')}</h4>
                <p className="source-help">
                  {t('ui.applies_to_the_whole_plugin_including_credentials_and_source_conf')}
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
                          label={(key) => c.pluginText(plugin, c.fieldName(key))}
                          onChange={(key, value) => defaults(action, key, value)}
                        />
                        {action.research_profiles?.[id] ? (
                          <section className="provider-defaults">
                            <h4>{t('ui.defaults_for_new_tools')}</h4>
                            <p className="source-help">
                              {t(
                                'ui.you_can_change_these_values_for_each_tool_in_its_node_details'
                              )}
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
                              {t('ui.no_additional_settings_are_required_for_this_provider')}
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
                  translate={(text) => c.pluginText(plugin, text)}
                  label={(key) => c.pluginText(plugin, c.fieldName(key))}
                  onChange={(key, value) => defaults(action, key, value)}
                  help={action.parameter_help}
                />
              </section>
              <section className="plugin-default-section">
                <h4>{t('ui.defaults_for_new_tools')}</h4>
                <p className="source-help">
                  {t('ui.you_can_change_these_values_for_each_tool_in_its_node_details')}
                </p>
                <Fields
                  values={Object.fromEntries(
                    Object.entries(params).filter(
                      ([key]) => !actual(key) && key !== 'search_profiles'
                    )
                  )}
                  schema={action.parameter_schema}
                  sections={action.parameter_sections}
                  translate={(text) => c.pluginText(plugin, text)}
                  label={(key) => c.pluginText(plugin, c.fieldName(key))}
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
            {c.pluginText(plugin, plugin.connection_action.label)}
          </Button>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </article>
  );
}

function Library({ app }) {
  const { commands: c } = app;
  const [data, setData] = useState({ plugins: [], repositories: [] }),
    [query, setQuery] = useState(''),
    [url, setURL] = useState('');
  const load = async () => setData(await c.api('/api/plugin-library'));
  useEffect(() => {
    app.safely(load);
  }, []);
  return (
    <section className="plugin-library">
      <h2>{t('ui.plugin_library_4ba1045f')}</h2>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('ui.search_plugins')}
      />
      {data.plugins
        .filter((plugin) =>
          (plugin.name + ' ' + plugin.id).toLowerCase().includes(query.toLowerCase())
        )
        .map((plugin) => (
          <article key={plugin.id} className="plugin-row">
            <h3>{c.pluginDisplayName(plugin)}</h3>
            <p>{c.pluginText(plugin, plugin.description)}</p>
            <Button
              app={app}
              icon="plus"
              className="primary"
              disabled={plugin.installed}
              onClick={async () => {
                if (
                  plugin.origin === 'community' &&
                  !(await c.askConfirm(
                    t('ui.install_community_plugin'),
                    t('ui.community_plugin_install_warning', {
                      repository: plugin.repo_url || plugin.id,
                      commit: String(plugin.commit || '').slice(0, 12) || '–'
                    })
                  ))
                )
                  return;
                await c.api('/api/plugin/install', { id: plugin.id });
                await c.refreshCatalog();
                await load();
                app.redraw();
              }}
            >
              {t(plugin.installed ? 'Installiert' : 'Installieren')}
            </Button>
          </article>
        ))}
      <h3>{t('ui.community_repositories')}</h3>
      {data.repositories.map((repo) => (
        <article key={repo.id}>
          <strong>{repo.url}</strong>
          {repo.error && <p>{repo.error}</p>}
          <Button
            app={app}
            icon="refresh"
            onClick={async () => {
              await c.api('/api/repositories/refresh', { id: repo.id });
              await load();
            }}
          >
            {t('ui.refresh')}
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
            {t('ui.remove')}
          </Button>
        </article>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          app.safely(async () => {
            if (
              !(await c.askConfirm(
                t('ui.add_community_repository'),
                t('ui.community_repository_warning')
              ))
            )
              return;
            await c.api('/api/repositories/add', { url });
            setURL('');
            await load();
          });
        }}
      >
        <Field label={t('ui.repository_url')} value={url} onChange={setURL} />
        <button type="submit">{t('ui.add')}</button>
      </form>
    </section>
  );
}

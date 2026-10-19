import React, { useEffect, useRef, useState } from 'react';
import { t, setLanguage } from '../i18n.js';
import { Button, Check, Field, Icon, SortList, ColorSwatch } from './ui/index.jsx';

export function Settings({ app }) {
  const { commands: c, state: s } = app;
  const values = s.preferencesState.appSettings;
  const timer = useRef(null),
    version = useRef(0);
  async function flush() {
    if (s.preferencesState.settingsPromise) return;
    const sent = structuredClone(s.preferencesState.appSettings),
      stamp = version.current;
    s.preferencesState.settingsPromise = c.api('/api/settings', sent);
    app.redraw();
    try {
      const data = await s.preferencesState.settingsPromise;
      if (stamp === version.current) {
        s.preferencesState.appSettings = { ...sent, ...data };
        s.preferencesState.settingsDirty = false;
      }
      s.preferencesState.settingsError = '';
    } catch (error) {
      s.preferencesState.settingsError = error.message;
    } finally {
      s.preferencesState.settingsPromise = null;
      if (s.preferencesState.settingsDirty && !s.preferencesState.settingsError)
        timer.current = setTimeout(flush, 500);
      app.redraw();
    }
  }
  function persist(changes) {
    s.preferencesState.appSettings = { ...s.preferencesState.appSettings, ...changes };
    version.current++;
    s.preferencesState.settingsDirty = true;
    app.redraw();
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
    if (changes.language) return setLanguage(changes.language).then(app.redraw);
  }
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (s.preferencesState.settingsDirty) flush();
    },
    []
  );
  return (
    <main id="settingsView" hidden={app.ui.view !== 'settingsView'}>
      <div className="intro">
        <h1>{t('ui.settings')}</h1>
      </div>
      <section className="settings-form">
        <Field
          label={t('ui.language')}
          value={values.language || 'de'}
          schema={{
            labels: Object.fromEntries(
              (app.ui.languages || []).map((item) => [item.code, item.name])
            ),
            enum: (app.ui.languages || [{ code: 'de' }, { code: 'en' }]).map(
              (language) => language.code
            )
          }}
          onChange={(language) => app.safely(() => persist({ language }))}
        />
        <p>{t('ui.address_lookups_are_controlled_through_the_installed_photon_plugi')}</p>
        <p>{t('ui.configure_quick_actions_and_glances_in_the_corresponding_data_plu')}</p>
        <section className="global-tag-settings">
          <h2>{t('ui.global_tags')}</h2>
          <TagSettings
            app={app}
            tags={values.tags || []}
            onChange={(tags) => app.safely(() => persist({ tags }))}
          />
        </section>
        {app.ui.view === 'settingsView' && (
          <>
            <VPNSettings app={app} />
            <LogViewer app={app} />
          </>
        )}
      </section>
    </main>
  );
}
function TagSettings({ app, tags, onChange }) {
  return (
    <>
      <div className="global-tag-list">
        {tags.map((tag, index) => (
          <div key={tag.id} className="tag-manager-row">
            <Field
              label={t('ui.tag_name')}
              value={tag.name}
              schema={{ maxLength: 40 }}
              onChange={(name) => {
                if (name.trim())
                  onChange(tags.map((item, i) => (i === index ? { ...item, name } : item)));
              }}
            />
            <ColorSwatch
              compact
              label={t('ui.tag_color')}
              value={tag.color}
              onChange={(color) =>
                onChange(tags.map((item, i) => (i === index ? { ...item, color } : item)))
              }
            />
            <Button
              icon="trash"
              only
              className="danger-filled"
              onClick={() => onChange(tags.filter((item) => item.id !== tag.id))}
            >
              {t('ui.delete_tag')}
            </Button>
          </div>
        ))}
      </div>
      <Button
        app={app}
        icon="plus"
        onClick={async () => {
          const name = await app.commands.askText(t('ui.create_tag'), t('ui.tag_name'), '');
          if (!name?.trim()) return;
          if (tags.some((tag) => tag.name.toLowerCase() === name.trim().toLowerCase()))
            throw Error(t('ui.a_tag_with_this_name_already_exists'));
          onChange([...tags, { id: app.commands.uid(), name: name.trim(), color: '#8799b2' }]);
        }}
      >
        {t('ui.add_tag')}
      </Button>
    </>
  );
}

function VPNSettings({ app }) {
  const { commands: c } = app;
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [adding, setAdding] = useState(false),
    [error, setError] = useState('');
  const [profile, setProfile] = useState({
    name: '',
    type: 'openvpn',
    config: '',
    username: '',
    password: ''
  });
  const busyRef = useRef(false);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (document.hidden || busyRef.current) return;
      try {
        const response = await c.api('/api/vpn');
        if (!stopped) setData(response);
      } catch (problem) {
        if (!stopped) setError(problem.message);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  async function save(changes, rotate = false) {
    if (busyRef.current) return false;
    setBusy(true);
    busyRef.current = true;
    try {
      setData(
        await c.api(
          rotate ? '/api/vpn/rotate' : '/api/vpn',
          rotate ? {} : { ...data.settings, ...changes }
        )
      );
      setError('');
      return true;
    } catch (problem) {
      setError(problem.message);
      return false;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  if (!data)
    return (
      <section>
        <h2>
          <Icon name="vpn" /> VPN
        </h2>
        <p>{error || t('ui.loading')}</p>
      </section>
    );
  const { settings, status } = data;
  return (
    <section id="vpnSettings">
      <h2>
        <Icon name="vpn" /> VPN
      </h2>
      <span className="vpn-state" role="status">
        {t(
          !status.available
            ? 'VPN nicht verfügbar: Container-Netzwerkrechte prüfen'
            : status.connected
              ? 'VPN verbunden'
              : settings.enabled
                ? 'VPN wird verbunden'
                : 'VPN aus'
        )}
        {status.active?.name && ' · ' + status.active.name}
        <i className={status.connected ? 'connected' : settings.enabled ? 'warning' : ''} />
      </span>
      <p className="source-help">
        {t('ui.during_a_vpn_change_tools_wait_for_the_next_verified_connection')}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="vpn-controls">
        <Check
          checked={settings.enabled}
          disabled={busy || !status.available}
          onChange={(enabled) => save({ enabled })}
        >
          {t('ui.use_vpn')}
        </Check>
        <Check
          checked={settings.rotation_enabled}
          disabled={busy}
          onChange={(rotation_enabled) => save({ rotation_enabled })}
        >
          {t('ui.enable_rotation')}
        </Check>
        <Field
          label={t('ui.vpn_rotation')}
          value={settings.rotation_mode}
          schema={{
            enum: ['interval', 'actor'],
            labels: { interval: t('ui.at_a_time_interval'), actor: t('ui.after_each_tool') }
          }}
          disabled={busy || !settings.rotation_enabled}
          onChange={(rotation_mode) => save({ rotation_mode })}
        />
        <Field
          label={t('ui.interval_in_minutes')}
          value={settings.interval_seconds / 60}
          schema={{ min: 1, max: 1440, step: 1 }}
          disabled={busy || settings.rotation_mode !== 'interval'}
          onChange={(value) => save({ interval_seconds: value * 60 })}
        />
        <Button
          icon="refresh"
          disabled={busy || !settings.enabled || !status.available}
          onClick={() => save({}, true)}
        >
          {t('ui.switch_vpn_now')}
        </Button>
      </div>
      <SortList
        items={settings.profiles}
        onChange={(profiles) => save({ profiles })}
        remove={false}
        renderItem={(item) => (
          <div className="vpn-profile-label">
            <Icon name="vpn" />
            <strong>{item.name}</strong>
            <small>{item.type}</small>
            <Button
              icon="trash"
              only
              className="danger-filled"
              disabled={busy}
              onClick={() =>
                save({ profiles: settings.profiles.filter((row) => row.id !== item.id) })
              }
            >
              {t('ui.remove')}
            </Button>
          </div>
        )}
        renderDetails={(item) => (
          <>
            <Field
              label={t('ui.profile_name')}
              value={item.name}
              disabled={busy}
              onChange={(name) =>
                save({
                  profiles: settings.profiles.map((row) =>
                    row.id === item.id ? { ...row, name } : row
                  )
                })
              }
            />
            <p className="source-help">
              {t('ui.credentials_are_stored_encrypted_to_replace_them_remove_the_profi')}
            </p>
          </>
        )}
      />
      <Button className="primary" icon="plus" onClick={() => setAdding(!adding)}>
        {t('ui.add_vpn_profile')}
      </Button>
      {adding && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            app.safely(async () => {
              if (!profile.name.trim() || !profile.config.trim())
                throw Error(t('ui.complete_all_required_fields'));
              if (await save({ profiles: [...settings.profiles, profile] })) {
                setAdding(false);
                setProfile({ name: '', type: 'openvpn', config: '', username: '', password: '' });
              }
            });
          }}
        >
          <input
            type="file"
            accept=".ovpn,.conf,.txt"
            aria-label={t('ui.import_profile_file')}
            onChange={(event) =>
              app.safely(async () => {
                const file = event.target.files[0];
                if (!file) return;
                if (file.size > 131072) throw Error(t('ui.profile_file_is_too_large'));
                const config = await file.text();
                setProfile({
                  ...profile,
                  config,
                  name: profile.name || file.name.replace(/\.[^.]+$/, ''),
                  type: config.includes('[Interface]') ? 'wireguard' : 'openvpn'
                });
              })
            }
          />
          {Object.entries(profile).map(([key, value]) => (
            <Field
              key={key}
              label={t(
                {
                  name: 'Profilname',
                  type: 'VPN-Typ',
                  config: 'VPN-Profil',
                  username: 'VPN-Benutzername (optional)',
                  password: 'VPN-Passwort (optional)'
                }[key]
              )}
              value={value}
              schema={key === 'type' ? { enum: ['openvpn', 'wireguard'] } : {}}
              secret={key === 'password'}
              multiline={key === 'config'}
              onChange={(next) => setProfile({ ...profile, [key]: next })}
            />
          ))}
          <button type="submit" className="primary" disabled={busy}>
            {t('ui.save_profile')}
          </button>
        </form>
      )}
    </section>
  );
}

export function LogViewer({ app, project = false }) {
  const { commands: c, state: s } = app;
  const [query, setQuery] = useState(''),
    [limit, setLimit] = useState(0),
    [data, setData] = useState({ lines: [], total: 0 });
  const [auto, setAuto] = useState(localStorage.getItem('argus.logs.autoRefresh') === 'true');
  const [follow, setFollow] = useState(localStorage.getItem('argus.logs.autoScroll') !== 'false');
  const [error, setError] = useState('');
  const output = useRef(null),
    generation = useRef(0);
  const base = project ? '/api/projects/' + s.workspaceState.project?.id : '/api/system-logs';
  async function load(append = false) {
    const sequence = ++generation.current;
    try {
      const response = await c.api(
        base +
          (project ? '/logs' : '') +
          '?q=' +
          encodeURIComponent(query) +
          '&offset=' +
          (append ? data.lines.length : 0)
      );
      if (sequence !== generation.current) return;
      const rows = response.lines || response.rows || [];
      setData({
        lines: append ? [...data.lines, ...rows] : rows,
        total: response.total || rows.length,
        more: response.more
      });
      setError('');
    } catch (problem) {
      if (sequence === generation.current) setError(problem.message);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => load(), 200);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [query, base]);
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 5000);
    return () => clearInterval(timer);
  }, [auto, query, base]);
  useEffect(() => {
    if (follow && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [data, follow]);
  return (
    <section id={project ? 'projectLogs' : 'systemLogs'}>
      <div className="view-heading">
        {project && (
          <Button only icon="back" onClick={() => c.show('workspace')}>
            {t('ui.back')}
          </Button>
        )}
        <h2>
          <Icon name="logs" /> {t(project ? 'Logs' : 'Systemlogs')}
        </h2>
      </div>
      <div className="system-log-controls">
        <input
          type="search"
          aria-label={t('ui.search_system_logs')}
          placeholder={t('ui.search_system_logs')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button icon="refresh" onClick={() => load()}>
          {t('ui.refresh')}
        </Button>
        <Field
          label={t('ui.export_lines_0_all')}
          value={limit}
          schema={{ min: 0, step: 1 }}
          onChange={setLimit}
        />
        <a
          className="button"
          href={
            base +
            (project ? '/logs-export' : '/export') +
            '?q=' +
            encodeURIComponent(query) +
            '&limit=' +
            limit
          }
          download="argus-logs.txt"
        >
          <Icon name="download" />
          {t('ui.export')}
        </a>
        <Button
          app={app}
          icon="trash"
          className="danger-filled"
          onClick={async () => {
            if (project) await c.save();
            const response = await c.api(
              base + (project ? '/logs-clear' : '/clear'),
              project ? { revision: s.workspaceState.project.revision } : {}
            );
            if (project) {
              s.workspaceState.project = response;
              s.workspaceState.lastServerSnapshot = structuredClone(response.document);
            }
            await load();
          }}
        >
          {t('ui.clear_system_logs')}
        </Button>
      </div>
      <div className="system-log-options">
        <Check
          checked={auto}
          onChange={(value) => {
            setAuto(value);
            localStorage.setItem('argus.logs.autoRefresh', String(value));
          }}
        >
          {t('ui.auto_refresh')}
        </Check>
        <Check
          checked={follow}
          onChange={(value) => {
            setFollow(value);
            localStorage.setItem('argus.logs.autoScroll', String(value));
          }}
        >
          {t('ui.auto_scroll_to_bottom')}
        </Check>
      </div>
      {error && <p role="alert">{error}</p>}
      <pre ref={output} className="system-log-lines" tabIndex={0}>
        {[...data.lines]
          .reverse()
          .map((row) => row.text)
          .join('\n')}
      </pre>
      <p role="status">{t('ui.log_lines_count', { count: data.total })}</p>
      {(data.more || data.lines.length < data.total) && (
        <Button icon="plus" onClick={() => load(true)}>
          {t('ui.load_more')}
        </Button>
      )}
    </section>
  );
}

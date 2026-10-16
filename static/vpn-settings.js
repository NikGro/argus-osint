import { t } from './i18n.js';
import { icon } from './icons.js';

export async function vpnSettings(container, { api, el, iconActionButton, toast }) {
  clearInterval(container.vpnTimer);
  container.replaceChildren(el('h2', {}, t('VPN')));
  let settings = {
      enabled: false,
      profiles: [],
      rotation_enabled: false,
      rotation_mode: 'interval',
      interval_seconds: 900
    },
    status = {},
    saving = false;
  const state = el('span', { class: 'vpn-state', role: 'status' });
  const hint = el('p', { class: 'source-help' });
  const enabled = el('input', { type: 'checkbox' });
  const rotation = el('input', { type: 'checkbox' });
  const mode = el('select', { 'aria-label': t('VPN-Rotation') });
  mode.append(
    el('option', { value: 'interval' }, t('Nach Zeitintervall')),
    el('option', { value: 'actor' }, t('Nach jedem Tool'))
  );
  const interval = el('input', {
    type: 'number',
    min: 1,
    max: 1440,
    step: 1,
    'aria-label': t('Intervall in Minuten')
  });
  const list = el('div', { class: 'vpn-profiles' });
  const check = (input, text) => {
    const label = el('label', { class: 'checkbox-label' });
    label.append(input, document.createTextNode(t(text)));
    return label;
  };
  const controls = el('div', { class: 'vpn-controls' });
  const intervalLabel = el('label', {}, t('Intervall in Minuten'));
  intervalLabel.append(interval);
  const rotate = iconActionButton(
    t('VPN jetzt wechseln'),
    async () => {
      try {
        const data = await api('/api/vpn/rotate', {});
        apply(data);
      } catch (error) {
        toast(error.message);
      }
    },
    'refresh'
  );
  controls.append(
    check(enabled, 'VPN verwenden'),
    check(rotation, 'Rotation aktivieren'),
    mode,
    intervalLabel,
    rotate
  );
  container.append(state, hint, controls, list);
  function renderStatus() {
    const labels = {
      connected: 'VPN verbunden',
      connecting: 'VPN wird verbunden',
      unhealthy: 'Kein VPN-Profil erreichbar',
      disabled: 'VPN aus',
      disabling: 'VPN wird deaktiviert'
    };
    const label = status.available
      ? t(labels[status.state] || 'VPN wird verbunden')
      : t('VPN nicht verfügbar: Container-Netzwerkrechte prüfen');
    state.replaceChildren(
      document.createTextNode(label + (status.active?.name ? ' · ' + status.active.name : '')),
      el('i', { class: status.connected ? 'connected' : settings.enabled ? 'warning' : '' })
    );
    hint.textContent = status.available
      ? t('Während eines VPN-Wechsels warten Tools auf die nächste geprüfte Verbindung.')
      : t('VPN ist im Image enthalten. Benötigt werden NET_ADMIN und das TUN-Gerät im Container.');
    enabled.disabled = saving || !status.available;
    rotate.disabled = saving || !settings.enabled || !status.available;
  }
  function apply(data) {
    if (data.settings) settings = data.settings;
    status = data.status || status;
    enabled.checked = settings.enabled;
    rotation.checked = settings.rotation_enabled;
    mode.value = settings.rotation_mode;
    interval.value = settings.interval_seconds / 60;
    mode.disabled = saving || !settings.rotation_enabled;
    interval.disabled =
      saving || !settings.rotation_enabled || settings.rotation_mode !== 'interval';
    rotation.disabled = saving;
    list.replaceChildren();
    for (const [index, profile] of (settings.profiles || []).entries()) {
      const row = el('div', { class: 'vpn-profile' });
      const header = el('div', { class: 'vpn-profile-header' });
      const grip = iconActionButton(t('Profil verschieben'), () => {}, 'drag', 'source-drag');
      grip.replaceChildren(icon('drag'));
      grip.setAttribute('aria-label', t('Profil verschieben'));
      grip.draggable = true;
      grip.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('application/x-argus-vpn', profile.id);
        event.dataTransfer.effectAllowed = 'move';
      });
      grip.addEventListener('keydown', (event) => {
        const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (!direction || index + direction < 0 || index + direction >= settings.profiles.length)
          return;
        event.preventDefault();
        const profiles = [...settings.profiles];
        profiles.splice(index + direction, 0, profiles.splice(index, 1)[0]);
        save({ profiles });
      });
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = settings.profiles.findIndex(
          (p) => p.id === event.dataTransfer.getData('application/x-argus-vpn')
        );
        if (from < 0 || from === index) return;
        const profiles = [...settings.profiles];
        profiles.splice(index, 0, profiles.splice(from, 1)[0]);
        save({ profiles });
      });
      const body = el('div', { class: 'vpn-profile-body', hidden: '' });
      const nameInput = el('input', {
        value: profile.name,
        maxlength: 80,
        'aria-label': t('Profilname')
      });
      nameInput.addEventListener('change', () =>
        save({
          profiles: settings.profiles.map((p) =>
            p.id === profile.id ? { ...p, name: nameInput.value } : p
          )
        })
      );
      body.append(
        el('label', {}, t('Profilname')),
        nameInput,
        el(
          'p',
          { class: 'source-help' },
          t(
            'Zugangsdaten werden verschlüsselt gespeichert. Zum Ersetzen das Profil entfernen und neu hinzufügen.'
          )
        )
      );
      const expand = iconActionButton(
        t('Profil aufklappen'),
        () => {
          body.hidden = !body.hidden;
          expand.setAttribute('aria-expanded', String(!body.hidden));
          expand.replaceChildren(icon(body.hidden ? 'chevron-down' : 'chevron-up'));
        },
        'chevron-down',
        'source-expand'
      );
      expand.setAttribute('aria-expanded', 'false');
      expand.replaceChildren(icon('chevron-down'));
      expand.setAttribute('aria-label', t('Profil aufklappen'));
      const remove = iconActionButton(
        t('Profil entfernen'),
        () => save({ profiles: settings.profiles.filter((p) => p.id !== profile.id) }),
        'trash',
        'danger-filled'
      );
      remove.replaceChildren(icon('trash'));
      remove.setAttribute('aria-label', t('Profil entfernen'));
      remove.title = t('Profil entfernen');
      header.append(
        expand,
        grip,
        icon('vpn'),
        el('strong', {}, profile.name),
        el('span', { class: 'tag' }, profile.type === 'wireguard' ? 'WireGuard' : 'OpenVPN'),
        remove
      );
      row.append(header, body);
      list.append(row);
    }
    renderStatus();
  }
  async function save(changes) {
    if (saving) return;
    saving = true;
    renderStatus();
    try {
      apply(await api('/api/vpn', { ...settings, ...changes }));
    } catch (error) {
      toast(error.message);
      try {
        apply(await api('/api/vpn'));
      } catch {
        /* Keep the last confirmed state. */
      }
    } finally {
      saving = false;
      apply({});
    }
  }
  enabled.addEventListener('change', () => save({ enabled: enabled.checked }));
  rotation.addEventListener('change', () => save({ rotation_enabled: rotation.checked }));
  mode.addEventListener('change', () => save({ rotation_mode: mode.value }));
  interval.addEventListener('change', () => {
    if (interval.checkValidity()) save({ interval_seconds: Number(interval.value) * 60 });
    else interval.reportValidity();
  });
  const add = el('section', { class: 'vpn-add' });
  const form = el('form');
  form.hidden = true;
  const addButton = iconActionButton(
    t('VPN-Profil hinzufügen'),
    () => {
      form.hidden = !form.hidden;
      addButton.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) name.focus();
    },
    'plus',
    'primary'
  );
  add.append(addButton);
  const name = el('input', { required: '', maxlength: 80, 'aria-label': t('Profilname') });
  const type = el('select', { 'aria-label': t('VPN-Typ') });
  type.append(
    el('option', { value: 'openvpn' }, 'OpenVPN'),
    el('option', { value: 'wireguard' }, 'WireGuard')
  );
  const config = el('textarea', {
    rows: 9,
    required: '',
    maxlength: 131072,
    spellcheck: false,
    autocomplete: 'off',
    'aria-label': t('VPN-Profil')
  });
  const file = el('input', {
    type: 'file',
    accept: '.ovpn,.conf,.txt',
    'aria-label': t('Profildatei importieren')
  });
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    if (!chosen) return;
    if (chosen.size > 131072) {
      toast(t('Profildatei zu groß.'));
      return;
    }
    config.value = await chosen.text();
    if (!name.value) name.value = chosen.name.replace(/\.[^.]+$/, '');
    if (chosen.name.endsWith('.ovpn')) type.value = 'openvpn';
    else if (config.value.includes('[Interface]')) type.value = 'wireguard';
  });
  const username = el('input', {
    autocomplete: 'off',
    'aria-label': t('VPN-Benutzername (optional)')
  });
  const password = el('input', {
    type: 'password',
    autocomplete: 'new-password',
    'aria-label': t('VPN-Passwort (optional)')
  });
  for (const [label, input] of [
    ['Profilname', name],
    ['VPN-Typ', type],
    ['Profildatei importieren', file],
    ['VPN-Profil', config],
    ['VPN-Benutzername (optional)', username],
    ['VPN-Passwort (optional)', password]
  ]) {
    const field = el('label', {}, t(label));
    field.append(input);
    form.append(field);
  }
  const submit = el('button', { type: 'submit', class: 'primary' }, t('Profil speichern'));
  form.append(submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    submit.disabled = true;
    const previous = settings.profiles.length;
    await save({
      profiles: [
        ...settings.profiles,
        {
          name: name.value,
          type: type.value,
          config: config.value,
          username: username.value,
          password: password.value
        }
      ]
    });
    if (settings.profiles.length > previous) {
      form.reset();
      form.hidden = true;
      addButton.setAttribute('aria-expanded', 'false');
    }
    submit.disabled = false;
  });
  add.append(form);
  container.append(add);
  try {
    apply(await api('/api/vpn'));
  } catch (error) {
    toast(error.message);
    renderStatus();
  }
  container.vpnTimer = setInterval(async () => {
    if (!container.isConnected || container.closest('main')?.hidden || document.hidden || saving)
      return;
    try {
      const data = await api('/api/vpn');
      status = data.status || {};
      renderStatus();
    } catch {
      status = {};
      renderStatus();
    }
  }, 10000);
}

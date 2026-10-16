import { researchProfiles } from '../research-profiles.js';
import { t } from '../i18n.js';
import { diagnostic } from '../i18n.js';
import { transformExample } from './labels.js';
import { buttonContent } from '../icons.js';
var inspector_default = {
  name: 'inspector',
  dependencies: [
    '$',
    'actorIncompatible',
    'applyFields',
    'applyGraphHighlights',
    'button',
    'change',
    'dataLabel',
    'deleteEdges',
    'deleteGroup',
    'deleteNodes',
    'detachNodes',
    'displayControls',
    'dissolveGroup',
    'editFields',
    'editableNodeData',
    'el',
    'facts',
    'formatLocation',
    'groupNodeIds',
    'groupTitle',
    'iconActionButton',
    'inputField',
    'inspectorAvailability',
    'makeRoomForGroup',
    'nodePlugin',
    'phoneControls',
    'pluginText',
    'refreshDetailMap',
    'render',
    'renderPalette',
    'reviewControls',
    'run',
    'saveButtons',
    'toast',
    'toggleGroup'
  ],
  create({
    selectionState,
    workspaceState,
    pluginsState,
    executionState,
    canvasState,
    $,
    actorIncompatible,
    applyFields,
    applyGraphHighlights,
    button,
    change,
    dataLabel,
    deleteEdges,
    deleteGroup,
    deleteNodes,
    detachNodes,
    displayControls,
    dissolveGroup,
    editFields,
    editableNodeData,
    el,
    facts,
    formatLocation,
    groupNodeIds,
    groupTitle,
    iconActionButton,
    inputField,
    inspectorAvailability,
    makeRoomForGroup,
    nodePlugin,
    phoneControls,
    pluginText,
    refreshDetailMap,
    render,
    renderPalette,
    reviewControls,
    run,
    saveButtons,
    toast,
    toggleGroup
  }) {
    function inspect(preserveGroups = false) {
      applyGraphHighlights();
      if (!preserveGroups) {
        selectionState.selectedGroup = null;
        selectionState.selectedGroups.clear();
        for (const g of document.querySelectorAll('.group.selected'))
          g.classList.remove('selected');
      }
      renderPalette();
      const panel = $('inspector');
      panel.replaceChildren();
      if (!workspaceState.project) {
        inspectorAvailability('');
        return;
      }
      const nodes = workspaceState.project.document.nodes.filter((n) =>
        selectionState.selected.has(n.id)
      );
      inspectorAvailability(
        nodes
          .map((n) => n.id)
          .sort()
          .join(',')
      );
      if (!nodes.length) {
        if (selectionState.selectedEdges.size) {
          inspectorAvailability('edges:' + Array.from(selectionState.selectedEdges).join(','));
          panel.append(
            el(
              'span',
              {
                class: 'tag'
              },
              t('Verbindung')
            ),
            el('h2', {}, t('Verbindungsdetails'))
          );
          for (const edge of workspaceState.project.document.edges.filter((e) =>
            selectionState.selectedEdges.has(e.id)
          )) {
            const label = inputField(panel, t('Bezeichnung'), edge.label || '');
            label.addEventListener('input', () => {
              edge.label = label.value;
              change();
              render();
            });
          }
          panel.append(
            iconActionButton(
              t('Verbindung l\xF6schen'),
              () => deleteEdges([...selectionState.selectedEdges]),
              'trash',
              'danger-filled'
            )
          );
        }
        return;
      }
      if (nodes.length !== 1) {
        panel.append(
          el(
            'span',
            {
              class: 'tag'
            },
            t('Mehrfachauswahl')
          ),
          el('h2', {}, nodes.length + t(' Knoten ausgew\xE4hlt'))
        );
        if (
          nodes.some((n) =>
            workspaceState.project.document.groups.some((g) => g.members.includes(n.id))
          )
        )
          panel.append(
            iconActionButton(
              t('Aus Gruppe l\xF6sen'),
              () => detachNodes(nodes.map((n) => n.id)),
              'ungroup',
              'wide'
            )
          );
        const report = el('input', { type: 'checkbox' });
        report.checked = nodes.every((node) => node.report);
        report.indeterminate = nodes.some((node) => node.report) && !report.checked;
        const label = el('label', { class: 'checkbox-label' });
        label.append(report, document.createTextNode(t('In Report aufnehmen')));
        report.addEventListener('change', () => {
          for (const node of nodes) node.report = report.checked;
          change();
        });
        const actions = el('section', { class: 'multi-selection-actions node-report-section' });
        actions.append(
          label,
          iconActionButton(
            t('Knoten l\xF6schen'),
            () => deleteNodes(nodes.map((n) => n.id)),
            'trash',
            'danger-filled wide'
          )
        );
        panel.append(actions);
        return;
      }
      const node = nodes[0],
        actorAction =
          node.type === 'actor'
            ? pluginsState.catalog
                .find((p) => p.id === node.data.plugin)
                ?.actions.find((a) => a.id === node.data.action)
            : null;
      panel.append(
        el(
          'span',
          {
            class: 'tag'
          },
          dataLabel(node.type)
        ),
        el('h2', {}, t('Knotendetails'))
      );
      const name = inputField(panel, t('Titel'), node.label, 'node-label');
      const readers = ['note', 'marker'].includes(node.type)
        ? []
        : editFields(
            panel,
            node.type === 'actor'
              ? Object.fromEntries(
                  Object.entries({ ...actorAction?.default_params, ...node.data.params }).filter(
                    ([key]) =>
                      !key.startsWith('_merge_') &&
                      !(
                        actorAction?.default_params?.source_order &&
                        (key === 'source' || key === 'source_order' || key.startsWith('use_'))
                      ) &&
                      key !== 'search_profiles' &&
                      !(actorAction?.settings_only || []).includes(key)
                  )
                )
              : editableNodeData(node),
            [],
            (key) =>
              pluginText(
                node.type === 'actor'
                  ? pluginsState.catalog.find((p) => p.id === node.data.plugin)
                  : nodePlugin(node.type),
                key
              ),
            {
              schema: actorAction?.parameter_schema,
              sections: actorAction?.parameter_sections,
              help: actorAction?.parameter_help
            }
          );
      if (['note', 'marker'].includes(node.type)) noteControls(panel, node);
      if (['url', 'profile', 'image', 'location', 'file'].includes(node.type))
        displayControls(panel, node);
      if (node.type === 'phone') phoneControls(panel, node, readers);
      let profileReaders = null;
      const commitNode = () => {
        try {
          const data = applyFields(
            node.type === 'actor' ? node.data.params || {} : node.data,
            readers
          );
          if (profileReaders)
            data.search_profiles = {
              ...node.data.params?.search_profiles,
              ...Object.fromEntries(
                Object.entries(profileReaders).map(([provider, read]) => [provider, read()])
              )
            };
          if (node.type === 'actor') node.data.params = data;
          else node.data = data;
          if (node.type === 'location') node.data.formatted_address = formatLocation(node.data);
          node.label = name.value;
          if (node.type === 'error') node.data.title = name.value;
          change(node.id);
          render();
          if (node.type === 'location') refreshDetailMap(panel, node);
        } catch (error) {
          toast(error.message);
        }
      };
      if (actorAction?.research_profiles) {
        profileReaders = {};
        const defaults = actorAction.default_params || {};
        const profiles = node.data.params?.search_profiles ?? defaults.search_profiles ?? {};
        const section = el('section', { class: 'tool-search-profiles' });
        section.append(el('h3', {}, t('Suchprofile für diese Suche')));
        const labels = {
          consensus: 'Consensus',
          sherlock: 'Sherlock',
          maigret: 'Maigret',
          holehe: 'Holehe',
          user_scanner: 'User Scanner',
          blackbird: 'Blackbird',
          ignorant: 'Ignorant'
        };
        for (const [provider, catalog] of Object.entries(actorAction.research_profiles)) {
          if (defaults['use_' + provider] === false) continue;
          const box = el('details', { class: 'provider-profiles' });
          box.append(el('summary', {}, labels[provider] || provider));
          const legacyField = {
            consensus: 'consensus_sites',
            sherlock: 'sherlock_sites',
            maigret: 'maigret_sites',
            holehe: 'holehe_sites'
          }[provider];
          const legacy = node.data.params?.[legacyField] ?? defaults[legacyField];
          const initial =
            profiles[provider] ?? (legacy?.length ? [{ id: 'custom', sites: legacy }] : []);
          profileReaders[provider] = researchProfiles(box, initial, catalog, commitNode);
          section.append(box);
        }
        if (Object.keys(profileReaders).length) panel.append(section);
      }
      name.addEventListener('input', () => {
        delete node.evidence.label_key;
        commitNode();
      });
      for (const field of readers) field.control.addEventListener('input', commitNode);
      if (node.type !== 'actor') reviewControls(panel, node);
      const nodeSave = el('span', {
        class: 'save-indicator'
      });
      nodeSave.id = 'nodeSave';
      nodeSave.dataset.nodeSave = node.id;
      panel.append(nodeSave);
      saveButtons();
      if (node.type === 'image' && node.data.file_id)
        panel.append(
          el('img', {
            class: 'preview',
            src: '/api/files/' + node.data.file_id,
            alt: node.label
          })
        );
      if (node.type === 'actor') {
        const mod = pluginsState.catalog.find((p) => p.id === node.data.plugin);
        const act = mod?.actions.find((a) => a.id === node.data.action);
        panel.append(el('h3', {}, t('Ausf\xFChrung')));
        if (act?.external)
          panel.append(
            el(
              'p',
              {
                class: 'warning'
              },
              pluginText(mod, act.external_notice) ||
                t('Bei konfiguriertem Geocoder werden Standortangaben an diesen Anbieter gesendet.')
            )
          );
        if (act?.execution === 'browser') {
          panel.append(el('label', {}, t('JavaScript \xB7 inputs = verbundene Datenknoten')));
          const code = el('textarea', {
            rows: 12,
            spellcheck: false
          });
          code.value = node.data.params?.code || transformExample;
          code.addEventListener('input', () => {
            node.data.params = {
              ...node.data.params,
              code: code.value
            };
            change(node.id);
          });
          panel.append(code);
        }
        const queued = executionState.actorQueue.some(
          (j) => j.pid === workspaceState.project.id && j.id === node.id
        );
        const runButton = button(
          executionState.activeActors.has(node.id)
            ? t('L\xE4uft \u2026')
            : queued
              ? t('In Warteschlange')
              : executionState.queueRunning
                ? t('In die Warteschleife hinzuf\xFCgen')
                : t('Aktor ausf\xFChren'),
          () => run(node),
          'primary'
        );
        buttonContent(
          runButton,
          runButton.textContent,
          executionState.activeActors.has(node.id)
            ? 'spinner'
            : executionState.queueRunning
              ? 'logs'
              : 'play'
        );
        const connected = workspaceState.project.document.nodes.filter(
          (n) =>
            n.type !== 'actor' &&
            workspaceState.project.document.edges.some(
              (e) => e.target === node.id && e.source === n.id
            )
        );
        runButton.disabled =
          executionState.activeActors.has(node.id) ||
          queued ||
          Boolean(act && actorIncompatible(act, connected));
        runButton.classList.toggle('saving', executionState.activeActors.has(node.id));
        panel.insertBefore(runButton, panel.children[2] || null);
      }
      const reportSection = el('section', { class: 'node-report-section' });
      const reportLabel = el('label');
      const checkbox = el('input', {
        type: 'checkbox'
      });
      checkbox.checked = Boolean(node.report);
      checkbox.addEventListener('change', () => {
        node.report = checkbox.checked;
        change();
      });
      reportLabel.append(checkbox, document.createTextNode(t('In Report aufnehmen')));
      reportSection.append(reportLabel);
      panel.append(reportSection);
      const provenance = el('details', {
        class: 'provenance'
      });
      provenance.append(el('summary', {}, t('Quelle / Herkunft')));
      facts(provenance, node.evidence || {});
      panel.append(provenance);
      for (const r of workspaceState.project.document.runs
        .filter((r2) => r2.actor_id === node.id)
        .slice(-5)
        .reverse()) {
        const box = el('div', {
          class: 'run ' + r.status
        });
        box.append(
          el('strong', {}, t(r.status) + ' \xB7 ' + new Date(r.started_at).toLocaleString())
        );
        for (const w of r.warnings || []) box.append(el('p', {}, diagnostic(w)));
        if (r.error) box.append(el('p', {}, diagnostic(r.error)));
        panel.append(box);
      }
      if (workspaceState.project.document.groups.some((g) => g.members.includes(node.id)))
        panel.append(
          iconActionButton(
            t('Aus Gruppe l\xF6sen'),
            () => detachNodes([node.id]),
            'ungroup',
            'wide'
          )
        );
      panel.append(
        iconActionButton(
          t('Knoten l\xF6schen'),
          () => deleteNodes([node.id]),
          'trash',
          'danger-filled wide node-delete'
        )
      );
    }
    function inspectGroup(group) {
      selectionState.selectedGroup = group.id;
      if (!selectionState.selectedGroups.size) selectionState.selectedGroups.add(group.id);
      inspectorAvailability('group:' + group.id);
      for (const element of document.querySelectorAll('.node.selected'))
        if (!selectionState.selected.has(element.dataset.id)) element.classList.remove('selected');
      for (const element of document.querySelectorAll('.group'))
        element.classList.toggle(
          'selected',
          selectionState.selectedGroups.has(element.dataset.group)
        );
      renderPalette();
      const panel = $('inspector');
      panel.replaceChildren();
      panel.append(
        el(
          'span',
          {
            class: 'tag'
          },
          t('GRUPPE')
        ),
        el('h2', {}, groupTitle(group))
      );
      const name = inputField(panel, t('Bezeichnung'), groupTitle(group));
      name.addEventListener('input', () => {
        delete group.label_key;
        group.label = name.value;
        change();
        render();
      });
      panel.append(
        button(t('Umbenennen'), () => {
          group.label = name.value;
          change();
          render();
          inspectGroup(group);
        })
      );
      panel.append(
        button(group.collapsed ? t('Aufklappen') : t('Einklappen'), () => toggleGroup(group))
      );
      panel.append(
        button(t('Gruppe in Report aufnehmen'), () => {
          const ids = groupNodeIds(group);
          for (const n of workspaceState.project.document.nodes) if (ids.has(n.id)) n.report = true;
          change();
          toast(t('Mitglieder f\xFCr Report markiert.'));
        })
      );
      const parent = workspaceState.project.document.groups.find((g) => g.id === group.parent_id);
      if (parent)
        panel.append(
          button(
            t('\xDCbergeordnete Gruppe') + ': ' + parent.label,
            () => {
              selectionState.selectedGroups = /* @__PURE__ */ new Set([parent.id]);
              selectionState.selected.clear();
              inspectGroup(parent);
            },
            'wide'
          )
        );
      const children = workspaceState.project.document.groups.filter(
        (g) => g.parent_id === group.id
      );
      if (children.length) panel.append(el('h3', {}, t('Untergruppen')));
      for (const child of children)
        panel.append(
          button(
            child.label,
            () => {
              group.collapsed = false;
              canvasState.groupBoundsCache = null;
              makeRoomForGroup(group);
              selectionState.selectedGroups = /* @__PURE__ */ new Set([child.id]);
              selectionState.selected.clear();
              change();
              render();
              inspectGroup(child);
            },
            'wide'
          )
        );
      for (const id of groupNodeIds(group)) {
        const n = workspaceState.project.document.nodes.find((n2) => n2.id === id);
        if (n)
          panel.append(
            button(
              dataLabel(n.type) + ' \xB7 ' + n.label,
              () => {
                for (const owner of workspaceState.project.document.groups)
                  if (groupNodeIds(owner).has(id)) owner.collapsed = false;
                selectionState.selected = /* @__PURE__ */ new Set([id]);
                change();
                render();
                inspect();
              },
              'wide'
            )
          );
      }
      panel.append(
        iconActionButton(
          t('Gruppierung aufl\xF6sen'),
          () => dissolveGroup(group),
          'ungroup',
          'wide'
        ),
        button(t('Gruppe l\xF6schen'), () => deleteGroup(group), 'danger-filled')
      );
    }
    function noteInk(color) {
      const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 140 ? '#30271b' : '#f7f7f7';
    }
    function noteControls(panel, node) {
      if (node.type === 'note')
        panel.append(el('p', {}, t('Notiz direkt auf der Arbeitsfl\xE4che bearbeiten.')));
      for (const [key, label, min, max] of [
        ['width', 'Breite', 200, 900],
        ['height', 'H\xF6he', 120, 800]
      ]) {
        const input = inputField(
          panel,
          t(label),
          node.appearance?.[key] || (key === 'width' ? 320 : 180)
        );
        input.type = 'number';
        input.min = min;
        input.max = max;
        input.addEventListener('input', () => {
          if (input.value === '') return;
          node.appearance = {
            ...node.appearance,
            [key]: Math.max(min, Math.min(max, Number(input.value)))
          };
          change(node.id);
          render();
        });
      }
      const color = inputField(panel, t('Farbe'), node.appearance?.color || '#ffcc70');
      color.maxLength = 7;
      color.addEventListener('input', () => {
        if (!/^#[0-9a-f]{6}$/i.test(color.value)) return;
        node.appearance = {
          ...node.appearance,
          color: color.value
        };
        change(node.id);
        render();
      });
      const swatches = el('div', {
        class: 'note-swatches'
      });
      for (const hex of ['#ffcc70', '#f3a2a2', '#a8dfc3', '#a9d5f5', '#d6b4ef']) {
        const b = button(
          '',
          () => {
            node.appearance = {
              ...node.appearance,
              color: hex
            };
            color.value = hex;
            change(node.id);
            render();
          },
          'note-swatch'
        );
        b.style.backgroundColor = hex;
        b.setAttribute('aria-label', t('Farbe') + ' ' + hex);
        swatches.append(b);
      }
      panel.append(swatches);
    }
    return { inspect, inspectGroup, noteInk, noteControls };
  }
};
export { inspector_default };
export default inspector_default;

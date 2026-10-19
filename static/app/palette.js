import { t } from '../i18n.js';
import { language } from '../i18n.js';
import { buttonContent } from '../icons.js';
import { nodeLabels } from './labels.js';
var palette_default = {
  name: 'palette',
  dependencies: [
    '$',
    'actorIcon',
    'addActor',
    'addData',
    'button',
    'dataIcon',
    'dataLabel',
    'dropFiles',
    'el',
    'pluginText',
    'providerSearchKey',
    'render',
    'searchText',
    'selectedData',
    'toast',
    'updateDeleteButtons'
  ],
  create({
    libraryState,
    workspaceState,
    pluginsState,
    persistenceState,
    selectionState,
    canvasState,
    $,
    actorIcon,
    addActor,
    addData,
    button,
    dataIcon,
    dataLabel,
    dropFiles,
    el,
    pluginText,
    providerSearchKey,
    render,
    searchText,
    selectedData,
    toast,
    updateDeleteButtons
  }) {
    function dataCategory(type) {
      return (
        {
          email: 'Kennungen',
          username: 'Kennungen',
          phone: 'Kennungen',
          url: 'Kennungen',
          location: 'Orte und Zeit',
          datetime: 'Orte und Zeit',
          image: 'Medien',
          file: 'Medien',
          note: 'Eigene Angaben',
          value: 'Eigene Angaben'
        }[type] || 'Weitere'
      );
    }
    function actionCategory(plugin, action) {
      return (
        action.category ||
        plugin.category ||
        {
          location: 'Orte und Zeit',
          metadata: 'Medien',
          transform: 'Datenbearbeitung'
        }[plugin.id] ||
        'Weitere'
      );
    }
    function paletteEntries(kind, entries) {
      const state = libraryState.paletteState[kind],
        filter = $(kind + 'Category'),
        categories = [...new Set(entries.map((e) => e.category))].sort((a, b) =>
          t(a).localeCompare(t(b), language)
        );
      state.categories = state.categories.filter((c) => categories.includes(c));
      filter.replaceChildren();
      const all = el('label', {
          class: 'checkbox-label'
        }),
        allBox = el('input', {
          type: 'checkbox'
        });
      allBox.checked = !state.categories.length;
      allBox.addEventListener('change', () => {
        state.categories = [];
        renderPalette();
      });
      all.append(allBox, document.createTextNode(t('ui.all_categories')));
      filter.append(all);
      for (const category of categories) {
        const label = el('label', {
            class: 'checkbox-label'
          }),
          box = el('input', {
            type: 'checkbox',
            value: category
          });
        box.checked = state.categories.includes(category);
        box.addEventListener('change', () => {
          state.categories = box.checked
            ? [.../* @__PURE__ */ new Set([...state.categories, category])]
            : state.categories.filter((c) => c !== category);
          renderPalette();
        });
        label.append(box, document.createTextNode(t(category)));
        filter.append(label);
      }
      const query = searchText(state.query);
      return entries
        .filter(
          (e) =>
            (!state.categories.length || state.categories.includes(e.category)) &&
            searchText(e.label + ' ' + e.search + ' ' + t(e.category)).includes(query)
        )
        .sort((a, b) => {
          const byName = a.label.localeCompare(b.label, language);
          return state.sort === 'za'
            ? -byName
            : state.sort === 'category' ||
                state.sort === 'category_az' ||
                state.sort === 'category_za'
              ? (state.sort === 'category_za' ? -1 : 1) *
                  t(a.category).localeCompare(t(b.category), language) || byName
              : byName;
        });
    }
    function renderPalette() {
      if (!workspaceState.project) return;
      const nodes = $('nodePalette'),
        actors = $('actorPalette');
      nodes.replaceChildren();
      actors.replaceChildren();
      const data = Object.keys(workspaceState.templates)
        .filter((type) => pluginsState.dataTypes.get(type)?.installed)
        .map((type) => ({
          type,
          label: dataLabel(type),
          search: type,
          category: pluginsState.dataTypes.get(type)?.node.category || dataCategory(type)
        }));
      for (const entry of paletteEntries('node', data)) {
        const b = button(entry.label, () => addData(entry.type), 'palette-item');
        buttonContent(b, entry.label, dataIcon(entry.type));
        b.dataset.type = entry.type;
        b.disabled = persistenceState.busy;
        b.title = t(entry.category);
        paletteDrag(b, {
          kind: 'node',
          type: entry.type
        });
        nodes.append(b);
      }
      const inputs = selectedData(),
        entries = pluginsState.catalog.flatMap((plugin) =>
          (plugin.actions || []).map((action) => ({
            plugin,
            action,
            label: pluginText(plugin, action.name),
            search:
              plugin.name + ' ' + plugin.id + ' ' + pluginText(plugin, plugin.description || ''),
            category: actionCategory(plugin, action)
          }))
        );
      const sortedActors = paletteEntries('actor', entries);
      if (inputs.length)
        sortedActors.sort(
          (a, b) =>
            Number(actorIncompatible(a.action, inputs)) -
            Number(actorIncompatible(b.action, inputs))
        );
      let lastActorCategory = null;
      for (const { plugin, action, label, category } of sortedActors) {
        if (
          libraryState.paletteState.actor.sort.startsWith('category') &&
          category !== lastActorCategory
        ) {
          actors.append(
            el(
              'div',
              {
                class: 'palette-category-divider'
              },
              t(category)
            )
          );
          lastActorCategory = category;
        }
        const b = button(label, () => addActor(plugin, action), 'palette-item actor-item');
        buttonContent(b, label, actorIcon(plugin.id, action.id));
        b.dataset.plugin = plugin.id;
        b.dataset.action = action.id;
        b.disabled = persistenceState.busy || actorIncompatible(action, inputs, true);
        b.title =
          t(category) +
          ' \xB7 ' +
          t('ui.input_d88e602d') +
          action.inputs.map((x) => (nodeLabels[x] ? t(nodeLabels[x]) : x)).join(', ');
        paletteDrag(b, {
          kind: 'actor',
          plugin: plugin.id,
          action: action.id
        });
        actors.append(b);
      }
      for (const list of [nodes, actors])
        if (!list.children.length)
          list.append(
            el(
              'p',
              {
                class: 'palette-empty'
              },
              t('ui.no_matching_entries')
            )
          );
      const key = inputs
        .map((n) => n.id)
        .sort()
        .join(',');
      if (key !== selectionState.lastPaletteSelection) {
        selectionState.lastPaletteSelection = key;
        if (inputs.length) actors.scrollTop = 0;
      }
      updateDeleteButtons();
    }
    function setupPaletteControls() {
      for (const kind of ['node', 'actor']) {
        const sort = $(kind + 'Sort');
        sort.replaceChildren(
          ...[
            ['category_az', 'Kategorie A\u2013Z'],
            ['category_za', 'Kategorie Z\u2013A'],
            ['az', 'A\u2013Z'],
            ['za', 'Z\u2013A']
          ].map(([value, label]) =>
            el(
              'option',
              {
                value,
                'data-i18n': label
              },
              t(label)
            )
          )
        );
        sort.value = libraryState.paletteState[kind].sort;
        const search = $(kind + 'Search');
        search.addEventListener('input', () => {
          libraryState.paletteState[kind].query = search.value;
          renderPalette();
        });
        $(kind + 'SearchToggle').addEventListener('click', () => {
          const row = $(kind + 'SearchRow');
          row.hidden = !row.hidden;
          $(kind + 'SearchToggle').setAttribute('aria-expanded', String(!row.hidden));
          if (!row.hidden) search.focus();
        });
        for (const mode of ['Filter', 'Sort'])
          $(kind + mode + 'Toggle').addEventListener('click', () => {
            const row = $(kind + mode + 'Row');
            row.hidden = !row.hidden;
            $(kind + mode + 'Toggle').setAttribute('aria-expanded', String(!row.hidden));
          });
        $(kind + 'Sort').addEventListener('change', (e) => {
          libraryState.paletteState[kind].sort = e.target.value;
          renderPalette();
        });
      }
    }
    function paletteDrag(button2, payload) {
      touchPaletteDrag(button2, payload);
      button2.draggable = true;
      button2.addEventListener('dragstart', (event) => {
        if (persistenceState.busy) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('application/x-argus-palette', JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'copy';
      });
    }
    async function dropPalette(event) {
      if (event.dataTransfer?.files?.length) {
        try {
          await dropFiles(event);
        } catch (error) {
          toast(error.message);
        }
        return;
      }
      event.preventDefault();
      for (const element of document.querySelectorAll('.drop-target'))
        element.classList.remove('drop-target');
      try {
        const payload = JSON.parse(event.dataTransfer.getData('application/x-argus-palette'));
        const box = $('graph').getBoundingClientRect(),
          x = (event.clientX - box.left - canvasState.pan.x) / canvasState.pan.scale,
          y = (event.clientY - box.top - canvasState.pan.y) / canvasState.pan.scale;
        if (payload.kind === 'node' && workspaceState.templates[payload.type])
          addData(payload.type, x, y);
        else if (payload.kind === 'actor') {
          const plugin = pluginsState.catalog.find((p) => p.id === payload.plugin),
            action = plugin?.actions.find((a) => a.id === payload.action);
          if (!action) throw Error(t('ui.tool_unavailable'));
          const targetId = event.target.closest('.node')?.dataset.id,
            target = workspaceState.project.document.nodes.find((n) => n.id === targetId);
          if (target?.type === 'actor') throw Error(t('ui.tools_require_a_data_node_as_input'));
          const selected = selectedData();
          const inputs = target
            ? selected.some((node) => node.id === target.id)
              ? selected.filter((node) => actionAcceptsNode(action, node))
              : [target]
            : [];
          const actor = addActor(plugin, action, inputs);
          if (!target) {
            actor.x = x;
            actor.y = y;
            render();
          }
        }
      } catch (error) {
        toast(error.message);
      }
    }
    function touchPaletteDrag(button2, payload) {
      let state = null,
        ghost = null;
      button2.style.touchAction = 'none';
      button2.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' || button2.disabled) return;
        state = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          at: Date.now(),
          moved: false,
          scroll: false,
          scrollTop: button2.closest('.palette-list')?.scrollTop || 0
        };
        button2.setPointerCapture(e.pointerId);
      });
      button2.addEventListener('pointermove', (e) => {
        if (!state || e.pointerId !== state.id) return;
        const dx = e.clientX - state.x,
          dy = e.clientY - state.y;
        if (Math.hypot(dx, dy) < 8 && !state.moved && !state.scroll) return;
        e.preventDefault();
        if (
          state.scroll ||
          (!state.moved && Date.now() - state.at < 220 && Math.abs(dy) > Math.abs(dx) * 1.3)
        ) {
          state.scroll = true;
          const list = button2.closest('.palette-list');
          if (list) list.scrollTop = state.scrollTop - dy;
          return;
        }
        state.moved = true;
        if (!ghost) {
          ghost = el(
            'div',
            {
              class: 'palette-ghost'
            },
            button2.textContent
          );
          document.body.append(ghost);
        }
        ghost.style.left = e.clientX + 12 + 'px';
        ghost.style.top = e.clientY + 12 + 'px';
      });
      const end = (e) => {
        if (!state) return;
        const moved = state.moved,
          scrolled = state.scroll;
        state = null;
        ghost?.remove();
        ghost = null;
        if (scrolled) {
          button2.dataset.suppressClick = '1';
          setTimeout(() => delete button2.dataset.suppressClick, 400);
          return;
        }
        if (!moved || e.type === 'pointercancel') return;
        e.preventDefault();
        button2.dataset.suppressClick = '1';
        setTimeout(() => delete button2.dataset.suppressClick, 400);
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target?.closest('#graph'))
          dropPalette({
            preventDefault() {},
            clientX: e.clientX,
            clientY: e.clientY,
            target,
            dataTransfer: {
              getData() {
                return JSON.stringify(payload);
              }
            }
          });
      };
      button2.addEventListener('pointerup', end);
      button2.addEventListener('pointercancel', end);
      button2.addEventListener(
        'click',
        (e) => {
          if (button2.dataset.suppressClick) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        },
        true
      );
    }
    function actionAcceptsNode(action, node) {
      if (!action.inputs.includes('*') && !action.inputs.includes(node.type)) return false;
      if (node.type !== 'profile') return true;
      const record = pluginsState.providerIndex.get(providerSearchKey(node.data.provider)),
        provider = record?.id || node.data.provider;
      if (action.providers && !action.providers.includes(provider)) return false;
      if (
        action.generic_profile &&
        pluginsState.catalog.some((p) =>
          (p.actions || []).some((a) => a.providers?.includes(provider))
        )
      )
        return false;
      return true;
    }
    function actorIncompatible(action, inputs, allowPartial = false) {
      if (
        action.max_inputs &&
        inputs.filter((n) => actionAcceptsNode(action, n)).length > action.max_inputs
      )
        return true;
      if (action.input_roles) {
        const remaining = [...action.input_roles]
          .sort((a, b) => a.length - b.length)
          .map((role) => [...role]);
        for (const node of [...inputs].sort(
          (a, b) =>
            remaining.filter((role) => role.includes(a.type)).length -
            remaining.filter((role) => role.includes(b.type)).length
        )) {
          const slot = remaining.findIndex((role) => role.includes(node.type));
          if (slot < 0) return true;
          remaining.splice(slot, 1);
        }
        if (!allowPartial && remaining.length) return true;
      }
      if (action.same_type && inputs.length && new Set(inputs.map((n) => n.type)).size > 1)
        return true;
      if (
        !allowPartial &&
        action.min_inputs &&
        inputs.length > 0 &&
        inputs.length < action.min_inputs
      )
        return true;
      return selectionState.selectedGroup
        ? inputs.length > 0 && !inputs.some((n) => actionAcceptsNode(action, n))
        : inputs.some((n) => !actionAcceptsNode(action, n));
    }
    return {
      dataCategory,
      actionCategory,
      paletteEntries,
      renderPalette,
      setupPaletteControls,
      paletteDrag,
      dropPalette,
      touchPaletteDrag,
      actionAcceptsNode,
      actorIncompatible
    };
  }
};
export { palette_default };
export default palette_default;

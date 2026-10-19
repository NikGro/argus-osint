import React, { useRef, useState } from 'react';
import { Button, Icon } from './controls.jsx';
import { Field } from './fields.jsx';
import { Select } from './select.jsx';
import { t } from '../../i18n.js';

export function SortList({
  items,
  onChange,
  renderItem,
  label,
  remove = true,
  renderDetails,
  numbered = false,
  moveButtons = false
}) {
  const dragged = useRef(null);
  const list = useRef(null);
  const [preview, setPreview] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  function dragOver(event) {
    if (!dragged.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const drag = dragged.current;
    const y = event.clientY - list.current.getBoundingClientRect().top;
    let to = drag.from;
    if (y < drag.rows[drag.from].top + drag.rows[drag.from].height / 2) {
      for (let i = 0; i < drag.from; i++) {
        if (y < drag.rows[i].top + drag.rows[i].height / 2 + 2) {
          to = i;
          break;
        }
      }
    } else {
      for (let i = drag.from + 1; i < drag.rows.length; i++)
        if (y >= drag.rows[i].top + drag.rows[i].height / 2 - 2) to = i;
    }
    drag.to = to;
    setPreview({ ...drag });
  }
  function rowStyle(index) {
    if (!preview) return undefined;
    const { from, to, rows, distance } = preview;
    let y = 0;
    if (index === from)
      y =
        from < to
          ? rows[to].top + rows[to].height - rows[from].height - rows[from].top
          : rows[to].top - rows[from].top;
    else if (from < to && index > from && index <= to) y = -distance;
    else if (from > to && index >= to && index < from) y = distance;
    return {
      transform: `translateY(${y}px)`,
      transition: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'none'
        : 'transform 160ms ease',
      opacity: index === from ? 0.25 : 1
    };
  }
  function move(from, to) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const copy = [...items];
    copy.splice(to, 0, copy.splice(from, 1)[0]);
    onChange(copy);
  }
  return (
    <div
      ref={list}
      className="source-order"
      aria-label={label}
      onDragOver={dragOver}
      onDrop={(event) => {
        if (!dragged.current) return;
        event.preventDefault();
        event.stopPropagation();
        move(dragged.current.from, dragged.current.to);
        dragged.current = null;
        setPreview(null);
      }}
    >
      {items.map((item, index) => {
        const id = item.key || item.id || index,
          open = expanded.has(id);
        return (
          <div className="source-tile" data-sort-id={id} key={id} style={rowStyle(index)}>
            <div className="source-row">
              {renderDetails && (
                <Button
                  only
                  className="source-expand borderless"
                  icon={open ? 'chevron-down' : 'chevron-right'}
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      open ? next.delete(id) : next.add(id);
                      return next;
                    })
                  }
                >
                  {t('ui.expand_settings')}
                </Button>
              )}
              <span
                className="source-handle"
                role="button"
                tabIndex={0}
                draggable
                aria-label={t('ui.move_source')}
                onDragStart={(event) => {
                  const boxTop = list.current.getBoundingClientRect().top;
                  const rows = [...list.current.children].map((row) => {
                    const box = row.getBoundingClientRect();
                    return { top: box.top - boxTop, height: box.height };
                  });
                  const gap =
                    rows.length > 1 ? Math.max(0, rows[1].top - rows[0].top - rows[0].height) : 0;
                  dragged.current = {
                    from: index,
                    to: index,
                    rows,
                    distance: rows[index].height + gap
                  };
                  setPreview({ ...dragged.current });
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(index));
                  const row = event.currentTarget.closest('.source-tile');
                  const box = row.getBoundingClientRect();
                  event.dataTransfer.setDragImage(
                    row,
                    event.clientX - box.left,
                    event.clientY - box.top
                  );
                }}
                onDragEnd={() => {
                  dragged.current = null;
                  setPreview(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                  }
                }}
              >
                <Icon name="drag" />
              </span>
              {numbered && <span className="source-number">{index + 1}</span>}
              <div className="source-order-content">{renderItem(item, index)}</div>
              {remove && (
                <Button
                  icon="trash"
                  only
                  className="danger-filled"
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                >
                  {t('ui.remove')}
                </Button>
              )}
              {moveButtons && (
                <>
                  <Button
                    icon="chevron-up"
                    only
                    className="source-move borderless"
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    {t('ui.move_up')}
                  </Button>
                  <Button
                    icon="chevron-down"
                    only
                    className="source-move borderless"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    {t('ui.move_down')}
                  </Button>
                </>
              )}
            </div>
            {renderDetails && open && (
              <div className="source-settings">{renderDetails(item, index)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SearchProfiles({ catalog, value = [], onChange }) {
  const [query, setQuery] = useState('');
  const entries = Array.isArray(catalog)
    ? catalog
    : Object.entries(catalog || {}).map(([id, item]) =>
        typeof item === 'string' ? { id, label: item } : { id, ...item }
      );
  const available = [
    ...entries.filter((item) => item.id !== 'custom'),
    { id: 'custom', label: t('ui.custom_websites') }
  ]
    .filter((item) => !value.some((selected) => selected.id === item.id && item.id !== 'custom'))
    .filter((item) =>
      String(item.label || item.name || item.id)
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  return (
    <div className="research-profiles">
      <Select
        label={t('ui.add_search_profile')}
        value=""
        placeholder={t('ui.add_search_profile_a2a8ee86')}
        options={available.map((item) => ({
          value: item.id,
          label: t(item.label || item.name || item.id)
        }))}
        onChange={(id) => {
          if (id)
            onChange([
              ...value,
              {
                id,
                ...(id === 'custom' ? { sites: [] } : {}),
                key: Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
                  byte.toString(16).padStart(2, '0')
                ).join('')
              }
            ]);
          setQuery('');
        }}
      />
      <SortList
        items={value}
        label={t('ui.search_profiles_9375fc35')}
        onChange={onChange}
        renderItem={(item, index) => (
          <>
            <span>
              {t(
                entries.find((entry) => entry.id === item.id)?.label ||
                  entries.find((entry) => entry.id === item.id)?.name ||
                  (item.id === 'custom' ? 'Eigene Websites' : item.id)
              )}
            </span>
            {item.id === 'custom' && (
              <Field
                label={t('ui.websites')}
                value={item.sites || []}
                onChange={(sites) =>
                  onChange(value.map((row, i) => (i === index ? { ...row, sites } : row)))
                }
              />
            )}
          </>
        )}
      />
      {!value.length && (
        <p className="source-help">{t('ui.without_search_profiles_all_websites_are_searched')}</p>
      )}
    </div>
  );
}

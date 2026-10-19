import React, { useId, useRef, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './controls.jsx';
import { t } from '../../i18n.js';

export function Select({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder,
  displayValue
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240 });
  const anchor = useRef(null),
    popup = useRef(null),
    search = useRef(null);
  const listId = useId();
  const matches = useMemo(
    () =>
      open
        ? options.filter((item) => String(item.label).toLowerCase().includes(query.toLowerCase()))
        : [],
    [open, options, query]
  );
  const filtered = matches.slice(0, 100);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const dismiss = (event) => {
      if (!anchor.current?.contains(event.target) && !popup.current?.contains(event.target))
        setOpen(false);
    };
    const close = (event) => {
      if (!popup.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);
  function choose(item) {
    onChange(item.value);
    setOpen(false);
    anchor.current?.focus();
  }
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const box = anchor.current.getBoundingClientRect();
    const height = Math.min(320, Math.max(180, innerHeight - box.bottom - 16));
    setPosition({
      left: Math.min(box.left, innerWidth - Math.max(240, box.width) - 12),
      top: box.bottom + height > innerHeight ? Math.max(12, box.top - height) : box.bottom + 6,
      width: Math.max(240, box.width)
    });
    setQuery('');
    setActive(0);
    setOpen(true);
  }
  return (
    <>
      <button
        id={id}
        ref={anchor}
        type="button"
        className="react-select"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={toggle}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            if (!open) toggle();
          }
        }}
      >
        <span>
          {displayValue ??
            (options.find((item) => String(item.value) === String(value))?.label ||
              placeholder ||
              label)}
        </span>
        <Icon name="chevron-down" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            className="react-select-popup"
            style={{ left: position.left, top: position.top, width: position.width }}
          >
            <input
              ref={search}
              type="search"
              role="searchbox"
              aria-label={t('ui.search_51942c20')}
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? listId + '-' + active : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  anchor.current.focus();
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive(
                    Math.max(
                      0,
                      Math.min(filtered.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))
                    )
                  );
                }
                if (event.key === 'Enter' && filtered[active]) {
                  event.preventDefault();
                  choose(filtered[active]);
                }
              }}
            />
            {matches.length > 100 && (
              <small className="select-limit">
                {t('ui.use_search_to_narrow_down_more_entries')} ({matches.length})
              </small>
            )}
            <div role="listbox" id={listId}>
              {filtered.map((item, index) => (
                <button
                  key={String(item.value)}
                  id={listId + '-' + index}
                  type="button"
                  role="option"
                  aria-selected={String(item.value) === String(value)}
                  className={active === index ? 'focused' : ''}
                  onClick={() => choose(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>,
          anchor.current?.closest('dialog') || document.body
        )}
    </>
  );
}

/** Schema-driven inputs shared by tool details, plugin defaults and dialogs. */

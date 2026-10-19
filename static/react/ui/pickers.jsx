import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './controls.jsx';
import { language, t } from '../../i18n.js';

/** Themeable popover shared by calendar, time and color controls. */
function PickerPopover({ anchor, label, onClose, children }) {
  const popup = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    const box = anchor.current.getBoundingClientRect();
    const panel = popup.current.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(box.left, innerWidth - panel.width - 12)),
      top:
        box.bottom + panel.height + 6 < innerHeight
          ? box.bottom + 6
          : Math.max(12, box.top - panel.height - 6)
    });
    popup.current.querySelector('button,input')?.focus();
  }, [anchor]);
  useEffect(() => {
    const dismiss = (event) => {
      if (!popup.current?.contains(event.target) && !anchor.current?.contains(event.target))
        close.current();
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        anchor.current.querySelector('input,button')?.focus();
      }
    };
    const reposition = (event) => {
      if (!popup.current?.contains(event.target)) close.current();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [anchor]);
  return createPortal(
    <div ref={popup} className="picker-popover" style={position} role="dialog" aria-label={label}>
      {children}
    </div>,
    anchor.current?.closest('dialog') || document.body
  );
}

const pad = (number) => String(number).padStart(2, '0');
const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function DateTimeInput({ type, label, value, onChange, ...inputProps }) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());
  const choose = (next) => {
    onChange({ target: { value: next } });
  };
  function toggle() {
    if (!open && type === 'date') {
      const selected = /^\d{4}-\d{2}-\d{2}$/.test(value || '')
        ? new Date(value + 'T12:00:00')
        : new Date();
      setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    }
    setOpen(!open);
  }
  const selectedTime = String(value || '00:00').split(':');
  const year = month.getFullYear(),
    index = month.getMonth();
  const start = (new Date(year, index, 1).getDay() + 6) % 7;
  const days = new Date(year, index + 1, 0).getDate();
  return (
    <div className="picker-input" ref={anchor}>
      <input {...inputProps} type={type} value={value} onChange={onChange} />
      <Button
        only
        className="borderless"
        icon={type === 'date' ? 'calendar' : 'clock'}
        disabled={inputProps.disabled}
        aria-expanded={open}
        onClick={toggle}
      >
        {label}
      </Button>
      {open && (
        <PickerPopover anchor={anchor} label={label} onClose={() => setOpen(false)}>
          {type === 'date' ? (
            <>
              <div className="calendar-heading">
                <Button
                  only
                  className="borderless"
                  icon="chevron-left"
                  onClick={() => setMonth(new Date(year, index - 1, 1))}
                >
                  {t('ui.previous_month')}
                </Button>
                <strong>
                  {new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(
                    month
                  )}
                </strong>
                <Button
                  only
                  className="borderless"
                  icon="chevron-right"
                  onClick={() => setMonth(new Date(year, index + 1, 1))}
                >
                  {t('ui.next_month')}
                </Button>
              </div>
              <div className="calendar-days">
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={'weekday' + i}>
                    {new Intl.DateTimeFormat(language, { weekday: 'narrow' }).format(
                      new Date(2026, 0, 5 + i)
                    )}
                  </span>
                ))}
                {Array.from({ length: start }, (_, i) => (
                  <span key={'blank' + i} />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const day = isoDay(new Date(year, index, i + 1));
                  return (
                    <button
                      type="button"
                      key={day}
                      className={day === value ? 'active' : ''}
                      aria-label={day}
                      aria-pressed={day === value}
                      onClick={() => {
                        choose(day);
                        setOpen(false);
                        anchor.current.querySelector('input').focus();
                      }}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <Button
                className="borderless wide"
                onClick={() => {
                  choose(isoDay(new Date()));
                  setOpen(false);
                }}
              >
                {t('ui.today')}
              </Button>
            </>
          ) : (
            <div className="time-columns">
              {[
                [24, t('ui.hours')],
                [60, t('ui.minutes')]
              ].map(([count, title], part) => (
                <div key={part}>
                  <strong>{title}</strong>
                  <div role="listbox" aria-label={title}>
                    {Array.from({ length: count }, (_, i) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={Number(selectedTime[part]) === i}
                        key={i}
                        onClick={() => {
                          const next = [
                            pad(Number(selectedTime[0]) || 0),
                            pad(Number(selectedTime[1]) || 0),
                            ...(selectedTime[2] ? [selectedTime[2]] : [])
                          ];
                          next[part] = pad(i);
                          choose(next.join(':'));
                          if (part === 1) {
                            setOpen(false);
                            anchor.current.querySelector('input').focus();
                          }
                        }}
                      >
                        {pad(i)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PickerPopover>
      )}
    </div>
  );
}

function fromHex(hex) {
  const [r, g, b] = (hex.match(/[0-9a-f]{2}/gi) || ['ff', 'cc', '70']).map(
    (x) => parseInt(x, 16) / 255
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
function toHex([h, s, l]) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  const parts =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    '#' +
    parts
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}
function ColorChooser({ value, onChange }) {
  const [hsl, setHsl] = useState(() => fromHex(value));
  return (
    <>
      <div className="color-sample" style={{ background: toHex(hsl) }} />
      <div className="color-presets">
        {[
          '#ff9d45',
          '#4dbdff',
          '#53e58b',
          '#e66a78',
          '#b38aff',
          '#ffffff',
          '#8799b2',
          '#121c29'
        ].map((color) => (
          <button
            type="button"
            key={color}
            style={{ background: color }}
            aria-label={color}
            onClick={() => {
              setHsl(fromHex(color));
              onChange(color);
            }}
          />
        ))}
      </div>
      {[t('ui.hue'), t('ui.saturation'), t('ui.lightness')].map((name, i) => (
        <label className="color-slider" key={i}>
          {name}
          <input
            type="range"
            min="0"
            max={i === 0 ? 359 : 100}
            value={hsl[i]}
            onChange={(e) => {
              const next = [...hsl];
              next[i] = Number(e.target.value);
              setHsl(next);
              onChange(toHex(next));
            }}
          />
        </label>
      ))}
    </>
  );
}

export function ColorSwatch({ id, label, value, onChange, compact = false }) {
  const anchor = useRef(null),
    [open, setOpen] = useState(false);
  return (
    <span ref={anchor} className={'color-swatch-anchor' + (compact ? ' compact' : '')}>
      <button
        id={id}
        type="button"
        className="color-swatch"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span style={{ background: value }} />
      </button>
      {open && (
        <PickerPopover anchor={anchor} label={label} onClose={() => setOpen(false)}>
          <ColorChooser value={value} onChange={onChange} />
        </PickerPopover>
      )}
    </span>
  );
}

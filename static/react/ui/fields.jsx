import React, { useId, useRef, useState, useEffect } from 'react';
import { Button, Check } from './controls.jsx';
import { Select } from './select.jsx';
import { DateTimeInput, ColorSwatch } from './pickers.jsx';
import { t } from '../../i18n.js';

export function Field({
  label,
  value,
  onChange,
  schema = {},
  secret = false,
  multiline = false,
  help,
  disabled,
  fieldKey
}) {
  const id = useId();
  const [raw, setRaw] = useState(null);
  const editing = useRef(false);
  const [invalid, setInvalid] = useState(false);
  const valid = (text) =>
    schema.type !== 'email' || !text || /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(text);
  useEffect(() => {
    if (!editing.current) setRaw(null);
  }, [value]);
  if (typeof value === 'boolean')
    return (
      <Check checked={value} onChange={onChange} disabled={disabled}>
        {label}
      </Check>
    );
  const object = value !== null && typeof value === 'object';
  const array = Array.isArray(value);
  const numeric = typeof value === 'number';
  const display =
    raw ??
    (object
      ? array && value.every((item) => typeof item === 'string')
        ? value.join('\n')
        : JSON.stringify(value, null, 2)
      : (value ?? ''));
  const shared = {
    id,
    'data-field': fieldKey,
    disabled,
    onFocus: () => {
      editing.current = true;
      if (secret && /^[*•●]+$/.test(String(value || ''))) setRaw('');
    },
    onBlur: () => {
      editing.current = false;
      if (!valid(String(display))) setInvalid(true);
      else {
        setInvalid(false);
        setRaw(null);
      }
    },
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? id + '-error' : undefined,
    value: display,
    onChange(event) {
      const text = event.target.value;
      setRaw(text);
      if (!valid(text)) return;
      setInvalid(false);
      if (numeric) {
        setRaw(text);
        if (text !== '' && Number.isFinite(Number(text)) && event.target.validity.valid)
          onChange(Number(text));
      } else if (object) {
        setRaw(text);
        if (array && value.every((item) => typeof item === 'string'))
          onChange(
            text
              .split(/[\n,]/)
              .map((item) => item.trim())
              .filter(Boolean)
          );
        else {
          try {
            onChange(JSON.parse(text));
          } catch {
            /* Retain the draft until valid JSON is entered. */
          }
        }
      } else onChange(text);
    }
  };
  return (
    <div className="react-field">
      <label htmlFor={id}>{label}</label>
      {['date', 'time'].includes(schema.type) ? (
        <DateTimeInput {...shared} type={schema.type} label={label} />
      ) : schema.enum ? (
        <Select
          id={id}
          label={label}
          value={value}
          disabled={disabled}
          options={schema.enum.map((item) => ({
            value: item,
            label: schema.labels?.[item] || t(String(item))
          }))}
          onChange={onChange}
        />
      ) : object || multiline ? (
        <textarea {...shared} rows={object ? 4 : 3} spellCheck={false} />
      ) : numeric && schema.control === 'range' ? (
        <div className="range-field">
          <input
            {...shared}
            type="range"
            min={schema.min}
            max={schema.max}
            step={schema.step || 1}
          />
          <input
            {...shared}
            type="number"
            min={schema.min}
            max={schema.max}
            step={schema.step || 1}
          />
        </div>
      ) : numeric ? (
        <div className="number-field">
          <input
            {...shared}
            type="number"
            min={schema.min}
            max={schema.max}
            step={schema.step || 'any'}
          />
          <span className="number-step-controls">
            {[1, -1].map((direction) => (
              <Button
                key={direction}
                icon={direction === 1 ? 'chevron-up' : 'chevron-down'}
                only
                disabled={
                  disabled ||
                  (direction === 1 && value >= schema.max) ||
                  (direction === -1 && value <= schema.min)
                }
                onClick={() => {
                  const step = Number(schema.step) || 1;
                  const next = Math.max(
                    schema.min ?? -Infinity,
                    Math.min(schema.max ?? Infinity, Number((value + direction * step).toFixed(8)))
                  );
                  setRaw(null);
                  onChange(next);
                }}
              >
                {t(direction === 1 ? 'Zahl erhöhen' : 'Zahl verringern')}
              </Button>
            ))}
          </span>
        </div>
      ) : (
        <input
          {...shared}
          type={secret ? 'password' : schema.type || 'text'}
          autoComplete={secret ? 'new-password' : 'off'}
          maxLength={schema.maxLength}
          required={schema.required}
        />
      )}
      {invalid && (
        <p id={id + '-error'} className="field-error" role="alert">
          {t('Bitte eine gültige E-Mail-Adresse eingeben.')}
        </p>
      )}
      {help && <p className="source-help">{help}</p>}
    </div>
  );
}

export function Fields({
  values,
  onChange,
  schema = {},
  label = (key) => t(key),
  exclude = [],
  help = {},
  sections = [],
  translate = t
}) {
  const grouped = new Set(
    sections.flatMap((section) => [section.toggle, ...(section.limits || [])])
  );
  const ordinary = Object.entries(values || {}).filter(([key]) => !grouped.has(key));
  return (
    <>
      {sections
        .filter((section) => section.toggle in (values || {}) && !exclude.includes(section.toggle))
        .map((section) => (
          <section className="parameter-section" key={section.toggle}>
            <Check
              checked={values[section.toggle]}
              onChange={(value) => onChange(section.toggle, value)}
            >
              {translate(section.label || section.key)}
            </Check>
            {(section.limits || []).some((key) => key in values && !exclude.includes(key)) && (
              <div className="parameter-limits">
                {(section.limits || [])
                  .filter((key) => key in values && !exclude.includes(key))
                  .map((key) => (
                    <Field
                      key={key}
                      label={label(key)}
                      value={values[key]}
                      schema={schema[key]}
                      disabled={!values[section.toggle]}
                      onChange={(value) => onChange(key, value)}
                    />
                  ))}
              </div>
            )}
          </section>
        ))}
      <div className="fields-stack">
        {ordinary
          .filter(([key]) => !exclude.includes(key))
          .map(([key, value]) => (
            <Field
              key={key}
              fieldKey={key}
              label={label(key)}
              value={value}
              schema={schema[key]}
              help={help[key] && translate(help[key])}
              secret={schema[key]?.secret || /password|token|secret|api_key|sessionid/.test(key)}
              onChange={(next) => onChange(key, next)}
            />
          ))}
      </div>
    </>
  );
}

export function Facts({ value }) {
  if (!value || typeof value !== 'object') return <span>{String(value ?? '')}</span>;
  return (
    <dl className="facts">
      {Object.entries(value)
        .filter(([, item]) => item !== null && item !== '')
        .map(([key, item]) => (
          <React.Fragment key={key}>
            <dt>{t(key)}</dt>
            <dd>
              {typeof item === 'object' ? (
                <details>
                  <summary>
                    {Array.isArray(item) ? item.length + t(' Einträge') : t('Details anzeigen')}
                  </summary>
                  <Facts value={item} />
                </details>
              ) : (
                String(item)
              )}
            </dd>
          </React.Fragment>
        ))}
    </dl>
  );
}

export function ColorField({ label, value, onChange }) {
  const id = useId();
  return (
    <div className="react-field">
      <label htmlFor={id}>{label}</label>
      <div className="color-field">
        <ColorSwatch id={id} label={label} value={value} onChange={onChange} />
        <Field
          label={label + ' · HEX'}
          value={value}
          onChange={(color) => {
            if (/^#[0-9a-f]{6}$/i.test(color)) onChange(color);
          }}
        />
      </div>
    </div>
  );
}

/** Shared section boundary: each section owns its leading divider. */

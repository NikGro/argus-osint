import React from 'react';
import { ICON_PATHS } from '../../icons.js';
import { t } from '../../i18n.js';

export function Icon({ name, ...props }) {
  return (
    <svg
      className={'ui-icon' + (name === 'spinner' ? ' spinner' : '')}
      viewBox={name === 'check' ? '3.5 5.5 18 14' : '0 0 24 24'}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {(ICON_PATHS[name === 'spinner' ? 'refresh' : name] || ICON_PATHS.nodes).map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

export function Button({ children, icon, only, className = '', onClick, app, ...props }) {
  return (
    <button
      type="button"
      className={`${className} ${only ? 'icon-only' : ''}`}
      aria-label={only ? String(children) : undefined}
      title={only ? String(children) : undefined}
      onClick={app && onClick ? (event) => app.safely(() => onClick(event)) : onClick}
      {...props}
    >
      {icon && <Icon name={icon} />}{' '}
      {!only && children && <span className="button-label">{children}</span>}
    </button>
  );
}

export function Check({ children, checked, onChange, ...props }) {
  return (
    <label className="checkbox-label">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        {...props}
      />
      {children}
    </label>
  );
}

export function SaveState({ pending, saving, error }) {
  return (
    <span
      className="save-indicator"
      role="status"
      data-state={error ? 'error' : saving ? 'saving' : pending ? 'pending' : 'saved'}
    >
      <Icon name={saving ? 'spinner' : error ? 'logs' : pending ? 'save' : 'check'} />
      {t(
        error
          ? 'Speichern fehlgeschlagen'
          : saving
            ? 'Speichert …'
            : pending
              ? 'Noch zu speichern'
              : 'Gespeichert'
      )}
    </span>
  );
}

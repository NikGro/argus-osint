import React, { useRef, useState, useEffect } from 'react';
import { Button, Check } from './controls.jsx';
import { Field } from './fields.jsx';
import { t } from '../../i18n.js';

export function Modal({ app }) {
  const request = app.ui.dialog;
  const ref = useRef(null);
  const [values, setValues] = useState({});
  useEffect(() => {
    if (!request) return;
    const initial = { ...request.values };
    for (const field of request.fields || []) {
      initial[field.key] = field.transient
        ? ''
        : (initial[field.key] ??
          field.default ??
          (field.type === 'checkbox' ? false : field.type === 'number' ? 0 : ''));
    }
    setValues(request.mode === 'text' ? { value: request.value || '' } : initial);
    ref.current.showModal();
    return () => ref.current?.close();
  }, [request]);
  if (!request) return null;
  return (
    <dialog
      ref={ref}
      className="manual-dialog"
      onCancel={(event) => {
        event.preventDefault();
        app.settle(null);
      }}
      aria-labelledby="react-dialog-title"
    >
      <h2 id="react-dialog-title">{t(request.title)}</h2>
      {request.message && <p>{t(request.message)}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          app.settle(
            request.mode === 'confirm'
              ? true
              : request.mode === 'text'
                ? values.value
                : {
                    ...values,
                    ...(request.kind === 'merge' ? { _merge_fingerprint: request.fingerprint } : {})
                  }
          );
        }}
      >
        {request.mode === 'text' && (
          <Field
            label={t(request.label)}
            value={values.value || ''}
            onChange={(value) => setValues({ value })}
          />
        )}
        {request.fields?.map((field) => (
          <Field
            key={field.key}
            label={t(field.label || field.key)}
            value={
              values[field.key] ??
              field.default ??
              (field.type === 'checkbox' ? false : field.type === 'number' ? 0 : '')
            }
            secret={field.type === 'password'}
            schema={{
              ...field,
              ...(field.options
                ? {
                    enum: field.options.map((item) => item.value),
                    labels: Object.fromEntries(
                      field.options.map((item) => [item.value, item.label])
                    )
                  }
                : {})
            }}
            onChange={(value) => setValues({ ...values, [field.key]: value })}
          />
        ))}
        <div className="choice-list">
          {request.choices?.map((choice, index) => (
            <Button key={index} className="wide" onClick={() => app.settle(choice.value)}>
              {choice.label}
            </Button>
          ))}
        </div>
        {request.mode === 'notice' && (
          <>
            <Check
              checked={values.checked}
              onChange={(checked) => setValues({ ...values, checked })}
            >
              {request.checkboxText}
            </Check>
            {request.actions.map((action) => (
              <Button
                key={action.id}
                className={action.primary ? 'primary wide' : 'wide'}
                onClick={() => app.settle({ action: action.id, checked: Boolean(values.checked) })}
              >
                {action.label}
              </Button>
            ))}
          </>
        )}
        <div className="dialog-actions">
          <Button onClick={() => app.settle(null)}>{t('Abbrechen')}</Button>
          {!request.choices && request.mode !== 'notice' && (
            <button type="submit" className="primary">
              {t(
                request.mode === 'confirm'
                  ? 'Bestätigen'
                  : request.mode === 'fields'
                    ? 'Fortsetzen'
                    : 'Übernehmen'
              )}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

/** Native accessible swatch plus optional editable hexadecimal value. */

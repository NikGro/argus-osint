import React, { useState, useEffect, useRef } from 'react';
import { Button, Field, Select, Check, DetailSection, Icon } from './ui/index.jsx';
import { authorizedFetch } from '../auth.js';
import { t } from '../i18n.js';

const TYPES = [
  'value',
  'text',
  'number',
  'boolean',
  'email',
  'phone',
  'url',
  'image',
  'file',
  'datetime',
  'json'
];
const labels = {
  value: 'Wert',
  text: 'Text',
  number: 'Zahl',
  boolean: 'Ja / Nein',
  email: 'E-Mail',
  phone: 'Telefonnummer',
  url: 'URL',
  image: 'Bild',
  file: 'Datei',
  datetime: 'Datum / Zeit',
  json: 'JSON / strukturierte Daten'
};
const options = () => TYPES.map((value) => ({ value, label: t(labels[value]) }));
const text = (value) =>
  value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

async function upload(file) {
  const response = await authorizedFetch('/api/files', {
    method: 'POST',
    headers: {
      'X-File-Name': encodeURIComponent(file.name),
      'Content-Type': 'application/octet-stream'
    },
    body: file
  });
  const body = await response.json();
  if (!response.ok) throw Error(t('ui.file_could_not_be_uploaded') + ' ' + file.name);
  return body;
}

export function Databases({ app }) {
  const [items, setItems] = useState([]),
    [database, setDatabase] = useState(null),
    [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [editor, setEditor] = useState(null);
  const [importing, setImporting] = useState(false),
    [fieldsOpen, setFieldsOpen] = useState(false);
  const request = useRef(0);
  const c = app.commands;
  const guard = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => setItems(await c.api('/api/databases'));
  async function load(id, offset = 0, search = query) {
    const ticket = ++request.current;
    const value = await c.api(
      '/api/databases/' + id + '?offset=' + offset + '&q=' + encodeURIComponent(search)
    );
    if (ticket === request.current) {
      setDatabase(value);
      setEditor(null);
    }
  }
  useEffect(() => {
    guard(refresh);
  }, []);
  const mutate = async (body) => {
    const result = await c.api('/api/databases/' + database.id, {
      revision: database.revision,
      ...body
    });
    if (result.deleted) setDatabase(null);
    else await load(database.id, database.offset);
    await refresh();
  };
  async function create() {
    const title = await c.askText(t('ui.create_database'), t('ui.name'));
    if (!title?.trim()) return;
    const value = await c.api('/api/databases', { title, fields: [] });
    setDatabase(value);
    setFieldsOpen(true);
    setEditor(null);
    await refresh();
  }
  return (
    <main className="databases-view content-view">
      <div className="view-heading">
        <div>
          <h1>{t('ui.databases')}</h1>
          <p>{t('ui.manage_structured_data_and_media_together_then_search_them_in_you')}</p>
        </div>
        <div className="action-row">
          <Button
            app={app}
            icon="plus"
            className="primary"
            disabled={busy}
            onClick={() => guard(create)}
          >
            {t('ui.create_database')}
          </Button>
          <Button icon="upload" disabled={busy} onClick={() => setImporting(true)}>
            {t('ui.import')}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}{' '}
          <Button
            onClick={() =>
              guard(async () => {
                await refresh();
                if (database) await load(database.id);
              })
            }
          >
            {t('ui.reload')}
          </Button>
        </p>
      )}
      {importing ? (
        <ImportWizard
          app={app}
          items={items}
          initial={database?.id}
          onCancel={() => setImporting(false)}
          onComplete={(id) =>
            guard(async () => {
              setImporting(false);
              setQuery('');
              await refresh();
              await load(id, 0, '');
            })
          }
        />
      ) : (
        <div className="database-layout" aria-busy={busy}>
          <aside className="database-list" aria-label={t('ui.databases')}>
            {!items.length && <p>{t('ui.no_databases_yet_create_a_database_or_import_files')}</p>}
            {items.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                className={'database-list-item' + (database?.id === item.id ? ' active' : '')}
                onClick={() =>
                  guard(() => {
                    setQuery('');
                    return load(item.id, 0, '');
                  })
                }
              >
                <Icon name="database" />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.row_count} {t('ui.records')} · {item.fields.length} {t('ui.fields')}
                  </small>
                </span>
              </button>
            ))}
          </aside>
          <section className="database-content">
            {!database ? (
              <div className="empty-state">
                <Icon name="database" />
                <h2>{t('ui.choose_database')}</h2>
                <p>{t('ui.databases_can_be_used_as_search_tool_inputs_across_projects')}</p>
              </div>
            ) : (
              <>
                <div className="database-heading">
                  <h2>{database.title}</h2>
                  <div className="action-row">
                    <Button
                      icon="edit"
                      only
                      disabled={busy}
                      onClick={() =>
                        guard(async () => {
                          const title = await c.askText(
                            t('ui.rename'),
                            t('ui.name'),
                            database.title
                          );
                          if (title?.trim())
                            await mutate({ operation: 'schema', title, fields: database.fields });
                        })
                      }
                    >
                      {t('ui.rename')}
                    </Button>
                    <Button
                      icon="settings"
                      disabled={busy}
                      onClick={() => setFieldsOpen(!fieldsOpen)}
                      aria-expanded={fieldsOpen}
                    >
                      {t('ui.manage_fields')}
                    </Button>
                    <Button
                      icon="trash"
                      only
                      className="danger-text"
                      disabled={busy}
                      onClick={() =>
                        guard(async () => {
                          if (
                            await c.askConfirm(
                              t('ui.delete_database'),
                              t(
                                'ui.delete_every_record_and_field_in_this_database_existing_graph_res'
                              )
                            )
                          )
                            await mutate({ operation: 'delete' });
                        })
                      }
                    >
                      {t('ui.delete_database')}
                    </Button>
                  </div>
                </div>
                {fieldsOpen && (
                  <SchemaEditor
                    app={app}
                    fields={database.fields}
                    busy={busy}
                    onChange={(fields) => guard(() => mutate({ operation: 'schema', fields }))}
                  />
                )}
                <form
                  className="database-search action-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    guard(() => load(database.id, 0));
                  }}
                >
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('ui.search_records')}
                    aria-label={t('ui.search_records')}
                  />
                  <Button
                    icon="search"
                    disabled={busy}
                    onClick={() => guard(() => load(database.id, 0))}
                  >
                    {t('ui.search')}
                  </Button>
                  <Button
                    icon="plus"
                    className="primary"
                    disabled={busy || !database.fields.length}
                    onClick={() => setEditor({ cells: {} })}
                  >
                    {t('ui.add_record')}
                  </Button>
                </form>
                {editor && (
                  <RowEditor
                    key={editor.id || 'new'}
                    fields={database.fields}
                    row={editor}
                    busy={busy}
                    onCancel={() => setEditor(null)}
                    onSave={(cells) =>
                      guard(async () => {
                        await mutate({
                          operation: 'rows',
                          rows: [{ ...(editor.id ? { id: editor.id } : {}), cells }]
                        });
                        setEditor(null);
                      })
                    }
                  />
                )}
                <div className="database-table-wrap">
                  <table className="database-table">
                    <caption className="sr-only">{database.title}</caption>
                    <thead>
                      <tr>
                        <th>{t('ui.actions')}</th>
                        {database.fields.map((field) => (
                          <th key={field.id}>
                            {field.name}
                            <small>{t(labels[field.type])}</small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {database.rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <div className="action-row">
                              <Button
                                only
                                icon="edit"
                                disabled={busy}
                                onClick={() => setEditor(row)}
                              >
                                {t('Bearbeiten')}
                              </Button>
                              <Button
                                only
                                icon="trash"
                                className="danger-text"
                                disabled={busy}
                                onClick={() =>
                                  guard(async () => {
                                    if (
                                      await c.askConfirm(
                                        t('ui.delete_record'),
                                        t('ui.permanently_delete_this_record')
                                      )
                                    )
                                      await mutate({
                                        operation: 'delete_rows',
                                        rows: [{ id: row.id }]
                                      });
                                  })
                                }
                              >
                                {t('ui.delete_record')}
                              </Button>
                            </div>
                          </td>
                          {database.fields.map((field) => (
                            <td key={field.id}>
                              <Cell value={row.cells[field.id]} type={field.type} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!database.rows.length && (
                  <p className="empty-state">
                    {t('ui.no_records_yet_or_no_matches_for_this_search')}
                  </p>
                )}
                <div className="database-pagination action-row">
                  <span>
                    {database.total} {t('ui.records')} · {database.offset + 1}–
                    {database.offset + database.rows.length}
                  </span>
                  <Button
                    icon="chevron-left"
                    only
                    disabled={busy || database.offset === 0}
                    onClick={() =>
                      guard(() => load(database.id, Math.max(0, database.offset - 100)))
                    }
                  >
                    {t('ui.previous_page')}
                  </Button>
                  <Button
                    icon="chevron-right"
                    only
                    disabled={busy || database.offset + 100 >= database.total}
                    onClick={() => guard(() => load(database.id, database.offset + 100))}
                  >
                    {t('ui.next_page')}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function Cell({ value, type }) {
  if (value === null || value === undefined || value === '')
    return <span className="muted">—</span>;
  if (['image', 'file'].includes(type))
    return (
      <div className="cell-files">
        {(Array.isArray(value) ? value : [value]).map((item, index) =>
          item?.file_id ? (
            <a key={index} href={'/api/files/' + item.file_id} target="_blank" rel="noreferrer">
              {type === 'image' && (
                <img src={'/api/files/' + item.file_id} loading="lazy" alt={item.filename || ''} />
              )}
              <span>{item.filename || t('ui.open_file')}</span>
            </a>
          ) : (
            <span key={index}>{text(item)}</span>
          )
        )}
      </div>
    );
  return (
    <span className="cell-value">
      {typeof value === 'boolean' ? t(value ? 'Ja' : 'Nein') : text(value)}
    </span>
  );
}

function SchemaEditor({ app, fields, busy, onChange }) {
  const [name, setName] = useState(''),
    [type, setType] = useState('value');
  return (
    <DetailSection className="schema-editor">
      <h3>{t('ui.manage_fields')}</h3>
      <p>{t('ui.field_types_remain_fixed_after_creation_create_another_field_to_u')}</p>
      {fields.map((field) => (
        <div className="schema-row" key={field.id}>
          <span>{field.name}</span>
          <small>{t(labels[field.type])}</small>
          <Button
            icon="edit"
            only
            disabled={busy}
            onClick={async () => {
              const name = await app.commands.askText(
                t('ui.rename_field'),
                t('ui.name'),
                field.name
              );
              if (name?.trim())
                onChange(fields.map((f) => (f.id === field.id ? { ...f, name } : f)));
            }}
          >
            {t('ui.rename')}
          </Button>
          <Button
            icon="trash"
            only
            className="danger-text"
            disabled={busy}
            onClick={async () => {
              if (
                await app.commands.askConfirm(
                  t('ui.delete_field'),
                  t('ui.delete_this_field_and_its_values_from_every_record')
                )
              )
                onChange(fields.filter((f) => f.id !== field.id));
            }}
          >
            {t('ui.delete_field')}
          </Button>
        </div>
      ))}
      <div className="schema-add">
        <Field label={t('ui.field_name')} value={name} onChange={setName} />
        <div className="react-field">
          <label>{t('ui.data_type')}</label>
          <Select label={t('ui.data_type')} value={type} options={options()} onChange={setType} />
        </div>
        <Button
          icon="plus"
          disabled={busy || !name.trim() || fields.length >= 200}
          onClick={() => {
            onChange([...fields, { name: name.trim(), type }]);
            setName('');
          }}
        >
          {t('ui.add_field')}
        </Button>
      </div>
    </DetailSection>
  );
}

function RowEditor({ fields, row, busy, onSave, onCancel }) {
  const [cells, setCells] = useState({ ...row.cells }),
    [json, setJson] = useState({}),
    [error, setError] = useState(''),
    [uploading, setUploading] = useState(false);
  const change = (id, value) => setCells((old) => ({ ...old, [id]: value }));
  function submit(event) {
    event.preventDefault();
    try {
      const result = { ...cells };
      for (const [id, value] of Object.entries(json))
        result[id] = value.trim() ? JSON.parse(value) : null;
      setError('');
      onSave(result);
    } catch {
      setError(t('ui.invalid_json_please_correct_the_input'));
    }
  }
  return (
    <form className="record-editor" onSubmit={submit}>
      <h3>{t(row.id ? 'Datensatz bearbeiten' : 'Datensatz hinzufügen')}</h3>
      <div className="database-fields">
        {fields.map((field) =>
          ['image', 'file'].includes(field.type) ? (
            <div className="react-field" key={field.id}>
              <label htmlFor={'files-' + field.id}>{field.name}</label>
              <Cell value={cells[field.id]} type={field.type} />
              <div className="action-row">
                <Button
                  icon="upload"
                  disabled={busy || uploading}
                  onClick={() => document.getElementById('files-' + field.id).click()}
                >
                  {t('ui.choose_files')}
                </Button>
                <input
                  hidden
                  id={'files-' + field.id}
                  type="file"
                  multiple
                  accept={field.type === 'image' ? 'image/*' : undefined}
                  disabled={busy || uploading}
                  onChange={async (event) => {
                    const files = [...event.target.files];
                    setUploading(true);
                    setError('');
                    try {
                      const stored = [];
                      for (const file of files) {
                        const item = await upload(file);
                        if (field.type === 'image' && !item.is_image)
                          throw Error(t('ui.choose_a_valid_image_file'));
                        stored.push(item);
                      }
                      const old = cells[field.id];
                      change(field.id, [
                        ...(Array.isArray(old) ? old : old ? [old] : []),
                        ...stored
                      ]);
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setUploading(false);
                      event.target.value = '';
                    }
                  }}
                />
                <Button
                  only
                  icon="trash"
                  className="danger-text"
                  onClick={() => change(field.id, null)}
                >
                  {t('ui.remove_files')}
                </Button>
              </div>
            </div>
          ) : field.type === 'json' ? (
            <div className="react-field" key={field.id}>
              <label htmlFor={'json-' + field.id}>{field.name}</label>
              <textarea
                id={'json-' + field.id}
                value={
                  json[field.id] ??
                  (cells[field.id] == null ? '' : JSON.stringify(cells[field.id], null, 2))
                }
                onChange={(e) => setJson({ ...json, [field.id]: e.target.value })}
              />
            </div>
          ) : (
            <Field
              key={field.id}
              label={field.name}
              value={
                cells[field.id] ??
                (field.type === 'boolean' ? false : field.type === 'number' ? null : '')
              }
              schema={
                field.type === 'number'
                  ? { type: 'number', nullable: true, step: 'any' }
                  : field.type === 'email'
                    ? { type: 'email' }
                    : {}
              }
              multiline={field.type === 'text'}
              onChange={(value) => change(field.id, value)}
            />
          )
        )}
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="action-row">
        <button type="submit" className="primary" disabled={busy || uploading}>
          <Icon name={uploading ? 'spinner' : 'save'} />
          {t('ui.save')}
        </button>
        <Button disabled={busy || uploading} onClick={onCancel}>
          {t('ui.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ImportWizard({ app, items, initial, onComplete, onCancel }) {
  const [target, setTarget] = useState(initial || ''),
    [title, setTitle] = useState(''),
    [files, setFiles] = useState([]),
    [mode, setMode] = useState('auto');
  const [headers, setHeaders] = useState(true),
    [encoding, setEncoding] = useState('utf-8-sig'),
    [delimiter, setDelimiter] = useState('auto'),
    [sheet, setSheet] = useState(''),
    [recordPath, setRecordPath] = useState('');
  const [preview, setPreview] = useState(null),
    [mapping, setMapping] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const settings = { mode, headers, encoding, delimiter, sheet, record_path: recordPath };
  const invalidate = (setter) => (value) => {
    setter(value);
    setPreview(null);
  };
  const guard = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  function assign(columns, destination) {
    setMapping(
      columns.map((column) => {
        const existing = destination?.fields.find(
          (field) => field.name.trim().toLowerCase() === column.key.trim().toLowerCase()
        );
        return {
          source: column.key,
          field_id: existing?.id || '',
          name: column.key,
          type: existing?.type || column.type,
          skip: false
        };
      })
    );
  }
  const destination = items.find((item) => item.id === target);
  async function showPreview() {
    let ids = files.map((file) => file.file_id);
    const result = await app.commands.api('/api/databases/import/preview', {
      files: ids,
      ...settings
    });
    setPreview(result);
    assign(result.columns, destination);
    if (result.sheet) setSheet(result.sheet);
  }
  return (
    <section className="import-workbench">
      <div className="database-heading">
        <h2>{t('ui.import_data')}</h2>
        <Button icon="close" only disabled={busy} onClick={onCancel}>
          {t('ui.close')}
        </Button>
      </div>
      <p>{t('ui.upload_files_review_the_preview_and_map_columns_records_are_writt')}</p>
      <div className="import-settings database-fields">
        <div className="react-field">
          <label>{t('ui.destination')}</label>
          <Select
            label={t('ui.destination')}
            disabled={busy}
            value={target}
            options={[
              { value: '', label: t('ui.new_database') },
              ...items.map((item) => ({ value: item.id, label: item.title }))
            ]}
            onChange={(value) => {
              setTarget(value);
              if (preview)
                assign(
                  preview.columns,
                  items.find((item) => item.id === value)
                );
            }}
          />
        </div>
        {!target && <Field label={t('ui.new_database_name')} value={title} onChange={setTitle} />}
        <div className="react-field">
          <label>{t('ui.import_mode')}</label>
          <Select
            label={t('ui.import_mode')}
            value={mode}
            onChange={invalidate(setMode)}
            options={[
              {
                value: 'auto',
                label: t('ui.detect_tables_other_files_become_separate_records')
              },
              { value: 'attachments', label: t('ui.each_file_becomes_a_new_record') },
              { value: 'one_record', label: t('ui.all_files_in_one_record') }
            ]}
          />
        </div>
      </div>
      <div
        className="import-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const incoming = [...event.dataTransfer.files];
          guard(async () => {
            const added = [];
            for (const file of incoming) added.push(await upload(file));
            setFiles((old) => [...old, ...added]);
            setPreview(null);
          });
        }}
      >
        <Icon name="upload" />
        <label htmlFor="database-import-files">{t('ui.drop_files_here_or_choose_files')}</label>
        <Button
          icon="upload"
          disabled={busy}
          onClick={() => document.getElementById('database-import-files').click()}
        >
          {t('ui.choose_files')}
        </Button>
        <input
          hidden
          id="database-import-files"
          type="file"
          multiple
          disabled={busy}
          onChange={(event) => {
            const incoming = [...event.target.files];
            event.target.value = '';
            guard(async () => {
              const added = [];
              for (const file of incoming) added.push(await upload(file));
              setFiles((old) => [...old, ...added]);
              setPreview(null);
              if (!title && incoming.length) setTitle(incoming[0].name.replace(/\.[^.]+$/, ''));
            });
          }}
        />
        <small>{t('ui.csv_tsv_xlsx_ods_json_jsonl_xml_text_images_and_arbitrary_file_at')}</small>
      </div>
      {files.length > 0 && (
        <div className="import-file-list">
          {files.map((file, index) => (
            <div key={file.file_id}>
              <span>{file.filename}</span>
              <small>{Math.round(file.size / 1024)} KB</small>
              <Button
                only
                icon="trash"
                className="danger-text"
                disabled={busy}
                onClick={() => {
                  setFiles(files.filter((_, i) => i !== index));
                  setPreview(null);
                }}
              >
                {t('ui.remove')}
              </Button>
            </div>
          ))}
        </div>
      )}
      {mode === 'auto' && (
        <details className="import-options">
          <summary>{t('ui.file_format_and_table_options')}</summary>
          <div className="database-fields">
            <Check checked={headers} onChange={invalidate(setHeaders)}>
              {t('ui.first_table_row_contains_field_names')}
            </Check>
            <div className="react-field">
              <label>{t('ui.encoding')}</label>
              <Select
                label={t('ui.encoding')}
                value={encoding}
                onChange={invalidate(setEncoding)}
                options={['utf-8-sig', 'utf-16', 'cp1252'].map((value) => ({
                  value,
                  label: value
                }))}
              />
            </div>
            <div className="react-field">
              <label>{t('ui.delimiter')}</label>
              <Select
                label={t('ui.delimiter')}
                value={delimiter}
                onChange={invalidate(setDelimiter)}
                options={[
                  ['auto', 'Automatisch'],
                  [',', 'Komma'],
                  [';', 'Semikolon'],
                  ['\t', 'Tabulator'],
                  ['|', 'Senkrechter Strich'],
                  ['lines', 'Text: eine Zeile pro Datensatz']
                ].map(([value, label]) => ({ value, label: t(label) }))}
              />
            </div>
            <Field
              label={t('ui.json_path_to_the_record_list_optional')}
              value={recordPath}
              onChange={invalidate(setRecordPath)}
            />
          </div>
        </details>
      )}
      {preview?.sheets.length > 1 && (
        <div className="react-field">
          <label>{t('ui.worksheet')}</label>
          <Select
            label={t('ui.worksheet')}
            value={sheet}
            options={preview.sheets.map((value) => ({ value, label: value }))}
            onChange={(value) => {
              setSheet(value);
              setPreview(null);
            }}
          />
        </div>
      )}
      <div className="action-row">
        <Button
          icon={busy ? 'spinner' : 'search'}
          className="primary"
          disabled={busy || !files.length}
          onClick={() => guard(showPreview)}
        >
          {t('ui.preview_and_mapping')}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {t('ui.cancel')}
        </Button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <DetailSection>
          <h3>
            {t('ui.map_columns')} · {preview.total} {t('ui.records')}
          </h3>
          <p>{t('ui.matching_field_names_are_mapped_automatically_other_columns_can_c')}</p>
          <div className="import-mapping">
            {mapping.map((entry, index) => (
              <div className={'mapping-row' + (entry.skip ? ' skipped' : '')} key={entry.source}>
                <div>
                  <strong>{entry.source}</strong>
                  <small>
                    {preview.columns[index].samples.map(text).join(' · ').slice(0, 160)}
                  </small>
                </div>
                <Select
                  label={t('ui.destination_field')}
                  value={entry.skip ? '__skip' : entry.field_id || '__new'}
                  options={[
                    { value: '__new', label: t('ui.create_new_field') },
                    { value: '__skip', label: t('ui.do_not_import') },
                    ...(destination?.fields || []).map((field) => ({
                      value: field.id,
                      label: field.name
                    }))
                  ]}
                  onChange={(value) =>
                    setMapping(
                      mapping.map((m, i) =>
                        i === index
                          ? {
                              ...m,
                              skip: value === '__skip',
                              field_id: value.startsWith('__') ? '' : value
                            }
                          : m
                      )
                    )
                  }
                />
                {!entry.field_id && !entry.skip && (
                  <>
                    <Field
                      label={t('ui.field_name')}
                      value={entry.name}
                      onChange={(name) =>
                        setMapping(mapping.map((m, i) => (i === index ? { ...m, name } : m)))
                      }
                    />
                    <Select
                      label={t('ui.data_type')}
                      value={entry.type}
                      options={options()}
                      onChange={(type) =>
                        setMapping(mapping.map((m, i) => (i === index ? { ...m, type } : m)))
                      }
                    />
                  </>
                )}
              </div>
            ))}
          </div>
          <h3>
            {t('ui.preview')} · {t('ui.first_ten_records')}
          </h3>
          <div className="database-table-wrap">
            <table className="database-table">
              <thead>
                <tr>
                  {preview.columns.map((column) => (
                    <th key={column.key}>{column.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={index}>
                    {preview.columns.map((column) => (
                      <td key={column.key}>
                        <Cell value={row[column.key]} type={column.type} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.warnings.map((w) => (
            <p key={w}>{t(w)}</p>
          ))}
          <Button
            className="primary"
            icon={busy ? 'spinner' : 'check'}
            disabled={busy || (!target && !title.trim()) || mapping.every((m) => m.skip)}
            onClick={() =>
              guard(async () => {
                const result = await app.commands.api('/api/databases/import/commit', {
                  preview_id: preview.id,
                  database_id: target || undefined,
                  revision: destination?.revision,
                  title,
                  mapping
                });
                onComplete(result.database_id);
              })
            }
          >
            {t('ui.confirm_import')}
          </Button>
        </DetailSection>
      )}
    </section>
  );
}

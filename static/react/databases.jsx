import React, { useState, useEffect, useRef } from 'react';
import { Button, Field, Select, Check, DetailSection, Icon } from './ui/index.jsx';
import { authorizedFetch } from '../auth.js';

/** Table scroller with a second horizontal scrollbar above the table, kept in sync. */
function TableScroll({ children }) {
  const top = useRef(null),
    wrap = useRef(null),
    syncing = useRef(false);
  const [width, setWidth] = useState(0),
    [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = wrap.current;
    if (!element) return undefined;
    const measure = () => {
      setWidth(element.scrollWidth);
      setOverflow(element.scrollWidth > element.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const follow = (from, to) => () => {
    if (syncing.current) {
      syncing.current = false;
      return;
    }
    if (to.current && to.current.scrollLeft !== from.current.scrollLeft) {
      syncing.current = true;
      to.current.scrollLeft = from.current.scrollLeft;
    }
  };
  return (
    <>
      <div
        ref={top}
        className="database-table-topscroll"
        hidden={!overflow}
        aria-hidden="true"
        onScroll={follow(top, wrap)}
      >
        <div style={{ width }} />
      </div>
      <div ref={wrap} className="database-table-wrap" onScroll={follow(wrap, top)}>
        {children}
      </div>
    </>
  );
}

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
  value: 'Value',
  text: 'Text',
  number: 'Number',
  boolean: 'Yes / No',
  email: 'Email',
  phone: 'Phone number',
  url: 'Profile URL',
  image: 'Image',
  file: 'File',
  datetime: 'Date / time',
  json: 'JSON / structured data'
};
const options = () => TYPES.map((value) => ({ value, label: labels[value] }));
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
  if (!response.ok) throw Error('File could not be uploaded.' + ' ' + file.name);
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
    const title = await c.askText('Create database', 'Name');
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
          <h1>{'Databases'}</h1>
          <p>{'Manage structured data and media together, then search them in your graph.'}</p>
        </div>
        <div className="action-row">
          <Button
            app={app}
            icon="plus"
            className="primary"
            disabled={busy}
            onClick={() => guard(create)}
          >
            {'Create database'}
          </Button>
          <Button icon="upload" disabled={busy} onClick={() => setImporting(true)}>
            {'Import'}
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
            {'Reload'}
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
          <aside className="database-list" aria-label={'Databases'}>
            {!items.length && <p>{'No databases yet. Create a database or import files.'}</p>}
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
                    {item.row_count} {item.row_count === 1 ? 'record' : 'records'} ·{' '}
                    {item.fields.length} {item.fields.length === 1 ? 'field' : 'fields'}
                  </small>
                </span>
              </button>
            ))}
          </aside>
          <section className="database-content">
            {!database ? (
              <div className="empty-state">
                <Icon name="database" />
                <h2>{'Choose database'}</h2>
                <p>{'Databases can be used as search-tool inputs across projects.'}</p>
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
                          const title = await c.askText('Rename', 'Name', database.title);
                          if (title?.trim())
                            await mutate({ operation: 'schema', title, fields: database.fields });
                        })
                      }
                    >
                      {'Rename'}
                    </Button>
                    <Button
                      icon="settings"
                      disabled={busy}
                      onClick={() => setFieldsOpen(!fieldsOpen)}
                      aria-expanded={fieldsOpen}
                    >
                      {'Manage fields'}
                    </Button>
                    <Button
                      icon="trash"
                      only
                      className="danger-filled"
                      disabled={busy}
                      onClick={() =>
                        guard(async () => {
                          if (
                            await c.askConfirm(
                              'Delete database',
                              'Delete every record and field in this database? Existing graph results are preserved.'
                            )
                          )
                            await mutate({ operation: 'delete' });
                        })
                      }
                    >
                      {'Delete database'}
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
                    placeholder={'Search records …'}
                    aria-label={'Search records …'}
                  />
                  <Button
                    icon="search"
                    disabled={busy}
                    onClick={() => guard(() => load(database.id, 0))}
                  >
                    {'Search'}
                  </Button>
                  <Button
                    icon="plus"
                    className="primary"
                    disabled={busy || !database.fields.length}
                    onClick={() => setEditor({ cells: {} })}
                  >
                    {'Add record'}
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
                <TableScroll>
                  <table className="database-table">
                    <caption className="sr-only">{database.title}</caption>
                    <thead>
                      <tr>
                        <th>{'Actions'}</th>
                        {database.fields.map((field) => (
                          <th key={field.id}>
                            {field.name}
                            <small>{labels[field.type]}</small>
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
                                {'Edit'}
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
                                        'Delete record',
                                        'Permanently delete this record?'
                                      )
                                    )
                                      await mutate({
                                        operation: 'delete_rows',
                                        rows: [{ id: row.id }]
                                      });
                                  })
                                }
                              >
                                {'Delete record'}
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
                </TableScroll>
                {!database.rows.length && (
                  <p className="empty-state">{'No records yet, or no matches for this search.'}</p>
                )}
                <div className="database-pagination action-row">
                  <span>
                    {database.total} {database.total === 1 ? 'record' : 'records'}
                    {database.rows.length > 0 &&
                      ` · ${database.offset + 1}–${database.offset + database.rows.length}`}
                  </span>
                  <Button
                    icon="chevron-left"
                    only
                    disabled={busy || database.offset === 0}
                    onClick={() =>
                      guard(() => load(database.id, Math.max(0, database.offset - 100)))
                    }
                  >
                    {'Previous page'}
                  </Button>
                  <Button
                    icon="chevron-right"
                    only
                    disabled={busy || database.offset + 100 >= database.total}
                    onClick={() => guard(() => load(database.id, database.offset + 100))}
                  >
                    {'Next page'}
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
              <span>{item.filename || 'Open file'}</span>
            </a>
          ) : (
            <span key={index}>{text(item)}</span>
          )
        )}
      </div>
    );
  return (
    <span className="cell-value">
      {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : text(value)}
    </span>
  );
}

function SchemaEditor({ app, fields, busy, onChange }) {
  const [name, setName] = useState(''),
    [type, setType] = useState('value');
  return (
    <DetailSection className="schema-editor">
      <h3>{'Manage fields'}</h3>
      <p>
        {'Field types remain fixed after creation. Create another field to use a different type.'}
      </p>
      {fields.map((field) => (
        <div className="schema-row" key={field.id}>
          <span>{field.name}</span>
          <small>{labels[field.type]}</small>
          <Button
            icon="edit"
            only
            disabled={busy}
            onClick={async () => {
              const name = await app.commands.askText('Rename field', 'Name', field.name);
              if (name?.trim())
                onChange(fields.map((f) => (f.id === field.id ? { ...f, name } : f)));
            }}
          >
            {'Rename'}
          </Button>
          <Button
            icon="trash"
            only
            className="danger-text"
            disabled={busy}
            onClick={async () => {
              if (
                await app.commands.askConfirm(
                  'Delete field',
                  'Delete this field and its values from every record?'
                )
              )
                onChange(fields.filter((f) => f.id !== field.id));
            }}
          >
            {'Delete field'}
          </Button>
        </div>
      ))}
      <div className="schema-add">
        <Field label={'Field name'} value={name} onChange={setName} />
        <div className="react-field">
          <label>{'Data type'}</label>
          <Select label={'Data type'} value={type} options={options()} onChange={setType} />
        </div>
        <Button
          icon="plus"
          disabled={busy || !name.trim() || fields.length >= 200}
          onClick={() => {
            onChange([...fields, { name: name.trim(), type }]);
            setName('');
          }}
        >
          {'Add field'}
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
      setError('Invalid JSON. Please correct the input.');
    }
  }
  return (
    <form className="record-editor" onSubmit={submit}>
      <h3>{row.id ? 'Edit record' : 'Add record'}</h3>
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
                  {'Choose files'}
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
                          throw Error('Choose a valid image file.');
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
                  {'Remove files'}
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
          {'Save'}
        </button>
        <Button disabled={busy || uploading} onClick={onCancel}>
          {'Cancel'}
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
        <h2>{'Import data'}</h2>
        <Button icon="close" only disabled={busy} onClick={onCancel}>
          {'Close'}
        </Button>
      </div>
      <p>
        {
          'Upload files, review the preview and map columns. Records are written only when you confirm the import.'
        }
      </p>
      <div className="import-settings database-fields">
        <div className="react-field">
          <label>{'Destination'}</label>
          <Select
            label={'Destination'}
            disabled={busy}
            value={target}
            options={[
              { value: '', label: 'New database' },
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
        {!target && <Field label={'New database name'} value={title} onChange={setTitle} />}
        <div className="react-field">
          <label>{'Import mode'}</label>
          <Select
            label={'Import mode'}
            value={mode}
            onChange={invalidate(setMode)}
            options={[
              {
                value: 'auto',
                label: 'Detect tables; other files become separate records'
              },
              { value: 'attachments', label: 'Each file becomes a new record' },
              { value: 'one_record', label: 'All files in one record' }
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
        <label htmlFor="database-import-files">{'Drop files here or choose files'}</label>
        <Button
          icon="upload"
          disabled={busy}
          onClick={() => document.getElementById('database-import-files').click()}
        >
          {'Choose files'}
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
        <small>
          {
            'CSV, TSV, XLSX, ODS, JSON, JSONL, XML, text, images and arbitrary file attachments. Up to 200 files and 10,000 records per import.'
          }
        </small>
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
                {'Remove'}
              </Button>
            </div>
          ))}
        </div>
      )}
      {mode === 'auto' && (
        <details className="import-options">
          <summary>{'File format and table options'}</summary>
          <div className="database-fields">
            <Check checked={headers} onChange={invalidate(setHeaders)}>
              {'First table row contains field names'}
            </Check>
            <div className="react-field">
              <label>{'Encoding'}</label>
              <Select
                label={'Encoding'}
                value={encoding}
                onChange={invalidate(setEncoding)}
                options={['utf-8-sig', 'utf-16', 'cp1252'].map((value) => ({
                  value,
                  label: value
                }))}
              />
            </div>
            <div className="react-field">
              <label>{'Delimiter'}</label>
              <Select
                label={'Delimiter'}
                value={delimiter}
                onChange={invalidate(setDelimiter)}
                options={[
                  ['auto', 'Automatic'],
                  [',', 'Comma'],
                  [';', 'Semicolon'],
                  ['\t', 'Tab'],
                  ['|', 'Vertical bar'],
                  ['lines', 'Text: one line per record']
                ].map(([value, label]) => ({ value, label: label }))}
              />
            </div>
            <Field
              label={'JSON path to the record list (optional)'}
              value={recordPath}
              onChange={invalidate(setRecordPath)}
            />
          </div>
        </details>
      )}
      {preview?.sheets.length > 1 && (
        <div className="react-field">
          <label>{'Worksheet'}</label>
          <Select
            label={'Worksheet'}
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
          {'Preview and mapping'}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {'Cancel'}
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
            {'Map columns'} · {preview.total} {preview.total === 1 ? 'record' : 'records'}
          </h3>
          <p>
            {
              'Matching field names are mapped automatically. Other columns can create new fields or be skipped.'
            }
          </p>
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
                  label={'Destination field'}
                  value={entry.skip ? '__skip' : entry.field_id || '__new'}
                  options={[
                    { value: '__new', label: 'Create new field' },
                    { value: '__skip', label: 'Do not import' },
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
                      label={'Field name'}
                      value={entry.name}
                      onChange={(name) =>
                        setMapping(mapping.map((m, i) => (i === index ? { ...m, name } : m)))
                      }
                    />
                    <Select
                      label={'Data type'}
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
            {'Preview'} · {'First ten records'}
          </h3>
          <TableScroll>
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
          </TableScroll>
          {preview.warnings.map((w) => (
            <p key={w}>{w}</p>
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
            {'Confirm import'}
          </Button>
        </DetailSection>
      )}
    </section>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Button, Field, Icon } from './ui/index.jsx';

// Notes are typed continuously; wait for a pause before re-rendering the report.
const PREVIEW_DELAY = 800;

export function Report({ app }) {
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const project = app.state.workspaceState.project;

  async function refresh() {
    setBusy(true);
    try {
      await app.commands.save();
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  function refreshSoon() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => app.safely(refresh), PREVIEW_DELAY);
  }
  // Opening the report shows the current project state, unsaved edits included.
  useEffect(() => {
    app.safely(refresh);
    return () => clearTimeout(timer.current);
  }, [project.id]);

  return (
    <main id="reportView" className="report-view">
      <div className="report-controls">
        <div className="view-heading">
          <div className="action-row">
            <Button icon="back" only onClick={() => app.commands.show('workspace')}>
              {'Back'}
            </Button>
            <h1>{'Report'}</h1>
          </div>
          <span className="report-status" role="status" aria-live="polite">
            {busy && (
              <>
                <Icon name="spinner" /> {'Updating preview …'}
              </>
            )}
          </span>
        </div>
        <section className="report-notes">
          <Field
            label={'Report notes'}
            multiline
            value={project.document.report_notes || ''}
            onChange={(value) => {
              project.document.report_notes = value;
              app.commands.change();
              refreshSoon();
            }}
          />
        </section>
        <p>{'The preview uses softer contrast. Printing uses white A4 paper.'}</p>
      </div>
      <iframe
        key={revision}
        id="reportFrame"
        title={'Report'}
        src={'/api/projects/' + project.id + '/report?preview=' + revision}
      />
    </main>
  );
}

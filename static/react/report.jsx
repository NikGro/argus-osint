import React, { useState } from 'react';
import { Button, Field } from './ui/index.jsx';

export function Report({ app }) {
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const project = app.state.workspaceState.project;
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
          <Button
            app={app}
            icon={busy ? 'spinner' : 'refresh'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await app.commands.save();
                setRevision((value) => value + 1);
              } finally {
                setBusy(false);
              }
            }}
          >
            {'Refresh preview'}
          </Button>
        </div>
        <details className="report-notes">
          <summary>{'Report notes'}</summary>
          <Field
            label={'Report notes'}
            multiline
            value={project.document.report_notes || ''}
            onChange={(value) => {
              project.document.report_notes = value;
              app.commands.change();
            }}
          />
        </details>
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

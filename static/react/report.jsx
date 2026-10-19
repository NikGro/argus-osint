import React, { useState } from 'react';
import { Button, Field } from './ui/index.jsx';
import { t } from '../i18n.js';

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
              {t('ui.back')}
            </Button>
            <h1>{t('ui.report_b6ce788d')}</h1>
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
            {t('ui.refresh_preview')}
          </Button>
        </div>
        <details className="report-notes">
          <summary>{t('ui.report_notes')}</summary>
          <Field
            label={t('ui.report_notes')}
            multiline
            value={project.document.report_notes || ''}
            onChange={(value) => {
              project.document.report_notes = value;
              app.commands.change();
            }}
          />
        </details>
        <p>{t('ui.the_preview_uses_softer_contrast_printing_uses_white_a4_paper')}</p>
      </div>
      <iframe
        key={revision}
        id="reportFrame"
        title={t('ui.report_b6ce788d')}
        src={'/api/projects/' + project.id + '/report?preview=' + revision}
      />
    </main>
  );
}

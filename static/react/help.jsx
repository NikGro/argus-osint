import React, { useState } from 'react';
import { Icon } from './ui/index.jsx';

const chapters = [
  [
    'projects',
    'Projects and files',
    [
      [
        'Start a project',
        'Create and open a project from the main menu. ARGUS saves changes automatically. The status at the top right shows whether changes are still pending.'
      ],
      [
        'Keep your files',
        'Upload images, videos and files. Project files stay associated with the project. Editing tools create copies and preserve original files.'
      ],
      [
        'Archives and backups',
        'Rename and archive projects, or delete them from the archive. Back up the complete ARGUS data volume, including its keys.'
      ]
    ]
  ],
  [
    'graph',
    'Canvas and tools',
    [
      [
        'Connect data',
        'Add a data node on the left and edit its values on the right. Selecting a node highlights compatible tools. Drag a tool onto the node, or add it and connect the ports.'
      ],
      [
        'Multiple inputs',
        'Select multiple nodes with Shift or the selection rectangle. Tools with multiple inputs require compatible types, such as an image and a database, or two images.'
      ],
      [
        'Navigate and group',
        'Pan with Space and drag; zoom with Ctrl and the mouse wheel or the zoom field. Groups can be nested, expanded and collapsed. Arrange organizes the graph.'
      ],
      [
        'Execution and results',
        'Select a tool and press Run tool. Further jobs enter the queue. Output nodes retain their provenance. Warnings and failures may also appear as error nodes, even when partial results are available.'
      ]
    ]
  ],
  [
    'databases',
    'Databases and imports',
    [
      [
        'Manage data',
        'Create a database in the Databases tab and add fields. Types include values, text, numbers, booleans, identifiers, images, files and JSON. Records can be edited and deleted.'
      ],
      [
        'Prepare an import',
        'Import files, choose a destination and generate a preview. CSV, TSV, XLSX, ODS, JSON, JSONL, XML and text are read as data; other formats become attachments. Formulas are not executed.'
      ],
      [
        'Map columns',
        'Matching field names are mapped automatically. Each source column can map to an existing field, a new field or Do not import. Choose the worksheet, header row, encoding and delimiter for tables. Confirm import applies the whole import.'
      ],
      [
        'Add multiple images',
        'Choose multiple images and use Each file becomes a new record. Alternatively, All files in one record collects attachments in a single row. Image and file fields can hold multiple attachments.'
      ],
      [
        'Search from the graph',
        'Add a database node and choose a database. Connect Search database to that node and a value, email, phone, URL or username node. Choose the reference column on the first execution. Each matching record becomes a separate group containing all populated fields.'
      ],
      [
        'Compare image columns',
        'DeepFace accepts two images, or a reference image and a database. Select an image column; matching records appear as groups with provenance and comparison values. Review comparison limits and warnings.'
      ]
    ]
  ],
  [
    'media',
    'Media and maps',
    [
      [
        'Previews and cropping',
        'Glances show images, videos and maps on the canvas. Quick actions open the resource in a new tab. Video cropping uses a shared time-range control and a graphical crop area.'
      ],
      [
        'Locations',
        'Enter an address or coordinates in a location node and enable the map preview. The preview loads through ARGUS and follows its network settings.'
      ]
    ]
  ],
  [
    'report',
    'Verification and report',
    [
      [
        'Mark findings',
        'Verification and custom tags help assess findings. Include in report controls which nodes appear in the report. Verify results independently.'
      ],
      [
        'Create a report',
        'Open Report from the toolbar, add notes and refresh the preview. Print / save as PDF creates a report on white A4 paper. Nested data uses field paths without increasing indentation.'
      ]
    ]
  ],
  [
    'configuration',
    'Plugins, VPN and logs',
    [
      [
        'Settings and defaults',
        'Plugin settings separate global configuration from defaults for new tool runs. Configure sources and their order there; search profiles can be changed for a specific search.'
      ],
      [
        'VPN and queue',
        'Manage OpenVPN or WireGuard profiles in settings. Rotate on a timer or after a tool run. When VPN use is enabled, the queue waits for the connection. The Docker host must provide the documented networking permissions.'
      ],
      [
        'Investigate problems',
        'Project logs show tool runs; system logs offer search, export and automatic refresh. For incomplete results, inspect warnings and provenance first. Store credentials in plugin settings.'
      ]
    ]
  ]
];

export function Help() {
  const [query, setQuery] = useState('');
  const matching = chapters
    .map(([id, title, items]) => [
      id,
      title,
      items.filter(([heading, body]) =>
        (heading + ' ' + body + ' ' + title).toLowerCase().includes(query.toLowerCase())
      )
    ])
    .filter(([, , items]) => items.length);
  return (
    <main className="help-view content-view">
      <div className="view-heading">
        <div>
          <h1>{'Help'}</h1>
          <p>{'A short guide to ARGUS'}</p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={'Search the manual …'}
          aria-label={'Search the manual …'}
        />
      </div>
      <div className="help-layout">
        <nav aria-label={'Contents'}>
          {matching.map(([id, title]) => (
            <a key={id} href={'#help-' + id}>
              {title}
            </a>
          ))}
        </nav>
        <article>
          {matching.map(([id, title, items]) => (
            <section key={id} id={'help-' + id}>
              <h2>{title}</h2>
              {items.map(([heading, body]) => (
                <div key={heading}>
                  <h3>{heading}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </section>
          ))}
          {!matching.length && (
            <p>
              <Icon name="search" />
              {'No matching entries.'}
            </p>
          )}
        </article>
      </div>
    </main>
  );
}

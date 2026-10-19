import React, { useState } from 'react';
import { Icon } from './ui/index.jsx';
import { t } from '../i18n.js';

const chapters = [
  [
    'projects',
    'Projekte und Dateien',
    [
      [
        'Ein Projekt beginnen',
        'Im Hauptmenü ein Projekt anlegen und öffnen. ARGUS speichert Änderungen automatisch. Oben rechts zeigt der Speicherstatus, ob noch Änderungen ausstehen.'
      ],
      [
        'Dateien behalten',
        'Bilder, Videos und Dateien können hochgeladen werden. Projektdateien bleiben mit dem Projekt verknüpft. Bearbeitungswerkzeuge erstellen Kopien; Originaldateien bleiben erhalten.'
      ],
      [
        'Archiv und Sicherung',
        'Projekte lassen sich umbenennen, archivieren und aus dem Archiv löschen. Für Sicherungen das gesamte ARGUS-Datenvolume einschließlich der Schlüssel sichern.'
      ]
    ]
  ],
  [
    'graph',
    'Canvas und Tools',
    [
      [
        'Daten verbinden',
        'Links einen Daten-Node hinzufügen und rechts seine Werte bearbeiten. Ein ausgewählter Node hebt passende Tools hervor. Ein Tool auf den Node ziehen oder hinzufügen und die Andockpunkte verbinden.'
      ],
      [
        'Mehrere Eingaben',
        'Mit Umschalt oder dem Auswahlrahmen mehrere Nodes auswählen. Tools mit mehreren Eingaben benötigen die passenden Typen, beispielsweise ein Bild und eine Datenbank oder zwei Bilder.'
      ],
      [
        'Navigieren und gruppieren',
        'Canvas mit Leertaste und Ziehen verschieben; mit Strg und Mausrad oder der Zoomanzeige zoomen. Gruppen können verschachtelt und auf- oder zugeklappt werden. Bereinigen ordnet den Graphen an.'
      ],
      [
        'Ausführen und Ergebnisse',
        'Tool auswählen und „Tool ausführen“ drücken. Weitere Aufträge kommen in die Warteschlange. Ergebnis-Nodes behalten ihre Herkunft. Warnungen und Fehler können zusätzlich als Error-Nodes erscheinen, auch wenn Teilergebnisse vorliegen.'
      ]
    ]
  ],
  [
    'databases',
    'Datenbanken und Importe',
    [
      [
        'Daten pflegen',
        'Im Tab Datenbanken eine Datenbank anlegen und Felder hinzufügen. Feldtypen umfassen Werte, Text, Zahlen, Ja/Nein, Kennungen, Bilder, Dateien und JSON. Datensätze lassen sich bearbeiten und löschen.'
      ],
      [
        'Import vorbereiten',
        'Dateien importieren, ein Ziel wählen und eine Vorschau erzeugen. CSV, TSV, XLSX, ODS, JSON, JSONL, XML und Text werden als Daten gelesen; andere Formate als Anhänge aufgenommen. Formeln werden nicht ausgeführt.'
      ],
      [
        'Spalten zuordnen',
        'Gleiche Feldnamen werden automatisch zugeordnet. Jede Quellspalte kann einem bestehenden Feld, einem neuen Feld oder „Nicht importieren“ zugeordnet werden. Bei Tabellen lassen sich Blatt, Kopfzeile, Kodierung und Trennzeichen wählen. Erst „Import bestätigen“ übernimmt den gesamten Import.'
      ],
      [
        'Viele Bilder aufnehmen',
        'Mehrere Bilder auswählen und „Jede Datei als neuer Datensatz“ verwenden. Alternativ sammelt „Alle Dateien als ein Datensatz“ die Anhänge in einer Zeile. Bild- und Dateifelder können mehrere Anhänge enthalten.'
      ],
      [
        'Im Graphen suchen',
        'Einen Datenbank-Node hinzufügen und die Datenbank auswählen. Mit „Datenbank durchsuchen“ zusätzlich einen Value-, E-Mail-, Telefon-, URL- oder Username-Node verbinden. Beim ersten Ausführen die Referenzspalte wählen. Jeder passende Datensatz wird als eigene Gruppe mit allen ausgefüllten Feldern ausgegeben.'
      ],
      [
        'Bildspalten vergleichen',
        'DeepFace akzeptiert weiterhin zwei Bilder oder ein Referenzbild und eine Datenbank. Eine Bildspalte auswählen; passende Datensätze erscheinen als Gruppen mit Herkunft und Vergleichswerten. Vergleichslimits und Warnungen beachten.'
      ]
    ]
  ],
  [
    'media',
    'Medien und Karten',
    [
      [
        'Vorschauen und Zuschnitt',
        'Glances zeigen Bilder, Videos und Karten direkt im Canvas. Quick Actions öffnen die Ressource in einem neuen Tab. Videozuschnitt verwendet einen gemeinsamen Zeitbereich und einen grafischen Bildausschnitt.'
      ],
      [
        'Ortsangaben',
        'Im Location-Node Adresse oder Koordinaten eintragen und die Kartenvorschau aktivieren. Die Vorschau wird über ARGUS geladen und unterliegt dessen Netzwerkeinstellungen.'
      ]
    ]
  ],
  [
    'report',
    'Verifizierung und Report',
    [
      [
        'Erkenntnisse markieren',
        'Verifizierung und eigene Tags helfen bei der Einordnung. „In Report aufnehmen“ bestimmt, welche Nodes im Bericht erscheinen. Ergebnisse unabhängig prüfen.'
      ],
      [
        'Bericht erstellen',
        'In der Toolbar Report öffnen, Berichtsanmerkungen ergänzen und die Vorschau aktualisieren. Über Drucken / als PDF speichern entsteht ein Bericht auf weißem A4-Papier. Verschachtelte Daten werden mit Feldpfaden ohne wachsende Einrückung dargestellt.'
      ]
    ]
  ],
  [
    'configuration',
    'Plugins, VPN und Logs',
    [
      [
        'Einstellungen und Defaults',
        'Plugin-Einstellungen trennen globale Konfiguration von Vorgaben für neue Tool-Ausführungen. Quellen und ihre Reihenfolge werden dort festgelegt; Suchprofile können für die konkrete Suche angepasst werden.'
      ],
      [
        'VPN und Warteschlange',
        'OpenVPN- oder WireGuard-Profile in den Einstellungen pflegen. Die Rotation kann zeitgesteuert oder nach einer Tool-Ausführung erfolgen. Bei aktivierter VPN-Nutzung wartet die Warteschlange auf die Verbindung. Der Docker-Host muss die dokumentierten Netzwerkrechte bereitstellen.'
      ],
      [
        'Probleme nachvollziehen',
        'Projekt-Logs zeigen Ausführungen; System-Logs bieten Suche, Export und automatische Aktualisierung. Bei unvollständigen Ergebnissen zuerst Warnungen und Herkunft ansehen. Zugangsdaten gehören in die Plugin-Einstellungen.'
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
        (t(heading) + ' ' + t(body) + ' ' + t(title)).toLowerCase().includes(query.toLowerCase())
      )
    ])
    .filter(([, , items]) => items.length);
  return (
    <main className="help-view content-view">
      <div className="view-heading">
        <div>
          <h1>{t('ui.help')}</h1>
          <p>{t('ui.a_short_guide_to_argus')}</p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ui.search_the_manual')}
          aria-label={t('ui.search_the_manual')}
        />
      </div>
      <div className="help-layout">
        <nav aria-label={t('ui.contents')}>
          {matching.map(([id, title]) => (
            <a key={id} href={'#help-' + id}>
              {t(title)}
            </a>
          ))}
        </nav>
        <article>
          {matching.map(([id, title, items]) => (
            <section key={id} id={'help-' + id}>
              <h2>{t(title)}</h2>
              {items.map(([heading, body]) => (
                <div key={heading}>
                  <h3>{t(heading)}</h3>
                  <p>{t(body)}</p>
                </div>
              ))}
            </section>
          ))}
          {!matching.length && (
            <p>
              <Icon name="search" />
              {t('ui.no_matching_entries')}
            </p>
          )}
        </article>
      </div>
    </main>
  );
}

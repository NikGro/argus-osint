# ARGUS – Architekturreview und Testbefund

Stand: 17. Oktober 2026, v1.0.0-alpha.3

## Urteil

**Nein, ich würde ARGUS mit dem heutigen Funktionsumfang nicht exakt genauso neu bauen.** Die Grundentscheidung für einen modularen Monolithen, Python, SQLite und eine lokale Graph-Oberfläche würde ich beibehalten. Die Verbindung der Frontend-Komponenten, das Rendering, die CSS-Struktur und Teile der Testinfrastruktur würde ich deutlich einfacher und stärker durch überprüfbare Schnittstellen absichern.

Die Revisionen haben stellenweise einfache Aufgaben verkompliziert. Das ist anhand konkreter Strukturen und eines reproduzierten Fehlers belegbar; es ist kein Grund, funktionierende Fachlogik und gespeicherte Projekte wegzuwerfen. Meine Empfehlung ist ein schrittweiser Umbau hinter dem bestehenden Funktions- und UI-Vertrag.

## Umfang und Grenzen

Inventar und Strukturprüfung umfassten 230 Quell-/Konfigurationsdateien, davon 166 Dateien der eigenen Laufzeit. Vertieft geprüft wurden Frontend-Zusammensetzung, Gesten/Rendering, Graph-Validierung, Revisionen/Migrationen, Speicherung, Ergebnisaufbereitung, Warteschlange, Prozessausführung, Dateien/Video, Plugin-Verwaltung, Zugang/CSRF, Geheimnisse, öffentliche Netzwerkzugriffe, isolierte Worker und VPN-Startreihenfolge. Dazu kommen statische Prüfungen, ein vollständiger Linux-Testlauf und Browser-Prüfungen.

Das ist ein Architektur- und Code-Review mit Funktionstests, keine vollständige Prüfung des Quellcodes sämtlicher eingebundener Drittanbieter. Externe Recherche und echte Gesichtsvergleiche wurden nicht gestartet. Videotests verwenden ausschließlich künstliche Bildmuster. Die bestehenden UI-Anforderungen bleiben erhalten.

## Konkrete Befunde

| Priorität | Befund und Beleg | Bedeutung und Maßnahme |
|---|---|---|
| P1 – behoben | `renderViewport` fehlte in zwei Übergaben in `static/main.js`, obwohl `canvas-input.js` und `bindings-canvas.js` es verlangen. Der neue Produktionstest reproduzierte `TypeError: renderViewport is not a function`. | Ursache des ausgefallenen Canvas-Schwenkens/Zoomens. Übergaben korrigiert; Konstruktion prüft jetzt alle deklarierten Callback-Abhängigkeiten. Integrationstests verwenden die tatsächliche Produktions-Zusammensetzung. |
| P1 – behoben | `plugins/video.py` kontrollierte die maximale Größe der erzeugten Datei erst nach dem FFmpeg-Prozess. | Ein Prozess konnte vorher mehr Speicherplatz belegen als versprochen. `plugins/_process.py` überwacht die Ausgabedatei nun während der Ausführung und beendet den Prozess bei Überschreitung. Ein echter Kindprozess-Test deckt das ab. |
| P1 – behoben | `settingsHome()` zeigte die zuvor gerenderte Einstellungsansicht vor Abschluss des neuen API-Abrufs an. | Alte Bedienelemente konnten während des Ladens Änderungen annehmen, bevor frische Daten sie ersetzten. Die Ansicht wird jetzt erst nach dem Laden eingeblendet. Die gezielte Browser-Nachprüfung besteht inklusive Tag-Änderungen und Autosave. |
| P2 – behoben | `server.py` versuchte HTTP-Statuswerte aus dem Präsentationsformat von `log_message()` zu erkennen. Das tatsächliche Standardformat beginnt anders; erfolgreiche GETs wurden mit Status `null` protokolliert. | Ursache unnötiger Leerlauf-Logeinträge. Jetzt wird `log_request(code, size)` direkt ausgewertet. Ein Regressionstest belegt: GET 200/206/304 bleiben ruhig, GET 404 und POST 201 bleiben strukturiert sichtbar. |
| P1 – offen | Fünf historische JavaScript-Testdateien laden `tests/fixtures/frontend-manifest.json`, das nicht mehr existiert. `tests/frontend_source.cjs` versucht zusätzlich, Funktionen mit regulären Ausdrücken aus Quelltext herauszulösen. | Diese Tests liefern keine belastbare Absicherung der heutigen Architektur. Relevante Szenarien auf echte Feature-Imports bzw. Browser-Interaktionen portieren; danach den Quelltext-Extraktor entfernen. Fehlende Tests nicht durch leere Platzhalter oder pauschales Überspringen grün machen. |
| P2 | 37 Frontend-Feature-Factories und rund 360 manuelle Weiterleitungen in einer etwa 700-zeiligen Zusammensetzung. Callback-Namen stehen mehrfach in Metadaten, Destrukturierung und Übergabe. | Die Aufteilung ist teilweise feiner als die tatsächlichen Fachgrenzen. Der Canvas-Fehler zeigt das konkrete Risiko. Bestehende Guards und Vertragstests sind der erste Schritt; als Nächstes typisierte Schnittstellen und größere, fachlich zusammengehörige Module einführen. Nicht automatisch alles über einen globalen Service-Locator verbinden. |
| P2 | `canvas-renderer.js` ersetzt beim vollständigen Rendern sämtliche SVG-Knoten. `history.js` erstellt ganze Dokument-Snapshots; Änderungen übertragen weiterhin große Dokumentteile. | Schwenken/Zoomen ist inzwischen getrennt und deutlich günstiger. Verschieben von Nodes und andere Änderungen bauen aber weiter viel neu auf. Für größere Projekte nach IDs erhaltene Elemente, gezielte Aktualisierungen und zentral gepflegte Node-/Edge-Indizes verwenden. Kein Anlass, dafür die komplette UI neu zu gestalten. |
| P2 | Vier gleichzeitig geladene Stylesheets: 3.182 + 518 + 454 + 198 Zeilen, insgesamt 88 `!important`-Deklarationen. | Revisionsbezogene Korrekturen liegen über älteren Regeln. Das erschwert die Vorhersage von Abständen, Hover- und Disabled-Zuständen. Schrittweise pro Komponente konsolidieren, gemeinsame Maße/Farben als Tokens definieren und danach ersetzte Overrides löschen. Keine fünfte Korrekturschicht hinzufügen. |
| P2 | `server.py` erzeugt beim Import Datenpfade, Services und Hintergrundarbeit; HTTP-Routing und App-Zusammensetzung liegen gemeinsam in rund 800 Zeilen. | Tests und Werkzeuge müssen vor dem Import Umgebungsvariablen setzen und teilen häufig globale Services. Eine explizite App-Factory mit Konfiguration und Start-/Stop-Lebenszyklus würde Isolation und Wartbarkeit verbessern. Dünne Route-Handler sollten nur validieren, Services aufrufen und antworten. Ein Framework-Wechsel ist dafür nicht zwingend. |
| P2 | Große Ablaufmethoden: Instagram-Runner `run` etwa 863 Zeilen, Ergebnisaufbereitung etwa 299, Tool-Ausführung etwa 265. | Unterschiedliche Aufgaben und Sonderfälle sind schwer separat prüfbar. Sammlung, Normalisierung, Ergebnisgruppierung und Persistierung in klar benannte Schritte zerlegen. Die vorhandene Provenienz und Teilfehler-Ausgabe dabei beibehalten. Die Zeilenzahl allein beweist keinen Fehler; die gemischten Verantwortlichkeiten sind das Problem. |
| P2 | Ergebnisse und Tool-Zustände verwenden viele lose Dictionaries und kombinierbare Felder wie `failed`, `error`, `input_request`, `candidates` und `warnings`. | Ein expliziter, typisierter Ergebnisvertrag mit klaren Zuständen reduziert widersprüchliche Antworten. Den Übergang über einen Adapter lösen, damit bestehende Plugins weiter funktionieren. Transport-/Job-Erfolg und fachlicher Tool-Erfolg ausdrücklich unterscheiden. |
| P2 | `Jobs.worker` ist ein Daemon-Thread; unerwartete Fehler außerhalb des eigentlichen Ausführungsblocks können ihn beenden. Der normale Health-Status bestätigt nicht alle einzelnen Fähigkeiten. | Worker-Lebendigkeit und Queue-Fortschritt separat überwachen. Liveness, Datenbankbereitschaft und Fähigkeiten wie Browser/VPN/Community unterscheiden. Wiederanlauf und Umgang mit unterbrochenen Jobs explizit dokumentieren und prüfen; externe Vorgänge nicht blind wiederholen. |
| P2 | Uploads werden vollständig in den Arbeitsspeicher gelesen; das Einzeldateilimit liegt bei 128 MB, HTTP erlaubt bis zu 64 gleichzeitige Verbindungen. | Die theoretische Speicherbelegung mehrerer paralleler Uploads passt nicht zu jeder NAS. Stückweise in eine temporäre Datei schreiben, erst nach Prüfung übernehmen und ein gemeinsames Upload-/Byte-Budget vorsehen. Das ist eine Budgetbetrachtung, kein im Test nachgewiesener Speicherausfall. |
| P2 | Die CPU-Videoverarbeitung nutzt OpenCV/NumPy aus einer Umgebung mit dem Namen `deepface-venv`. | Es wird kein DeepFace-Modell geladen; technisch funktioniert die Wiederverwendung. Als langfristige Abhängigkeit ist sie irreführend und koppelt unabhängige Tools. Beim nächsten geplanten Runtime-Umbau eine kleine, eigene Medien-Umgebung bzw. explizit gemeinsame Bildverarbeitungs-Runtime schaffen. |
| P2 | Übersetzungen verwenden teils vollständige Texte und nachträgliches Ersetzen von Diagnosefragmenten; die Liste wird bei solchen Aufrufen wiederholt sortiert. Versionsangaben stehen in mehreren Dateien. | Stabile Meldungs-IDs mit Parametern und strukturierte Fehlercodes statt Text-Reparatur bevorzugen. Version aus einer Quelle ableiten. Das verbessert Vollständigkeit und reduziert Änderungsfehler; eine sofortige Komplettumstellung aller Sprachpakete wäre unnötig riskant. |
| P2 | Einzelne Laufzeiten sind direkt gepinnt, aber Basis-Image, Systempakete und transitive Pakete sind nicht insgesamt reproduzierbar eingefroren. | Für einen belastbaren Release Build-Manifest, Runtime-Lock/Constraints, Drittanbieter-Nachweise und eine komponentenbezogene Stückliste pflegen. Diese Prüfung hat keine pauschale Aktualisierung aller Abhängigkeiten ausgelöst. |

P1 bezeichnet hier unmittelbar funktions- oder absicherungsrelevante Punkte. P2 bezeichnet wichtige Wartbarkeits-, Betriebs- oder Skalierungsarbeiten; nicht jeder P2-Punkt ist ein gegenwärtiger Benutzerfehler.

## Was ich beibehalten würde

- **Modularer Monolith und eine Installation:** Für eine lokale Desktop-Workbench sind zusätzliche verteilte Dienste kein automatischer Vorteil. Die privilegierten Aufgaben müssen dennoch klar von der unprivilegierten Anwendung getrennt bleiben.
- **SQLite und stabile Graph-IDs:** Transaktionen, Revisionsprüfung, explizite Dokumentmigrationen und Drei-Wege-Abgleich sind brauchbare Grundlagen. Eine Graph-Datenbank oder Event-Sourcing würde ich dafür jetzt nicht einführen.
- **Provenienz und Teilfehler:** Quellen, Ausführungshistorie, erfolgreiche Ergebnisse neben Warnungen und separate Fehler-Nodes sind fachlich sinnvoll.
- **Gebündelte Prozessausführung:** Zeitlimits, Ausgabelimits, Abbruch über Prozessgruppen und die jetzt ergänzte Artefaktbegrenzung sind richtige zentrale Aufgaben.
- **Schutzgrenzen:** Same-Origin-/CSRF- und Host-Prüfungen, verschlüsselte Geheimnisse, gepinnte öffentliche Netzwerkziele und isolierte Community-Ausführung verdienen Erhalt. Ein Review dieser Mechanismen ersetzt keinen echten VPN-Leak-/Tunnelabbruch-Test.
- **Feature-Factories und gemeinsame Geometrie-Spezifikation:** Die Richtung ist richtig. Das Problem ist die Menge manueller Übergaben und die teilweise doppelte Ableitung von Darstellungsdetails, nicht Modularität an sich.

## Wie ich den heutigen Umfang neu aufbauen würde

1. **Expliziter Anwendungskern:** Konfiguration und App-Factory starten Projekte, Dateien, Plugin-Katalog und Job-Service kontrolliert. HTTP bleibt ein dünner Adapter.
2. **Typisierte Verträge:** Graph, Plugin-Aktion, Parameter, Ergebnis und Job-Zustand erhalten eindeutig prüfbare Schnittstellen; im Browser vorzugsweise TypeScript. Eine bestimmte UI-Bibliothek ist hierfür keine Voraussetzung.
3. **Weniger, klare Frontend-Grenzen:** Workspace/Graph, Inspector, Plugin-Verwaltung, Einstellungen und gemeinsame Controls. Keine hunderten unkontrollierten Callback-Übergaben zwischen sehr kleinen Modulen.
4. **Erhaltendes Rendering:** Viewport-Transformation bleibt separat; Node-/Edge-Elemente werden gezielt aktualisiert. Medien-Player und Eingabefokus bleiben dabei erhalten.
5. **Eine Komponentengestaltung:** Gemeinsame Tokens und überschaubare Komponentenregeln; keine Dateinamen nach einzelnen Revisionsrunden.
6. **Überprüfbare Laufzeiten:** Eigene Medienverarbeitung, explizite Fähigkeiten/Readiness und überprüfte Prozess-/Netzwerkgrenzen. Die gewünschte Einzelcontainer-Verteilung bleibt möglich.
7. **Eine nachvollziehbare Testsammlung:** Echte Produktionsmodule und reale Benutzerinteraktionen; keine aus Quelltext ausgeschnittenen Schattenimplementierungen. Schmale Prüfungen zuerst, vollständige Suite gebündelt bei ausdrücklicher Anforderung.

## Empfohlene Reihenfolge

**Jetzt erledigt:** Canvas-Verbindungen korrigiert, Callback-Konstruktion abgesichert, Produktions-Zusammensetzung und echte Gesten getestet, redundante Einträge im Feature-Export entfernt, Video-Artefaktlimit während der Ausführung ergänzt.

Zusätzlich sind das vorzeitige Einblenden alter Einstellungen und die GET-Logfilterung korrigiert. Eine fehlende Unix-Socket-Fähigkeit liefert in der Entwicklungsumgebung jetzt ausdrücklich „VPN nicht verfügbar“ statt HTTP 500. Das erweitert nicht die eigentliche VPN-Unterstützung auf Windows.

**Nächster Stabilisierungsschritt:** Historische Test-Einstiegspunkte portieren; kleine, verbindliche Graph-/Plugin-/Job-Verträge festlegen; Worker-/Fähigkeitsstatus sichtbar machen. Danach CSS komponentenweise konsolidieren.

**Danach, anhand gemessener Engpässe:** Inkrementelles Graph-Rendering, App-Factory und Streaming-Uploads. Lange Collector-/Ergebnisfunktionen jeweils mit ihren bestehenden Tests aufteilen. Migrationen, Projektformat und sichtbare UI dabei erhalten.

Ein kompletter paralleler Neubau würde aktuell mehr Risiko und doppelte Pflege erzeugen. Eine Änderung sollte an einem reproduzierbaren Fehler, einer klaren Verantwortlichkeitsgrenze oder einer Messung begründet sein.

## Testergebnisse

Die abschließenden Zahlen und verbleibenden Testprobleme stehen in der begleitenden Testbilanz. Ein fehlgeschlagener Alt-Test oder ein übersprungener Isolations-Test wird nicht als bestanden gezählt.

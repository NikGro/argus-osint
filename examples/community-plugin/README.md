# Argus Community-Plugin-Vorlage

Diese drei Dateien in den Root eines eigenen öffentlichen GitHub-Repositories kopieren. In Argus: Plugins → Plugins hinzufügen → Community-Repositories verwalten → Repository-Link hinzufügen → Beispiel installieren.

`template.py` enthält `run(action, inputs, params, context)`; die Repository-Liste beschreibt Eingabetypen, Aktionen, Standardparameter und optionale Eingabedialoge. Nach jeder Codeänderung `sha256sum template.py` ausführen und die Prüfsumme im Manifest aktualisieren. Die Installation übernimmt den festgelegten Commit und prüft den SHA-256-Hash.

Eingabetypen: url, email, username, phone, location, image, file, value, datetime, note oder * für alle Datenknoten. Ausgabe: `outputs` mit type, label und data; optional source_input, source, relation und group. Jede einzelne Angabe erhält einen eigenen Value-Node mit `data: {"value": "…"}`. Mindestens zwei Ausgaben gleicher group werden gruppiert. `group_outputs: false` deaktiviert automatische Gruppen. Bestehende Knoten können über `updates: [{id, data, evidence}]` ergänzt werden.

Dateien: `context['resolve_file'](file_id)` liefert ausschließlich Pfade zu hochgeladenen Dateien der übergebenen Datei-/Bild-Eingaben. Diese Originale nur lesen. Temporäre Berichte im Arbeitsverzeichnis erzeugen. Der Prozess läuft als nicht privilegierter Containerbenutzer, mit Zeit-, Speicher- und Ausgabelimits; er ist keine vollständige Sicherheits-Sandbox. Nur vertrauenswürdigen Code installieren.

Manuelle Eingabe: `input_prompt` in einer Aktion öffnet vor dem Lauf ein modales Formular. Laufzeitabhängig kann `run()` stattdessen `{"outputs": [], "input_request": {"title": "…", "fields": [{"key": "parameter", "label": "…", "type": "text", "required": true}]}}` zurückgeben. Argus pausiert die Warteschlange, speichert die Antwort als Aktorparameter und führt denselben Aktor erneut aus. Deshalb Eingaben prüfen, bevor externe Nebenwirkungen ausgelöst werden. Abbrechen beendet die Fortsetzung; der Aktor kann später erneut gestartet werden.

Mehrere Quellen: Im Aktor-default_params `use_quellenname: true` und `source_order: ["quellenname", "andere"]` angeben. Die Oberfläche erzeugt Schalter und die sortierbare Quellenliste. Das Plugin muss die Reihenfolge in run selbst nacheinander abarbeiten. Quellenpriorität und Schalter sind globale Plugin-Einstellungen; andere Parameter können pro Aktor überschrieben werden.

Neue Plugins benötigen keine Abhängigkeit von anderen Plugins. Frontend-Daten bleiben typisiert; plugininterne JSON-Strukturen bleiben im Backend und in der Herkunft.

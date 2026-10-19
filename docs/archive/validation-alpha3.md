# ARGUS – Testbilanz v1.0.0-alpha.3

17. Oktober 2026

## Ergebnis

Der Canvas-Fehler wurde reproduziert, behoben und mit echten Browser-Gesten geprüft. Der vollständige Linux-Lauf wurde einmal ausgeführt. Anschließend wurden nur betroffene Prüfungen gezielt wiederholt.

| Prüfung | Ergebnis |
|---|---|
| Vollständige Python-Suite im Linux-Image | **205 Tests: 199 bestanden, 4 übersprungen, 2 fehlgeschlagen.** Die zwei Fehler sind zwei Aufrufe desselben alten Browser-Skripts. |
| Gezielte Nachprüfung dieses Browser-Skripts nach Korrekturen | **10/10 Abläufe bestanden**, keine unerwarteten Konsolenfehler. Lokal mit echtem Chrome und temporärem Backend ausgeführt. Der gesamte Linux-Lauf wurde danach nicht erneut gestartet. |
| Aktuelle Frontend-Vertragstests gegen das Produktions-Bundle | **21 bestanden, 0 fehlgeschlagen.** Einschließlich echter App-Zusammensetzung, Callback-Ziele, Viewport-Zoom und Verhalten bei fehlgeschlagenem Laden der Einstellungen. |
| Gerenderte Canvas-/UI-Prüfung | Bestanden, einschließlich Mausrad-Schwenken, Strg-Mausrad-Zoom, Leertaste-Ziehen, Auswahl, Dialogen, Plugin-Ansicht und Einstellungen. |
| Zusätzlicher UI-Ansichten-Lauf | **9 Prüfabschnitte bestanden**, darunter Tastaturbedienung, Fokus, Toolbar, Logs, Report und Plugin-Zustände. |
| Neue Videoprüfungen im Linux-Lauf | Zuschnitt mit Originalerhalt, CPU-Fusion mit Ausrichtungsnachweis, ungültige Intervalle/Frame-Limits, ungültige Videodatei, HTTP-Byte-Ranges und Prozess-Abbruch bei überschrittenem Artefaktbudget bestanden. |
| Gezielte HTTP-Logging-/Fähigkeitstests nach den letzten Korrekturen | **2 bestanden.** Erfolgreiche GETs werden ausgefiltert; Fehler/Mutationen korrekt protokolliert. Fehlende Unix-Sockets werden als nicht verfügbare VPN-Fähigkeit gemeldet. |
| Breiter JavaScript-Lauf inklusive historischer Einstiegspunkte | Beim Inventarlauf **20 bestanden, 5 fehlgeschlagene Alt-Einstiegspunkte**. Diese fünf scheitern vor ihren eigentlichen Tests an der fehlenden `tests/fixtures/frontend-manifest.json`. Die aktuellen Tests wurden danach um einen weiteren Vertragstest ergänzt und bestehen nun zu 21. |
| ESLint des Frontends | Bestanden. |
| Ruff des Produktionscodes | Bestanden. Der repo-weite Inventarlauf findet zusätzlich Stil-/Import-Altlasten in Wartungsskripten und älteren Tests. |
| Prettier-Gesamtprüfung | Eine bestehende Formatabweichung in `static/app/history.js`; keine Funktionsprüfung und kein Produktionsfehler. |
| Produktions-Bundle/Manifest und Container-Build | Geprüft; die abschließende aktualisierte Fassung wird als Alpha 3 bereitgestellt. |

## Welche zehn Browser-Abläufe geprüft wurden

1. Globale Tags erstellen und automatisch speichern.
2. Sprache per suchbarer Auswahl ändern.
3. Node-Verifizierung, Tags und Autosave.
4. Verbindungen auswählen, hervorheben und ihre Aktionen anzeigen.
5. Daten mit Konfliktdialog zusammenführen; Original-Nodes erhalten.
6. Seitenleisten und Quick Actions.
7. Kategorie-/Alphabet-Sortierung.
8. Tags umbenennen, färben und löschen; Projekt erneut öffnen.
9. Gruppen auflösen bzw. Nodes herausnehmen, ohne Inhalte zu löschen.
10. Instagram-Hinweis/Einstellungen und Geheimnismaskierung mit künstlichen Zugangswerten, **ohne Anmeldung oder Recherche**.

## Was weiterhin offen ist

- Vier Tests benötigen den isolierten Browser-/Community-Worker. Die vorhandene NAS-Startkonfiguration aktiviert dessen benötigte Namespace-Rechte nicht. Diese Tests wurden ausdrücklich übersprungen und sind nicht als bestanden gezählt.
- Ein echter VPN-Tunnel, DNS-/IPv6-Leaks und ein absichtlicher Tunnelabbruch wurden mangels freigegebener Provider-Konfiguration und aktivierter Host-Fähigkeiten nicht live geprüft.
- Fünf historische JavaScript-Einstiegspunkte müssen auf die heutigen Produktionsmodule portiert werden. Der fehlende Quelltext-Extraktor wird nicht mit leeren Dateien kaschiert.
- Die gezielt reparierte Browser-Prüfung wurde nicht noch einmal durch zwei vollständige Linux-Suiten geschickt. Beim nächsten ausdrücklich angeforderten Gesamtlauf müssen beide Linux-Aufrufe bestätigt werden.
- Der Test ist keine Garantie für jeden externen Anbieter, Codec oder jede Graph-Größe. Es gab keine echte Personenrecherche und keine Gesichtsmodell-Inferenz.

**Einordnung:** Die geprüften aktuellen Funktionen und der Canvas-Fix sind abgesichert. Die gesamte historische Testsammlung ist wegen der genannten Altlasten und fehlenden Host-Fähigkeiten noch nicht vollständig grün.

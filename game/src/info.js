// Plan v4 (Esc-Menue): Version, Versionsliste, Impressum, Datenschutz.
// Impressum/Datenschutz: aus den Vorlagen vendor/leyonet/website/httpdocs/{impressum,datenschutz}.vorlage.html
// uebernommen (User-Entscheid 2026-11-20). Angaben vom User (2026-11-24) -
// hier werden KEINE Adressdaten erfunden. Der DC-Abschnitt beschreibt nur, was dieses Spiel wirklich speichert.

export const VERSION = '1.1.0';

/** Versionsliste (neueste zuerst) */
export const CHANGES = [
  { v: '1.1.0', date: '2026-11-24', items: ['Admin-Board: Statistik mit Spielern, Spielstarts, Levels, Verbundaufgaben und Klassen'] },
  { v: '1.0.0', date: '2026-11-24', items: ['Erste vollständige Version: 7 Levels, 5 Verbundaufgaben, Klassen mit Admin-Board, Spielstände', 'Lizenz- und Urheberangaben im Spiel, Aufräumen des Quelltexts', 'Startbildschirm: Projekt unterstützen'] },
  { v: '0.0.15', date: '2026-11-24', items: ['Zurück-Knöpfe: von der Level-Auswahl zum Startbildschirm, vom Level-Start zur Auswahl'] },
  { v: '0.0.14', date: '2026-11-24', items: ['ping an der Konsole von Router, Core-Switch und Firewall zeigt das Ergebnis', 'show an der Konsole zeigt den laufenden Zustand: gelernte Routen (OSPF, BGP), Nachbarn, DHCP-Adressen'] },
  { v: '0.0.13', date: '2026-11-24', items: ['Spielstände: mit Klasse auf dem Server, sonst oder wenn zu gross als Datei; jederzeit wieder öffnen', 'Willkommensmenü und Hilfe',
    'Einstellungen: Tasten frei belegen, Grafikqualität, FPS-Anzeige, Tastenhinweise ein/aus', 'Freies Bauen mit unbegrenztem Budget braucht einen Zugangscode'] },
  { v: '0.0.12', date: '2026-11-23', items: ['Verbundaufgaben: fünf gemeinsame Aufgaben (★ bis ★★★★★), freigegeben von der Lehrperson; jeder Platz baut einen Standort mit eigenen Adressen (Taste J)',
    'Dashboard für den Beamer und Abnahme im Admin-Board', 'Notebook-Terminal: curl'] },
  { v: '0.0.11', date: '2026-11-23', items: ['Kabel über den Racks sind angeschlossen: jedes Rack hat zwei Zuleitungen vom Abgangskasten durchs Dach bis zur PDU', 'Trunks reichen bis ins Patchpanel', 'Racks und Geräte besser lesbar (mehr Umgebungslicht)'] },
  { v: '0.0.10', date: '2026-11-23', items: ['Graffiti an den Wänden mit dem gesprayten ly', 'Weniger Zeichenaufrufe: der Raum läuft auf schwächeren Geräten flüssiger'] },
  { v: '0.0.9', date: '2026-11-23', items: ['Klassen mit Pseudonymen und Admin-Board für Lehrpersonen (wenn der Server läuft)', 'Speedrun-Timer mit Bestzeiten, ein- und ausschaltbar (T)', 'Level neu starten im Menü', 'Minikarte läuft auch beim Sprinten flüssig'] },
  { v: '0.0.8', date: '2026-11-23', items: ['Grosses Pult mit 19-Zoll-Gestell: Geräte vorkonfigurieren, die Konfiguration bleibt beim Umbau ins Rack',
    'Steckdosenleiste am Pult, Stromleiste 1 HE im Shop', 'Tischdose mit 8 Ports: Leitung über die Decke auf ein Patchpanel nach Wahl',
    'Trunks laufen über die Gitterrinnen statt unter dem Boden'] },
  { v: '0.0.7', date: '2026-11-23', items: ['Neuer Auftritt im Stil von leyonet.ch', 'Netzplan (N) und Minikarte (M): zeichnet mit, was gebaut wird',
    'Bildschirm an der Wand zeigt das Projekt live, wie in leyoNET', 'Lichtschalter neben der Tür', 'Steuerung per Touch (iPad)', 'Level starten: selbst aufbauen oder fertig aufgebaut',
    'Über leyoNET DC, Quellen und Lizenzen, geprüft vom Herkunfts-Bot'] },
  { v: '0.0.6', date: '2026-11-20', items: ['Esc-Menü mit Version, Impressum und Datenschutz', 'Zoom mit der rechten Maustaste',
    'Mit dem Stuhl am Pult entlangrollen (A/D)', 'Lichtschalter', 'Strom für KVM-Konsole und Server (Netzteil-Buchse)', 'leyoNET-Favicon'] },
  { v: '0.0.5', date: '2026-11-20', items: ['Bauen statt Vorfinden: Racks, Geräte und Notebooks kaufen und einbauen',
    'Raum v3: 8 × 6 m mit Glasfront, 8 Rack-Plätze, Pult mit Stuhl', 'Trunk zwischen Racks, Sandbox und Demo-Rechenzentrum',
    'Realismus: schwarze Racks, Kabeltrassen, helle Lochplatten'] },
  { v: '0.0.4', date: '2026-11-20', items: ['Erste Version auf dev-dc.leyonet.ch', 'Detailliertes Notebook', 'Inventar wählbar'] },
  { v: '0.0.3', date: '2026-11-19', items: ['Router, Firewall, Glasfaser mit SFP-Modulen, KVM, Core-Switch', 'Strom per PDU', 'Levels 4–7'] },
  { v: '0.0.2', date: '2026-11-19', items: ['leyoNET-Simulationskern eingebunden', 'Notebooks mit Netzwerk und Terminal, Konsole, Shop', 'Levels 1–3'] },
  { v: '0.0.1', date: '2026-11-19', items: ['Serverraum mit Rack im Browser', 'Ports anwählen und Kabel stecken'] },
];

export const LINKS = {
  entwickler: 'https://vonam.ch', projekt: 'https://leyonet.ch', patreon: 'https://patreon.com/leyonet', quelltext: 'https://github.com/vonam-git/leyoNET-DC',
};

const P = (t) => ({ p: t });
const H = (t) => ({ h: t });

export const UEBER = [
  H('Entwickelt von Mark v. A. · vonam.ch'),
  P('Mit Hilfe von KI. Die Ideen, der Unterricht und das letzte Wort kommen von Mark. Die KI (Claude von Anthropic) hat '
    + 'Racks geschraubt, Kabel gebogen und Switches angemalt. Sie hat dabei kein einziges Kabel verknotet und nie nach Kaffee gefragt.'),
  P('Wenn trotzdem etwas nicht läuft: zuerst Layer 1 prüfen (steckt das Kabel?), dann Layer 8 (das sind wir). '
    + 'Beides lässt sich per E-Mail melden, die Adresse steht im Impressum.'),
  H('Unter der Haube'),
  P('Jeder Ping, jedes VLAN und jede Befehlszeile läuft im echten leyoNET-Simulationskern. Das Rechenzentrum drumherum ist nur die schönere Zeichenfläche.'),
  H('Lizenz'),
  P('leyoNET DC, Copyright © 2026 Mark v. A. Freie Software unter der GNU Affero General Public License, Version 3 oder neuer (AGPL-3.0-or-later), '
    + 'ohne jede Gewährleistung. Du darfst sie unter diesen Bedingungen weitergeben und verändern; den Quelltext findest du unten unter «Quelltext». '
    + 'Der Name leyoNET und das Logo sind ausgenommen.'),
  H('Woher kommt was?'),
  P('Das prüft ein Bot bei jeder Änderung: Herkunft und Lizenz von Software, Texturen und Modellen. Was er nicht kennt, kommt nicht ins Spiel. '
    + 'Seine Liste steht im Reiter «Quellen».'),
];

export const IMPRESSUM = [
  H('Verantwortlich für den Inhalt'),
  P('Mark v. A.\n4944 Auswil\nSchweiz\nE-Mail: info(at)leyonet.ch'),
  H('Kontakt'),
  P('Fragen zum Einsatz im Unterricht, Musterlösungen für Lehrpersonen, Fehler oder Ideen: am einfachsten per E-Mail an die Adresse oben.'),
  H('Projekt'),
  P('leyoNET ist ein nicht kommerzielles Projekt von Mark und Mika für den Informatik-Unterricht. Das Programm ist kostenlos und '
    + 'quelloffen unter der Lizenz GNU AGPL 3.0 oder neuer. Der Quellcode liegt auf GitHub. leyoNET DC ist das 3D-Rechenzentrum '
    + 'dazu und steht ebenfalls unter der AGPL 3.0 oder neuer.'),
  P('Der Name «leyoNET» und das Logo sind von der Lizenz ausgenommen und dürfen nicht für abgeleitete Programme verwendet werden.'),
  H('Gewährleistung'),
  P('leyoNET wird kostenlos und ohne jede Gewährleistung zur Verfügung gestellt, wie es die Lizenz GNU AGPL in den Abschnitten '
    + '15 und 16 festhält, soweit das Gesetz dies zulässt.'),
  H('Haftung'),
  P('leyoNET ist ein Lernwerkzeug. Es bildet Netzwerke vereinfacht nach und ersetzt keine Planung oder Prüfung echter Netze. '
    + 'Die Inhalte werden sorgfältig erstellt; für Richtigkeit, Vollständigkeit und Aktualität wird keine Gewähr übernommen. '
    + 'Für Inhalte verlinkter Seiten sind deren Betreiber verantwortlich.'),
  H('3D-Modelle und Texturen'),
  P('Texturen von ambientCG (CC0). Alle Modelle sind für dieses Projekt erstellt.'),
];

export const DATENSCHUTZ = [
  P('Kurz gesagt: leyoNET DC setzt keine Cookies, verwendet keine Analyse- oder Werbedienste und lädt nichts von fremden '
    + 'Servern, auch keine Schriften. Es gilt das Schweizer Datenschutzgesetz (revDSG) und, soweit anwendbar, die DSGVO.'),
  H('Verantwortlich'),
  P('Mark v. A.\n4944 Auswil, Schweiz\ninfo(at)leyonet.ch'),
  H('Aufruf der Seite'),
  P('Beim Aufruf jeder Website übermittelt der Browser technisch bedingt Angaben an den Webserver, darunter die IP-Adresse, '
    + 'Datum und Uhrzeit, die aufgerufene Seite und die Browserkennung. Der Webserver unseres Hosting-Anbieters speichert diese '
    + 'Angaben in Protokolldateien, um den Betrieb und die Sicherheit zu gewährleisten. Sie werden nach 7 Tagen gelöscht und nicht '
    + 'mit anderen Daten zusammengeführt.'),
  P('Der Server steht im Rechenzentrum der Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, in Deutschland. '
    + 'Hosting-Anbieter und Rechenzentrum bearbeiten die Daten nur in unserem Auftrag und nur, soweit es für den Betrieb nötig '
    + 'ist. Deutschland bietet einen dem Schweizer Recht gleichwertigen Datenschutz.'),
  H('Das Spiel'),
  P('Das Spiel läuft vollständig in deinem Browser, auch der Netzwerk-Simulator. Es gibt kein Konto und keinen Namen. '
    + 'Ohne Klasse werden nur deine geschafften Levels, deine Bestzeiten und ob der Timer eingeschaltet ist gespeichert – im Speicher deines '
    + 'Browsers (localStorage, Einträge «leyonet-dc.won», «leyonet-dc.best», «leyonet-dc.timer», «leyonet-dc.settings» mit Tasten und Grafik, «leyonet-dc.frei» nach dem '
    + 'Freischalten), nicht auf dem Server. Ein als Datei gespeicherter Spielstand liegt nur bei dir. Du kannst sie jederzeit '
    + 'über die Browser-Einstellungen löschen.'),
  H('Klassen'),
  P('Wer mit einem Klassencode beitritt, erhält vom Server ein zufälliges Pseudonym; einen Namen kann man nicht eingeben. Gespeichert werden '
    + 'Pseudonym, Klassenbezeichnung, bestätigte Levels mit Bestzeit, Anzahl und Datum sowie Prüfsummen der Zugangscodes. Welche Person hinter einem '
    + 'Pseudonym steckt, weiss nur die Lehrperson; der Server erfährt es nicht. Zum Bestätigen schickt das Spiel die Spielschritte eines Levels an den '
    + 'Server; er prüft sie und behält sie nicht (ausser in einem Spielstand, den du selbst speicherst). Bitte in der Simulation keine echten Passwörter verwenden.'),
  P('Die Lehrperson sieht, wer online ist, welches Level läuft und wie viele Ziele erreicht sind, und kann deinen Netzplan live ansehen. Das Spiel zeigt '
    + 'an, solange jemand zuschaut. Der Live-Stand liegt nur im Arbeitsspeicher.'),
  P('Statistik: Der Server zählt, wie oft das Spiel geladen wird, wie viele beitreten, wie viele Levels und Abnahmen bestanden werden und wie viele gleichzeitig '
    + 'online sind. Das sind reine Zahlen je Tag (400 Tage) ohne Bezug zu einer Person; auch wer ohne Klasse spielt, wird nur so mitgezählt.'),
  P('Der Server speichert keine IP-Adressen und setzt keine Cookies. Gegen Missbrauch zählt er Anfragen mit einem gesalzenen Hash der Adresse, nur kurz im '
    + 'Arbeitsspeicher. Im Browser liegen dein Zugang und dein eigener Code (localStorage, «leyonet-dc.klasse»), bis du dich abmeldest.'),
  P('Verbundaufgaben: Gibt die Lehrperson eine Verbundaufgabe frei und beginnst du sie, schickt das Spiel deine Spielschritte laufend an den Server, '
    + 'damit er deinen Standort nachspielen und im Verbund der Klasse prüfen kann. Die Lehrperson sieht Stufe, Ziele und Netzplan deines Standorts (auch auf '
    + 'einem Beamer, mit deinem Pseudonym). Schritte und Netze liegen nur im Arbeitsspeicher und werden spätestens nach 24 Stunden oder mit einem Neustart '
    + 'gelöscht. Gespeichert werden deine Platznummer und das Ergebnis einer Abnahme (erfüllte und fehlende Ziele, Zeit, Datum).'),
  P('Spielstände: Speicherst du in einer Klasse einen Spielstand, liegen Level, Spielschritte, Position und Zeit verschlüsselt auf dem Server, höchstens '
    + 'fünf Stück, verknüpft mit deinem Pseudonym. Du kannst sie einzeln löschen; sonst werden sie mit dem Pseudonym gelöscht.'),
  P('Löschung: jederzeit selbst mit «Klasse verlassen und Daten löschen», sonst automatisch drei Monate nach dem eingestellten Semesterende. Das '
    + 'Protokoll der Lehrpersonen-Aktionen (Konto, Aktion, Klasse oder Pseudonym) wird nach zwei Jahren gelöscht.'),
  H('Links'),
  P('Erst ein Klick auf «Quelltext» verbindet den Browser mit GitHub (GitHub Inc., USA), ein Klick auf «Unterstützen» oder «Projekt unterstützen» mit Patreon '
    + '(Patreon Inc., USA) und ein Klick auf «vonam.ch» oder «leyonet.ch» mit diesen Seiten. Die angeklickte Seite erhält dabei technisch '
    + 'bedingt die IP-Adresse und die Browserkennung, und es gelten ihre eigenen Datenschutzbestimmungen. Eingebunden wird nichts davon.'),
];

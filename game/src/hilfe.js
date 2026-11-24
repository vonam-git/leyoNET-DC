// Texte: Willkommen + Hilfe. {aktion} wird durch die aktuelle Taste ersetzt (settings.fill).
const H = (h) => ({ h });
const P = (p) => ({ p });

export const WILLKOMMEN = {
  titel: 'Datacenter Simulator leyoNET',
  lead: 'DC steht für Datacenter, auf Deutsch Rechenzentrum: der Raum, in dem die Server und Netzwerkgeräte stehen, über die Websites, Schulplattformen und Chats laufen.',
  text: 'Hier baust du so einen Raum selbst. Du kaufst Racks, Switches, Router und Kabel, baust alles ein, schliesst den Strom an und konfigurierst die Geräte wie in echt. '
    + 'Ob dein Netz funktioniert, entscheidet der leyoNET-Simulationskern: Jeder Ping und jedes VLAN wird wirklich gerechnet.',
  schritte: ['Level wählen. Level 1 braucht nur zwei Notebooks und ein Kabel.', 'In den Raum klicken: Die Maus schaut jetzt um dich herum, mit {forward} {left} {back} {right} gehst du.',
    'Mit {shop} einkaufen, mit {use} oder Linksklick einbauen und einstecken.', 'Links oben stehen die Ziele. Esc öffnet jederzeit das Menü mit Speichern, Einstellungen und Hilfe.'],
  hinweis: 'Unten im Bild zeigt eine Leiste die wichtigsten Tasten. Sie lässt sich mit {hints} aus- und wieder einblenden. Was {use} gerade tun würde, steht immer beim Fadenkreuz.',
  touch: 'Auf dem Tablet: links mit dem Daumen gehen, rechts wischen zum Umsehen, antippen zum Benutzen.',
};

export const HILFE = {
  Start: [
    H('Worum geht es?'), P('Jedes Level gibt dir einen Raum, ein Budget und Ziele. Wenn alle Ziele abgehakt sind, ist das Level geschafft. Wie du dorthin kommst, ist dir überlassen.'),
    H('Bewegen'), P('{forward} {left} {back} {right} gehen, {run} rennen, {crouch} ducken. Rechte Maustaste halten: zoomen. Esc gibt die Maus frei und öffnet das Menü.'),
    H('Selbst oder fertig aufgebaut?'), P('«Selbst aufbauen» beginnt im leeren Raum. Bei «Fertig aufgebaut» stehen die Geräte schon, du verkabelst und konfigurierst.'),
  ],
  Bauen: [
    H('Einkaufen und einbauen'), P('{shop} öffnet den Shop. Gekauftes liegt unten in der Leiste: mit 1–9 oder dem Mausrad in die Hand nehmen, oder mit {inventory} auswählen. '
      + 'Dann einen Rack-Platz, eine Höheneinheit oder den Tisch anvisieren. Grün heisst: passt. {use} oder Linksklick baut ein.'),
    H('Ausbauen'), P('{remove} baut aus, sobald kein Kabel mehr steckt. Das Gerät kommt ins Inventar und behält seine Konfiguration.'),
    H('Kabel'), P('Port anvisieren, {use}, zweiten Port anvisieren, {use}. {cancel} bricht ab. Nochmals {use} auf einen belegten Port zieht das Kabel ab. Auf «Auto» nimmt das Spiel das kürzeste passende Kabel.'),
    H('Strom'), P('Switch, Router, Firewall, KVM und Server brauchen ein Stromkabel von einer Steckdose der PDU (hinten im Rack) zum Netzteil. Notebooks haben einen Akku und werden am Bildschirm eingeschaltet.'),
    H('Glasfaser'), P('Zuerst auf beiden Seiten das gleiche SFP-Modul einsetzen, dann das Glasfaserkabel stecken.'),
  ],
  Konfigurieren: [
    H('Notebook'), P('{use} auf den Bildschirm. «Netzwerk» setzt IP-Adresse, Maske und Gateway, «Terminal» kennt ping, ssh und curl.'),
    H('Konsole'), P('Konsolkabel vom Notebook (USB) zum CON-Port stecken, dann am Notebook den Reiter «Konsole» öffnen. Eine KVM im Rack geht auch ohne Konsolkabel.'),
    H('Befehlszeile'), P('enable, dann configure terminal. Mit ? siehst du, was möglich ist, Tab ergänzt angefangene Wörter. Mit write speicherst du die Konfiguration im Gerät.'),
    H('Es geht nicht?'), P('Von unten nach oben prüfen: Hat das Gerät Strom? Leuchtet die LED am Port? Stimmen IP-Adresse und Maske? Stimmen VLAN und Gateway? Der Netzplan ({plan}) zeigt alle Verbindungen.'),
  ],
  Spielstand: [
    H('Speichern'), P('Im Menü (Esc) «Spielstand speichern». Mit Klasse liegt er auf dem Server, bis zu fünf Stück. Ohne Klasse, ohne Server oder wenn er zu gross ist (über 128 KB), wird er als Datei heruntergeladen.'),
    H('Öffnen'), P('Im Willkommensmenü oder im Menü «Spielstand öffnen». Alles wird wieder aufgebaut, wie du es verlassen hast; offene Konsolen musst du neu öffnen.'),
    H('Was zählt?'), P('Aus einem Spielstand gibt es keine Bestzeit, denn in der Pause steht die Uhr still. In einer Klasse zählt ein Level aus einem Server-Spielstand als geschafft, aus einer Datei nicht.'),
    H('Verbundaufgaben'), P('Die musst du nicht speichern: Sie liegen laufend auf dem Server.'),
  ],
  Grafik: [
    H('Es ruckelt'), P('Einstellungen → Grafik → «Niedrig». Dort siehst du auch, wie viele Bilder pro Sekunde (FPS) dein Gerät gerade schafft. Ab etwa 30 spielt es sich angenehm.'),
    H('FPS anzeigen'), P('Der Schalter «FPS im Spiel anzeigen» blendet die Zahl dauernd ein.'),
    H('Tastenhinweise'), P('{hints} blendet die Leiste unten aus und wieder ein. Andere Tasten kannst du unter Einstellungen → Tasten wählen.'),
  ],
};

export const FREI = {
  titel: 'Freies Bauen',
  text: 'Freies Bauen mit unbegrenztem Budget gibt es auch: kein Ziel, kein Limit, dein eigenes Rechenzentrum. Dafür braucht es einen Zugangscode.',
  woher: 'Wer leyoNET auf Patreon unterstützt, kann dort nach dem Code fragen. Die Levels 1–7 und die Verbundaufgaben bleiben für alle kostenlos.',
};

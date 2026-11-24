// Level (Plan v3, 2026-11-20): Der Raum startet LEER - Racks, Geraete und Notebooks werden im Shop
// (Taste B) gekauft und eingebaut (Artikel in die Hand nehmen, Platz/HE anvisieren, E/Klick).
// Jedes Level ist ein Szenario fuer den Kern (docs/SCENARIO_API.md Kap. 5): Katalog + Budget, Dosen
// hinter dem Patchpanel, Ziele. Kern-IDs vergibt der Kern beim Einbau in Einbau-Reihenfolge je Rolle:
// erster Switch = sw1, erstes Patchpanel = pp1, erstes Notebook = nb1, Router rt1, Firewall fw1,
// Core-Switch cs1, KVM kvm1; jedes Rack bringt 2 PDUs mit (pdu1 = links, pdu2 = rechts im ersten Rack).
// Netzgeraete brauchen Strom: Stromkabel von einer PDU-Steckdose an das Netzteil (PSU).
// `bauplan`: empfohlener Aufbau (Tests kaufen + bauen ihn; das Budget muss reichen).

// Katalog (CHF; leyoNET-Richtpreise model/costs.ts: Patchkabel tp = 8, Rack 900, Switch 120 + 24 x 20 + 4 x 25,
// L3-Switch 900 + 24 x 50 + 4 x 40, Router 300 + 4 x 60, Firewall 650 + 4 x 40, Notebook 950, Server 2800)
const HARDWARE_KATALOG = [
  { item: 'rack-42he', name: 'Serverschrank 42 HE (mit 2 PDUs)', kurz: 'Rack', typ: 'rack', vorlage: 'kit_rack', farbe: '#6b7078', preis: 900 },
  { item: 'switch-24', name: 'Switch 24 Port + 4 SFP', kurz: 'Switch', typ: 'geraet', vorlage: 'kit_switch', he: 1, farbe: '#3d7bd9', preis: 700 },
  { item: 'coreswitch-24', name: 'Core-Switch Layer 3 (24 + 4 SFP)', kurz: 'Core-Switch', typ: 'geraet', vorlage: 'kit_coreswitch', he: 1, farbe: '#b4530a', preis: 2260 },
  { item: 'patchpanel-24', name: 'Patchpanel 24 Port (Cat 6)', kurz: 'Patchpanel', typ: 'geraet', vorlage: 'kit_patchpanel', he: 1, farbe: '#c9ced6', preis: 80 },
  { item: 'router-4', name: 'Router 4 × Ethernet', kurz: 'Router', typ: 'geraet', vorlage: 'kit_router', he: 1, farbe: '#d98a3d', preis: 540 },
  { item: 'firewall-4', name: 'Firewall WAN/LAN/DMZ/OPT', kurz: 'Firewall', typ: 'geraet', vorlage: 'kit_firewall', he: 1, farbe: '#d9443d', preis: 810 },
  { item: 'kvm-1u', name: 'KVM-Konsole 1 HE (Konsolserver)', kurz: 'KVM', typ: 'geraet', vorlage: 'kit_kvm', he: 1, farbe: '#8a6fd9', preis: 650 },
  { item: 'server-1u', name: 'Server 1 HE', kurz: 'Server', typ: 'geraet', vorlage: 'kit_server', he: 1, farbe: '#9aa3ad', preis: 2800 },
  { item: 'blank-1u', name: 'Blindplatte 1 HE', kurz: 'Blind 1 HE', typ: 'geraet', vorlage: 'kit_blank_1u', he: 1, farbe: '#2b2e33', preis: 8 },
  { item: 'blank-2u', name: 'Blindplatte 2 HE', kurz: 'Blind 2 HE', typ: 'geraet', vorlage: 'kit_blank_2u', he: 2, farbe: '#2b2e33', preis: 12 },
  { item: 'pdu-1u', name: 'Stromleiste 1 HE (8 × C13)', kurz: 'Stromleiste', typ: 'geraet', vorlage: 'kit_pdu_1u', he: 1, farbe: '#c0262d', preis: 90 },
  { item: 'trunk-cat6-24', name: 'Trunk-Kabel 24 × Cat 6 (Rack ↔ Rack, über die Gitterrinne)', kurz: 'Trunk', typ: 'trunk', klasse: 'trunk', farbe: '#1f4fa8', farbe_name: 'blau', preis: 180 },
  { item: 'notebook', name: 'Notebook (Admin/Client)', kurz: 'Notebook', typ: 'notebook', vorlage: 'kit_notebook', farbe: '#4a4f58', preis: 950 },
];

// Katalog (CHF; Patchkabel: leyoNET-Richtpreis tp = 8, Konsolkabel nicht im leyoNET-Katalog -> 15)
const KABEL_KATALOG = [
  { item: 'patch-cat6-0.25-blau', name: 'Patchkabel 0.25 m blau', typ: 'patchkabel', klasse: 'copper', laenge: 0.25, farbe: '#1f5fd1', farbe_name: 'blau', preis: 6 },
  { item: 'patch-cat6-0.5-blau', name: 'Patchkabel 0.5 m blau', typ: 'patchkabel', klasse: 'copper', laenge: 0.5, farbe: '#1f5fd1', farbe_name: 'blau', preis: 7 },
  { item: 'patch-cat6-1.0-gelb', name: 'Patchkabel 1 m gelb', typ: 'patchkabel', klasse: 'copper', laenge: 1.0, farbe: '#e0b21a', farbe_name: 'gelb', preis: 8 },
  { item: 'patch-cat6-2.0-gruen', name: 'Patchkabel 2 m grün', typ: 'patchkabel', klasse: 'copper', laenge: 2.0, farbe: '#2e9b46', farbe_name: 'grün', preis: 10 },
  { item: 'patch-cat6-3.0-grau', name: 'Patchkabel 3 m grau', typ: 'patchkabel', klasse: 'copper', laenge: 3.0, farbe: '#8a8f96', farbe_name: 'grau', preis: 12 },
  { item: 'patch-cat6-5.0-grau', name: 'Patchkabel 5 m grau', typ: 'patchkabel', klasse: 'copper', laenge: 5.0, farbe: '#8a8f96', farbe_name: 'grau', preis: 15 },
  // Glasfaser: SFP-Module (leyoNET-Richtpreise sfp) und LC-LC-Duplexkabel (leyoNET cable fiber = 25)
  { item: 'sfp-1g-sx', name: 'SFP-Modul 1G-SX (Multimode)', typ: 'sfp', modul: '1G-SX', klasse: 'modul', farbe: '#2b2b2b', farbe_name: 'schwarz', preis: 35 },
  { item: 'sfp-1g-lx', name: 'SFP-Modul 1G-LX (Singlemode)', typ: 'sfp', modul: '1G-LX', klasse: 'modul', farbe: '#2f6fd6', farbe_name: 'blau', preis: 60 },
  { item: 'lwl-om3-1.0', name: 'Glasfaserkabel LC-LC 1 m (OM3)', typ: 'glasfaser', klasse: 'sfp', laenge: 1.0, farbe: '#2fc7c9', farbe_name: 'aqua', preis: 25 },
  { item: 'lwl-om3-2.0', name: 'Glasfaserkabel LC-LC 2 m (OM3)', typ: 'glasfaser', klasse: 'sfp', laenge: 2.0, farbe: '#2fc7c9', farbe_name: 'aqua', preis: 28 },
  { item: 'konsolkabel-usb-3.0', name: 'Konsolkabel USB-RJ45 3 m', typ: 'konsolkabel', klasse: 'console', laenge: 3.0, farbe: '#7cc4ff', farbe_name: 'hellblau', preis: 15 },
  { item: 'strom-c13-1.0', name: 'Stromkabel C13/C14 1 m', typ: 'stromkabel', klasse: 'power', laenge: 1.0, farbe: '#202225', farbe_name: 'schwarz', preis: 4 },
  { item: 'strom-c13-2.0', name: 'Stromkabel C13/C14 2 m', typ: 'stromkabel', klasse: 'power', laenge: 2.0, farbe: '#202225', farbe_name: 'schwarz', preis: 5 },
];

export const KATALOG = [...HARDWARE_KATALOG, ...KABEL_KATALOG];

// Rack-Platz B4 (slot_rack_8) liegt am naechsten beim Tisch: Notebook-Kabel bis 5 m reichen dorthin.
const RACK = { item: 'rack-42he', slot: 'slot_rack_8' };
const at = (item, u) => ({ item, rack: 'rack_8', u });
const nb = (k) => ({ item: 'notebook', slot: `slot_nb_${k}` });

/** Demo-RZ: 8 Racks voll ausgebaut (Netzwerk-Rack A1, 7 Server-Racks), Patchkabel Switch <-> Patchpanel. */
function demo() {
  const aufbau = [];
  const kabel = [];
  for (let r = 1; r <= 8; r++) aufbau.push({ vorlage: 'kit_rack', slot: `slot_rack_${r}` });
  const put = (r, vorlage, u) => aufbau.push({ vorlage, rack: `rack_${r}`, u });
  // A1: Netzwerk-Rack
  [['kit_patchpanel', 42], ['kit_switch', 41], ['kit_patchpanel', 40], ['kit_switch', 39], ['kit_coreswitch', 37],
    ['kit_firewall', 36], ['kit_router', 35], ['kit_kvm', 34], ['kit_blank_2u', 30]].forEach(([v, u]) => put(1, v, u));
  for (let u = 29; u >= 20; u--) put(1, 'kit_server', u);
  // A2..B4: Top-of-Rack (Patchpanel + Switch), Server, Blindplatten
  for (let r = 2; r <= 8; r++) {
    put(r, 'kit_patchpanel', 42);
    put(r, 'kit_switch', 41);
    put(r, 'kit_blank_1u', 40);
    const n = 8 + ((r * 5) % 7);
    for (let k = 0; k < n; k++) put(r, 'kit_server', 39 - k);
    for (let u = 39 - n; u >= 25; u -= 2) put(r, u - 1 >= 1 ? 'kit_blank_2u' : 'kit_blank_1u', u - 1);
  }
  // Patchkabel: Switch-Ports 1-8 auf Patchpanel 1-8 in jedem Rack (Kern-IDs in Einbau-Reihenfolge)
  // A1: sw1 (U41) <-> pp1 (U42), sw2 (U39) <-> pp2 (U40); Rack r >= 2: sw(r+1) <-> pp(r+1)
  const pair = [['sw1', 'pp1'], ['sw2', 'pp2'], ...Array.from({ length: 7 }, (_, i) => [`sw${i + 3}`, `pp${i + 3}`])];
  for (const [sw, pp] of pair) {
    for (let k = 1; k <= 8; k++) {
      const n = String(k).padStart(2, '0');
      kabel.push({ from: `${sw}/${n}`, to: `${pp}/${n}`, item: 'patch-cat6-0.25-blau' });
    }
  }
  // Uplinks im Netzwerk-Rack: beide Switches an den Core-Switch (0.5 m gelb)
  kabel.push({ from: 'sw1/24', to: 'cs1/01', item: 'patch-cat6-0.5-blau' }, { from: 'sw2/24', to: 'cs1/02', item: 'patch-cat6-0.5-blau' });
  // Link nach unten: Trunk-Patchpanels in A1 (zuletzt eingebaut -> pp10, pp11) zu den ToR-Panels von A2 (pp3) und B1 (pp6)
  put(1, 'kit_patchpanel', 33);
  put(1, 'kit_patchpanel', 32);
  const trunks = [{ a: 'pp10', b: 'pp3' }, { a: 'pp11', b: 'pp6' }];
  // ueber den Trunk: sw1/20 -> pp10/20 ==Rinne== pp3/20 -> sw3/20 (A2), sw2/20 -> pp11/20 ==Rinne== pp6/20 -> sw6/20 (B1)
  kabel.push({ from: 'sw1/20', to: 'pp10/20', item: 'patch-cat6-1.0-gelb' }, { from: 'sw3/20', to: 'pp3/20', item: 'patch-cat6-0.25-blau' },
    { from: 'sw2/20', to: 'pp11/20', item: 'patch-cat6-1.0-gelb' }, { from: 'sw6/20', to: 'pp6/20', item: 'patch-cat6-0.25-blau' });
  for (let k = 1; k <= 3; k++) aufbau.push({ vorlage: 'kit_notebook', slot: `slot_nb_${k}` });
  return { aufbau, kabel, trunks };
}

const DOSEN = {
  'pp1/07': { name: 'AP07', type: 'pc', ip: '192.168.1.107', mask: '255.255.255.0' },
  'pp1/13': { name: 'AP13', type: 'pc', ip: '192.168.1.113', mask: '255.255.255.0' },
};
const BAU = 'Bauen: Artikel im Shop (B) kaufen, in die Hand nehmen (1–9 oder I), Platz bzw. Höheneinheit anvisieren, E/Klick. '
  + 'R baut wieder aus. Tipp: Rack-Platz B4 liegt am nächsten beim Tisch.';

export const LEVELS = [
  {
    id: 'L1', tags: ['Kabel', 'IPv4', 'Ping'], title: 'Level 1 - Zwei Notebooks verbinden',
    text: 'Kaufe zwei Notebooks und stelle sie auf den Tisch, verbinde sie mit einem Patchkabel (Netzwerkbuchse links '
      + 'am Notebook) und gib beiden eine IP im selben Netz (E auf den Bildschirm -> Netzwerk). Prüfe mit ping.',
    bauplan: { kaufen: { notebook: 2 }, einbau: [nb(1), nb(2)] }, // Kabel kauft der Spieler selbst
    scenario: {
      id: 'L1-notebooks', modus: 'katalog', budget: 2000, hardware_katalog: KATALOG, inventar: {},
      ziele: [
        { id: 'g1', typ: 'core', text: 'NB1 und NB2 mit einem Kabel verbinden', check: { type: 'connected', a: 'nb1', b: 'nb2' } },
        { id: 'g2', typ: 'core', text: 'NB1 und NB2 im selben IP-Netz', check: { type: 'sameNetwork', devices: ['nb1', 'nb2'] } },
        { id: 'g3', typ: 'core', text: 'Ping von NB1 an NB2 gelingt', check: { type: 'ping', from: 'nb1', to: 'nb2' } },
      ],
    },
  },
  {
    id: 'L2', tags: ['Rack', 'Patchpanel', 'Uplink'], title: 'Level 2 - Rack bauen, patchen, Uplink',
    text: 'Stelle ein Rack auf, baue oben ein Patchpanel (PP1) und darunter zwei Switches (SW1, SW2) ein und versorge '
      + 'die Switches mit Strom. Patche Dose 07 auf SW1 Port 07 und Dose 13 auf SW2. Damit AP07 den Drucker-PC AP13 '
      + 'erreicht, brauchen die Switches eine Verbindung (Uplink). ' + BAU,
    bauplan: { kaufen: { 'rack-42he': 1, 'patchpanel-24': 1, 'switch-24': 2, 'strom-c13-2.0': 2, 'patch-cat6-0.25-blau': 2, 'patch-cat6-0.5-blau': 1 },
      einbau: [RACK, at('patchpanel-24', 42), at('switch-24', 41), at('switch-24', 39)] },
    scenario: {
      id: 'L2-patch-uplink', modus: 'katalog', budget: 2500, hardware_katalog: KATALOG, inventar: {}, dosen: DOSEN,
      ziele: [
        { id: 'gs', typ: 'power', devices: ['sw1', 'sw2'], text: 'SW1 und SW2 mit Strom versorgen (PDU hinten im Rack → PSU)' },
        { id: 'g1', typ: 'link', a: 'sw1/07', b: 'pp1/07', text: 'Dose 07 (PP1) an SW1 Port 07' },
        { id: 'g2', typ: 'link_any', a: 'pp1/13', b_device: 'sw2', text: 'Dose 13 (PP1) an SW2' },
        { id: 'g3', typ: 'core', text: 'AP07 erreicht AP13 (Ping) - Switches verbinden!', check: { type: 'ping', from: 'AP07', to: 'AP13' } },
      ],
    },
  },
  {
    id: 'L3', tags: ['Konsole', 'CLI', 'Verwaltung'], title: 'Level 3 - Switch per Konsole einrichten',
    text: 'Baue einen Switch ins Rack (mit Strom) und stelle ein Notebook auf den Tisch. Verbinde NB1 mit dem Konsolkabel '
      + '(USB links) mit dem CON-Port von SW1. Im Reiter Konsole: enable, configure terminal, interface vlan 1, '
      + 'ip address 192.168.1.2 255.255.255.0, end, write memory. Dann NB1 per Patchkabel an einen Switch-Port, '
      + 'NB1 eine IP geben und den Switch pingen. ' + BAU,
    bauplan: { kaufen: { 'rack-42he': 1, 'switch-24': 1, notebook: 1, 'strom-c13-2.0': 1, 'konsolkabel-usb-3.0': 1, 'patch-cat6-5.0-grau': 1 },
      einbau: [RACK, at('switch-24', 41), nb(1)] },
    scenario: {
      id: 'L3-konsole', modus: 'katalog', budget: 2700, hardware_katalog: KATALOG, inventar: {},
      ziele: [
        { id: 'gs', typ: 'power', devices: ['sw1'], text: 'SW1 mit Strom versorgen (PDU → PSU)' },
        { id: 'g1', typ: 'mgmt_address', text: 'SW1: Verwaltungsadresse 192.168.1.2/24 (interface vlan 1)', device: 'sw1', vlan: 1, ip: '192.168.1.2', mask: '255.255.255.0' },
        { id: 'g2', typ: 'core', text: 'SW1: Konfiguration gespeichert (write memory)', check: { type: 'configSaved', device: 'sw1' } },
        { id: 'g3', typ: 'core', text: 'NB1 am Netz und Ping auf 192.168.1.2 gelingt', check: { type: 'ping', from: 'nb1', to: '192.168.1.2' } },
      ],
    },
  },
  {
    id: 'L4', tags: ['Router', 'Subnetze', 'Gateway', 'SSH'], title: 'Level 4 - Router: zwei Netze verbinden',
    text: 'Baue einen Router ins Rack (mit Strom), stelle zwei Notebooks auf. NB1 kommt ins Netz 192.168.10.0/24 '
      + '(an Router-Port ETH0), NB2 ins Netz 192.168.20.0/24 (an ETH1). Router per Konsole (NB1 USB -> CON am Router): '
      + 'interface eth0 / ip address 192.168.10.1 255.255.255.0, interface eth1 / ip address 192.168.20.1 255.255.255.0. '
      + 'Bei den Notebooks das Gateway (.1) eintragen. Bonus: username admin password Geheim123 + ip ssh, dann im '
      + 'Terminal von NB1: ssh admin@192.168.10.1. ' + BAU,
    bauplan: { kaufen: { 'rack-42he': 1, 'router-4': 1, notebook: 2, 'strom-c13-2.0': 1, 'konsolkabel-usb-3.0': 1, 'patch-cat6-5.0-grau': 2 },
      einbau: [RACK, at('router-4', 35), nb(1), nb(2)] },
    scenario: {
      id: 'L4-router', modus: 'katalog', budget: 3500, hardware_katalog: KATALOG, inventar: {},
      ziele: [
        { id: 'gs', typ: 'power', devices: ['rt1'], text: 'Router RT1 mit Strom versorgen (PDU → PSU)' },
        { id: 'g1', typ: 'core', text: 'Router: eth0 = 192.168.10.1/24', check: { type: 'address', device: 'rt1', address: '192.168.10.1/24' } },
        { id: 'g2', typ: 'core', text: 'Router: eth1 = 192.168.20.1/24', check: { type: 'address', device: 'rt1', address: '192.168.20.1/24' } },
        { id: 'g3', typ: 'core', text: 'NB1 (Netz 10) erreicht NB2 (Netz 20) über den Router', check: { type: 'ping', from: 'nb1', to: 'nb2' } },
      ],
    },
  },
  {
    id: 'L5', tags: ['Firewall', 'DMZ', 'Regeln'], title: 'Level 5 - Firewall: LAN und DMZ',
    text: 'Baue eine Firewall ins Rack (mit Strom), stelle zwei Notebooks auf. NB1 ins LAN (Firewall-Port LAN, '
      + '192.168.1.10/24, Gateway .1), NB2 in die DMZ (Port DMZ, 192.168.2.10/24, Gateway .1). Firewall per Konsole '
      + '(NB1 -> CON): interface eth1 = 192.168.1.1/24, interface eth2 = 192.168.2.1/24. Ab Werk dürfen LAN und DMZ nach '
      + 'aussen. Ziel: Das LAN erreicht die DMZ, die DMZ aber NICHT das LAN - Regel z.B. firewall rule 1 deny ip any '
      + '192.168.1.0/24 in dmz. Mit show firewall prüfen, write memory. ' + BAU,
    bauplan: { kaufen: { 'rack-42he': 1, 'firewall-4': 1, notebook: 2, 'strom-c13-2.0': 1, 'konsolkabel-usb-3.0': 1, 'patch-cat6-5.0-grau': 2 },
      einbau: [RACK, at('firewall-4', 36), nb(1), nb(2)] },
    scenario: {
      id: 'L5-firewall', modus: 'katalog', budget: 3800, hardware_katalog: KATALOG, inventar: {},
      ziele: [
        { id: 'gs', typ: 'power', devices: ['fw1'], text: 'Firewall FW1 mit Strom versorgen (PDU → PSU)' },
        { id: 'g1', typ: 'core', text: 'NB1 im LAN erreicht NB2 in der DMZ', check: { type: 'ping', from: 'nb1', to: 'nb2' } },
        { id: 'g2', typ: 'core', text: 'NB2 in der DMZ erreicht das LAN NICHT (Firewall-Regel)', requires: 'g1',
          check: { type: 'noPing', from: 'nb2', to: 'nb1' } },
        { id: 'g3', typ: 'core', text: 'Firewall: Konfiguration gespeichert', check: { type: 'configSaved', device: 'fw1' } },
      ],
    },
  },
  {
    id: 'L6', tags: ['Glasfaser', 'SFP', 'Uplink'], title: 'Level 6 - Glasfaser-Uplink',
    text: 'Wie Level 2, aber der Uplink zwischen SW1 und SW2 läuft über Glasfaser: Kaufe zwei gleiche SFP-Module und ein '
      + 'Glasfaserkabel, setze die Module in je einen SFP-Einschub (Port 25-28, E auf den leeren Einschub, R nimmt ein '
      + 'Modul wieder heraus) und verbinde sie. Achtung: SX und LX passen nicht zusammen. ' + BAU,
    bauplan: { kaufen: { 'rack-42he': 1, 'patchpanel-24': 1, 'switch-24': 2, 'strom-c13-2.0': 2, 'patch-cat6-0.25-blau': 1, 'patch-cat6-0.5-blau': 1 },
      einbau: [RACK, at('patchpanel-24', 42), at('switch-24', 41), at('switch-24', 39)] },
    scenario: {
      id: 'L6-glasfaser', modus: 'katalog', budget: 2700, hardware_katalog: KATALOG, inventar: {}, dosen: DOSEN,
      ziele: [
        { id: 'gs', typ: 'power', devices: ['sw1', 'sw2'], text: 'SW1 und SW2 mit Strom versorgen (PDU → PSU)' },
        { id: 'g1', typ: 'link', a: 'sw1/07', b: 'pp1/07', text: 'Dose 07 an SW1 Port 07' },
        { id: 'g2', typ: 'link_any', a: 'pp1/13', b_device: 'sw2', text: 'Dose 13 an SW2' },
        { id: 'g3', typ: 'fiber_link', a_device: 'sw1', b_device: 'sw2', text: 'Glasfaser-Uplink SW1 <-> SW2 ist aktiv (Link up)' },
        { id: 'g4', typ: 'core', text: 'AP07 erreicht AP13 über die Glasfaser', requires: 'g3', check: { type: 'ping', from: 'AP07', to: 'AP13' } },
      ],
    },
  },
  {
    id: 'L7', tags: ['Layer 3', 'VLAN', 'SSH'], title: 'Level 7 - Core-Switch: VLANs routen + SSH',
    text: 'Baue Core-Switch CS1 und eine KVM-Konsole ins Rack (Strom für CS1 und die KVM), stelle zwei Notebooks auf. NB1 an CS1 '
      + 'Port 1, NB2 an Port 2. Über die KVM (E auf die Konsole im Rack) oder ein Konsolkabel: vlan 10, vlan 20, '
      + 'interface port1 / switchport access vlan 10, interface port2 / switchport access vlan 20, interface vlan 10 / '
      + 'ip address 192.168.10.1 255.255.255.0, interface vlan 20 / ip address 192.168.20.1 255.255.255.0 (ip routing ist an). '
      + 'NB1 192.168.10.10 (Gateway .1), NB2 192.168.20.10 (Gateway .1). Dann username admin password Geheim123, '
      + 'ip ssh und im Terminal von NB1: ssh admin@192.168.10.1. ' + BAU,
    bauplan: { kaufen: { 'rack-42he': 1, 'coreswitch-24': 1, 'kvm-1u': 1, notebook: 2, 'strom-c13-2.0': 2, 'patch-cat6-5.0-grau': 2 },
      einbau: [RACK, at('coreswitch-24', 37), at('kvm-1u', 34), nb(1), nb(2)] },
    scenario: {
      id: 'L7-core-switch', modus: 'katalog', budget: 6000, hardware_katalog: KATALOG, inventar: {},
      ziele: [
        { id: 'gs', typ: 'power', devices: ['cs1'], text: 'Core-Switch CS1 mit Strom versorgen (PDU → PSU)' },
        { id: 'g1', typ: 'core', text: 'NB1 im VLAN 10', check: { type: 'hostVlan', device: 'nb1', vlan: 10 } },
        { id: 'g2', typ: 'core', text: 'NB2 im VLAN 20', check: { type: 'hostVlan', device: 'nb2', vlan: 20 } },
        { id: 'g3', typ: 'core', text: 'NB1 erreicht NB2 über den Core-Switch (Routing zwischen VLANs)', requires: 'g2',
          check: { type: 'ping', from: 'nb1', to: 'nb2' } },
        { id: 'g4', typ: 'ssh_login', device: 'cs1', text: 'Per SSH am Core-Switch angemeldet' },
      ],
    },
  },
  {
    id: 'SB', tags: ['Sandbox', 'Budget ∞'], title: 'Sandbox - einfach drauflos bauen',
    text: 'Unbeschränktes Budget, leerer Raum: kaufe Racks, Switches, Router, Firewalls, Patchpanels, KVM und Notebooks '
      + 'und baue dein eigenes Netz. Keine Ziele - alles, was der leyoNET-Kern kann, funktioniert. ' + BAU,
    sandbox: true,
    scenario: { id: 'SB-sandbox', modus: 'katalog', budget: null, hardware_katalog: KATALOG, inventar: {}, dosen: DOSEN, ziele: [] },
  },
  {
    id: 'DEMO', tags: ['Demo', 'Rechenzentrum'], title: 'Demo - Rechenzentrum',
    text: 'Ein fertig ausgebautes Rechenzentrum: 8 Racks mit Patchpanels, Top-of-Rack-Switches, Servern, Netzwerk-Rack '
      + 'mit Core-Switch, Firewall, Router und KVM. Umsehen, einstecken, ausprobieren - Budget unbeschränkt.',
    sandbox: true,
    scenario: { id: 'DEMO-rz', modus: 'katalog', budget: null, hardware_katalog: KATALOG, inventar: {}, ...demo(), ziele: [] },
  },
];

export const levelById = (id) => LEVELS.find((l) => l.id === id) ?? LEVELS[0];

/**
 * Plan v4 E: Szenario «fertig aufgebaut». Der Bauplan ist gestellt: Geraete eingebaut (ohne Strom, die Kabel steckt der
 * Spieler), uebrige Artikel des Bauplans (Kabel) im Inventar, Budget um den Kaufpreis kleiner - wie selbst gekauft.
 */
export function readyScenario(level) {
  const sc = level.scenario;
  if (!level.bauplan) return sc;
  const byItem = new Map(sc.hardware_katalog.map((c) => [c.item, c]));
  const inventar = { ...(sc.inventar ?? {}) };
  let preis = 0;
  for (const [item, n] of Object.entries(level.bauplan.kaufen)) {
    inventar[item] = (inventar[item] ?? 0) + n;
    preis += byItem.get(item).preis * n;
  }
  const aufbau = level.bauplan.einbau.map((e) => {
    inventar[e.item]--;
    return { ...e, vorlage: byItem.get(e.item).vorlage, strom: false };
  });
  for (const [item, n] of Object.entries(inventar)) if (n <= 0) delete inventar[item];
  return { ...sc, aufbau: [...(sc.aufbau ?? []), ...aufbau], inventar, budget: sc.budget === null ? null : sc.budget - preis };
}

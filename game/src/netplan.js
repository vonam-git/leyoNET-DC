// Netzplan (Plan v4 C + I): EIN Modell + EIN Zeichner fuer Fenster (N), Minikarte (M) und Wandbildschirm.
// Aussehen wie die Zeichenflaeche von leyoNET: Punktraster, Geraetesymbole (vendor/leyonet/src/ui/deviceIcons.ts),
// Rollenfarben (farben.css). Reine Funktion des Kern-Zustands (state.devices/links/trunks/power/plan).
import { iconShapes } from '../../vendor/leyonet/src/ui/deviceIcons.ts';

export const THEME = {
  light: { paper: '#ffffff', canvas: '#f5f7fa', grid: '#cfd6df', ink: '#000000', text: '#18212c', muted: '#55606f', cable: '#4a5566',
    port: '#16a34a', down: '#c0262d', ip: '#1d5fd6', power: '#c27c0e', fiber: '#0e7490', console: '#7c3aed', trunk: '#1f4fa8',
    endpoint: ['#1d5fd6', '#dde8fc'], distribution: ['#067a52', '#d3f2e5'], routing: ['#b4530a', '#fbe6cf'], passive: ['#55606f', '#eef1f5'] },
  dark: { paper: '#0e131b', canvas: '#141b25', grid: '#2b3543', ink: '#ffffff', text: '#dbe3ec', muted: '#9ba7b6', cable: '#9ba7b6',
    port: '#22c55e', down: '#f2756a', ip: '#6fa2ff', power: '#e3a63c', fiber: '#5fd0e8', console: '#b794f6', trunk: '#6fa2ff',
    endpoint: ['#6aa5ff', '#1c3252'], distribution: ['#3ccf96', '#123a2c'], routing: ['#f5b041', '#3d2c12'], passive: ['#9ba7b6', '#1a222e'] },
};

// Kern-Rolle -> [leyoNET-Symbol, Variante, Farbrolle, Ebene (0 = oben)]
const ROLE = {
  fw: ['firewall', '', 'routing', 0], rt: ['router', '', 'routing', 0], cs: ['l3switch', '', 'distribution', 1],
  sw: ['switch', '', 'distribution', 2], pp: ['patchpanel', '', 'passive', 3], nb: ['notebook', '', 'endpoint', 4],
  srv: ['server', 'rack', 'endpoint', 4], kvm: ['pc', '', 'passive', 4], pdu: ['pdu', '', 'passive', 5], sl: ['pdu', '', 'passive', 5], td: ['patchpanel', '', 'passive', 3],
};
const roleOfId = (id) => /^[a-z]+/.exec(id)?.[0];
const SP_X = 132; // Abstand der Geraete nebeneinander
const SP_Y = 150; // Abstand der Ebenen
const ROW_MAX = 12; // mehr Geraete pro Ebene -> naechste Zeile

/** Kern-Zustand -> { nodes: [{ id, type, variant, role, tier, label, sub, on, x, y }], edges: [{ a, b, kind, n, up, pa, pb }] } */
export function planModel(st, { power = false } = {}) {
  const nodes = new Map();
  const edges = new Map();
  for (const d of st?.devices ?? []) {
    const r = ROLE[roleOfId(d.id)];
    if (!r || (r[0] === 'pdu' && !power)) continue;
    const ips = st.plan?.ips?.[d.id] ?? [];
    nodes.set(d.id, { id: d.id, type: r[0], variant: r[1], role: r[2], tier: r[3], label: { td: 'Tischdose', sl: 'Pult-Leiste' }[roleOfId(d.id)] ?? d.id.toUpperCase(),
      sub: ips.slice(0, 2).join(' · ') + (ips.length > 2 ? ' …' : ''), on: st.power?.[d.id] !== 'off' });
  }
  const kinds = new Map((st?.devices ?? []).map((d) => [d.id, d.ports]));
  const add = (a, b, kind, up, pa = '', pb = '') => {
    if (!nodes.has(a) || !nodes.has(b)) return;
    const swap = a > b;
    const key = `${swap ? b : a}|${swap ? a : b}|${kind}`;
    const e = edges.get(key) ?? { a: swap ? b : a, b: swap ? a : b, kind, n: 0, up: 0, pa: swap ? pb : pa, pb: swap ? pa : pb };
    e.n++;
    if (up) e.up++;
    edges.set(key, e);
  };
  for (const l of st?.links ?? []) {
    const [da, pa] = l.a.split('/');
    const [db, pb] = l.b.split('/');
    const k = kinds.get(da)?.[pa];
    const kind = k === 'power' || da.startsWith('pdu') || db.startsWith('pdu') ? 'power' : k === 'console' ? 'console' : k === 'sfp' ? 'fiber' : 'copper';
    if (kind === 'power' && !power) continue;
    // Endgeraete hinter Wanddosen: sichtbar, sobald ihr Patchpanel-Port gesteckt ist
    for (const ref of [l.a, l.b]) {
      const ep = st.plan?.dosen?.[ref];
      const pp = ref.split('/')[0];
      if (!ep || !nodes.has(pp) || nodes.has(`dose:${ref}`)) continue;
      const t = ep.type === 'server' ? 'server' : ep.type ?? 'pc';
      nodes.set(`dose:${ref}`, { id: `dose:${ref}`, type: t, variant: '', role: t === 'accesspoint' || t === 'switch' ? 'distribution' : t === 'router' || t === 'internet' ? 'routing' : 'endpoint',
        tier: 4, label: ep.name, sub: ep.ip ?? '', on: true });
      add(pp, `dose:${ref}`, 'copper', st.plan?.up?.[l.id], ref.split('/')[1]);
    }
    add(da, db, kind, kind === 'console' || kind === 'power' ? true : st.plan?.up?.[l.id], pa, pb);
  }
  for (const t of st?.trunks ?? []) add(t.a, t.b, 'trunk', true, '', t.desk ? 'fest' : '');
  // feste Einrichtung des Pults nur zeigen, wenn sie benutzt wird
  for (const id of [...nodes.keys()]) if (/^(td|sl)\d/.test(id) && ![...edges.values()].some((e) => e.a === id || e.b === id)) nodes.delete(id);
  // unverkabelte Server je Rack zusammenfassen (Demo-RZ: 98 Server)
  const linked = new Set([...edges.values()].flatMap((e) => [e.a, e.b]));
  const idle = new Map();
  for (const d of st?.devices ?? []) if (d.id.startsWith('srv') && nodes.has(d.id) && !linked.has(d.id)) idle.set(d.rack, [...(idle.get(d.rack) ?? []), d.id]);
  for (const [rack, ids] of idle) {
    if (ids.length < 4) continue;
    for (const id of ids.slice(1)) nodes.delete(id);
    Object.assign(nodes.get(ids[0]), { label: `${ids.length} Server`, sub: rack.replace('rack_', 'Rack ').replace('bench_1', 'Pult'), on: ids.some((id) => st.power?.[id] !== 'off'), count: ids.length });
  }
  const list = [...nodes.values()];
  layout(list, [...edges.values()]);
  return { nodes: list, edges: [...edges.values()] };
}

/** Ebenen von oben (Router/Firewall) nach unten (Endgeraete); in der Ebene nach dem Schwerpunkt der Nachbarn geordnet. */
function layout(nodes, edges) {
  const near = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) { near.get(e.a).push(e.b); near.get(e.b).push(e.a); }
  const pos = new Map();
  let y = 0;
  for (const tier of [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b)) {
    const row = nodes.filter((n) => n.tier === tier);
    const key = (n) => {
      const xs = near.get(n.id).map((id) => pos.get(id)).filter((v) => v !== undefined);
      return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
    };
    const weight = new Map(row.map((n, i) => [n, key(n) ?? 1e6 + i]));
    row.sort((a, b) => weight.get(a) - weight.get(b) || a.id.localeCompare(b.id, 'de', { numeric: true }));
    for (let i = 0; i < row.length; i += ROW_MAX) {
      const part = row.slice(i, i + ROW_MAX);
      part.forEach((n, k) => {
        n.x = (k - (part.length - 1) / 2) * SP_X;
        n.y = y;
        pos.set(n.id, n.x);
      });
      y += SP_Y;
    }
  }
}

/** Ansicht, in die der ganze Plan passt: { x, y, s } (Plan-Mitte, Massstab) */
export function fitView(plan, w, h, { max = 1.6, pad = 70 } = {}) {
  if (!plan.nodes.length) return { x: 0, y: 0, s: 1 };
  const xs = plan.nodes.map((n) => n.x);
  const ys = plan.nodes.map((n) => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + 12, s: Math.min(max, w / (x1 - x0 + 2 * pad), h / (y1 - y0 + 2 * pad)) };
}

const MONO = "'Courier New', 'Liberation Mono', monospace";
const CODE = 'ui-monospace, Menlo, Consolas, monospace';

function drawIcon(g, n, t) {
  const [line, soft] = t[n.role];
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = line;
  if (n.type === 'patchpanel' || n.type === 'pdu') { // passiv: kein leyoNET-Geraet, eigenes Zeichen
    g.fillStyle = soft;
    g.beginPath(); g.roundRect(-26, -9, 52, 18, 3); g.fill(); g.stroke();
    g.fillStyle = line;
    for (let k = 0; k < 6; k++) { if (n.type === 'pdu') { g.beginPath(); g.arc(-18 + k * 7.2, 0, 2, 0, 7); g.fill(); } else g.fillRect(-20 + k * 7.2, -3, 4.5, 6); }
    return;
  }
  for (const s of iconShapes(n.type, n.variant || undefined)) {
    const a = s.attrs;
    const p = new Path2D(s.tag === 'path' ? a.d : undefined);
    if (s.tag === 'rect') p.roundRect(a.x, a.y, a.width, a.height, a.rx);
    if (s.tag === 'circle') p.arc(a.cx, a.cy, a.r, 0, Math.PI * 2);
    if (s.cls !== 'line') { g.fillStyle = s.cls === 'fill' ? line : soft; g.fill(p); }
    g.stroke(p);
  }
}

/** Zeichnet den Plan in (x0, y0, w, h) des Kontexts. view aus fitView (oder Zoom/Pan des Fensters). */
export function drawPlan(g, plan, view, { x0 = 0, y0 = 0, w, h, theme = THEME.light, small = false, empty = '' }) {
  const t = theme;
  g.save();
  g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.fillStyle = t.canvas;
  g.fillRect(x0, y0, w, h);
  if (!small) {
    g.fillStyle = t.grid;
    const step = 18 * Math.max(0.6, view.s);
    const ox = ((w / 2 - view.x * view.s) % step + step) % step;
    const oy = ((h / 2 - view.y * view.s) % step + step) % step;
    for (let y = oy; y < h; y += step) for (let x = ox; x < w; x += step) g.fillRect(x0 + x - 0.8, y0 + y - 0.8, 1.6, 1.6);
  }
  if (!plan.nodes.length) {
    g.fillStyle = t.muted;
    g.textAlign = 'center';
    g.font = `${small ? 12 : 20}px system-ui, sans-serif`;
    g.fillText(empty, x0 + w / 2, y0 + h / 2);
    g.restore();
    return;
  }
  g.translate(x0 + w / 2, y0 + h / 2);
  g.scale(view.s, view.s);
  g.translate(-view.x, -view.y);
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  // mehrere Kabelarten zwischen denselben Geraeten nebeneinander
  const pairs = new Map();
  for (const e of plan.edges) { const k = `${e.a}|${e.b}`; pairs.set(k, [...(pairs.get(k) ?? []), e]); }
  for (const list of pairs.values()) {
    list.forEach((e, i) => {
      const a = byId.get(e.a), b = byId.get(e.b);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const off = (i - (list.length - 1) / 2) * 12;
      const nx = (-(b.y - a.y) / len) * off, ny = ((b.x - a.x) / len) * off;
      const [ax, ay, bx, by] = [a.x + nx, a.y + ny, b.x + nx, b.y + ny];
      // Geraete derselben Ebene: Bogen, sonst liegt das Kabel hinter den Symbolen dazwischen
      const bow = Math.abs(a.y - b.y) < 1 && len > SP_X * 1.5 ? -Math.min(60, len * 0.18) : 0;
      const cx = (ax + bx) / 2, cy = (ay + by) / 2 + bow * 2;
      g.strokeStyle = { copper: t.cable, fiber: t.fiber, console: t.console, power: t.power, trunk: t.trunk }[e.kind];
      g.lineWidth = (e.kind === 'trunk' ? 5 : e.n > 1 ? 4 : 2.4) / (small ? Math.min(1, view.s * 1.6) : 1);
      g.setLineDash(e.kind === 'console' ? [7, 5] : e.kind === 'power' ? [3, 4] : []);
      g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(cx, cy, bx, by); g.stroke();
      g.setLineDash([]);
      if (small) return;
      const at = (f) => [(1 - f) * (1 - f) * ax + 2 * f * (1 - f) * cx + f * f * bx, (1 - f) * (1 - f) * ay + 2 * f * (1 - f) * cy + f * f * by];
      // nach unten liegt die Beschriftung des Geraets: Punkt + Portnummer weiter weg
      const gap = (from, to) => Math.min(0.34, (to.y - from.y > len * 0.5 ? 66 : 38) / len);
      const [fa, fb] = [gap(a, b), gap(b, a)];
      if (e.kind === 'copper' || e.kind === 'fiber') {
        g.fillStyle = e.up === e.n ? t.port : e.up ? t.power : t.down;
        for (const q of [fa, 1 - fb]) { g.beginPath(); g.arc(...at(q), 4, 0, Math.PI * 2); g.fill(); }
      }
      const tag = (x, y, text) => {
        g.font = `11px ${CODE}`;
        g.textAlign = 'center';
        const tw = g.measureText(text).width + 6;
        g.fillStyle = t.canvas; g.fillRect(x - tw / 2, y - 8, tw, 14);
        g.fillStyle = t.muted; g.fillText(text, x, y + 3);
      };
      if (e.n > 1) tag(...at(0.5), `${e.n} ×`);
      else if (e.kind === 'trunk') tag(...at(0.5), e.pa || e.pb ? 'fest' : 'Trunk');
      else {
        if (e.pa) tag(...at(Math.min(0.46, fa + 18 / len)), e.pa.replace(/^0/, ''));
        if (e.pb) tag(...at(1 - Math.min(0.46, fb + 18 / len)), e.pb.replace(/^0/, ''));
      }
    });
  }
  for (const n of plan.nodes) {
    g.save();
    g.translate(n.x, n.y);
    g.fillStyle = t.canvas;
    g.beginPath(); g.roundRect(-30, -26, 60, 52, 6); g.fill();
    g.globalAlpha = n.on ? 1 : 0.4;
    drawIcon(g, n, t);
    g.globalAlpha = 1;
    if (small && view.s < 0.45) { g.restore(); continue; }
    g.textAlign = 'center';
    g.lineWidth = 4;
    g.strokeStyle = t.canvas;
    g.font = '600 14px system-ui, sans-serif';
    g.strokeText(n.label, 0, 40);
    g.fillStyle = t.text;
    g.fillText(n.label, 0, 40);
    const sub = n.on ? n.sub : n.type === 'notebook' ? 'aus' : 'kein Strom';
    if (sub && !small) {
      g.font = `12px ${CODE}`;
      g.strokeText(sub, 0, 56);
      g.fillStyle = n.on ? t.ip : t.down;
      g.fillText(sub, 0, 56);
    }
    g.restore();
  }
  g.restore();
}

/** Wandbildschirm: Kopfzeile + Plan. g = Kontext der Canvas-Textur. */
export function drawWall(g, plan, { w, h, title }) {
  const t = THEME.light;
  const top = 76;
  drawPlan(g, plan, fitView(plan, w, h - top, { max: 2.2 }), { x0: 0, y0: top, w, h: h - top, empty: 'Noch nichts gebaut. Der Plan zeichnet mit.' });
  g.fillStyle = t.paper; g.fillRect(0, 0, w, top);
  g.fillStyle = t.grid; g.fillRect(0, top - 2, w, 2);
  g.textAlign = 'left';
  g.font = `400 44px ${MONO}`;
  g.fillStyle = '#8a8f98'; g.fillText('leyo', 32, 52);
  const x = 32 + g.measureText('leyo').width;
  g.font = `700 44px ${MONO}`;
  g.fillStyle = t.ink; g.fillText('NET', x, 52);
  g.font = '500 26px system-ui, sans-serif';
  g.fillStyle = t.muted;
  g.fillText(title, x + g.measureText('NET').width + 110, 49);
  const n = plan.nodes.reduce((x, v) => x + (v.count ?? 1), 0), k = plan.edges.reduce((s, e) => s + e.n, 0);
  g.textAlign = 'right';
  g.fillText(`${n} ${n === 1 ? 'Gerät' : 'Geräte'} · ${k} ${k === 1 ? 'Verbindung' : 'Verbindungen'}`, w - 32, 49);
}

/** Abbildung Welt (x, z) -> Minikarte: { X, Y } */
export function roomMapScale({ w, h, bounds }) {
  const s = Math.min((w - 20) / (bounds.max.x - bounds.min.x), (h - 20) / (bounds.max.z - bounds.min.z));
  return { s, X: (x) => w / 2 + (x - (bounds.min.x + bounds.max.x) / 2) * s, Y: (z) => h / 2 + (z - (bounds.min.z + bounds.max.z) / 2) * s };
}

/** Minikarte «Raum» (Grundriss von oben): Waende, Racks, Tisch. Nur bei Aenderungen neu gezeichnet; der Spieler-Pfeil ist ein
 *  eigenes Element (CSS-Transformation, jedes Frame fluessig). */
export function drawRoomMap(g, { w, h, theme, bounds, racks, desks }) {
  const t = theme;
  g.fillStyle = t.canvas; g.fillRect(0, 0, w, h);
  const { s, X, Y } = roomMapScale({ w, h, bounds });
  const bw = bounds.max.x - bounds.min.x, bh = bounds.max.z - bounds.min.z;
  g.fillStyle = t.paper; g.strokeStyle = t.ink; g.lineWidth = 2;
  g.fillRect(X(bounds.min.x), Y(bounds.min.z), bw * s, bh * s);
  g.strokeRect(X(bounds.min.x), Y(bounds.min.z), bw * s, bh * s);
  g.lineWidth = 1.5;
  const box = (r, [line, soft]) => {
    g.fillStyle = soft; g.strokeStyle = line;
    g.fillRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
    g.strokeRect(X(r.x0), Y(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);
  };
  for (const d of desks) box({ x0: d.min.x, x1: d.max.x, z0: d.min.z, z1: d.max.z }, t.passive);
  for (const r of racks) box(r, t.distribution);
}

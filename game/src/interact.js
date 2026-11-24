import * as THREE from 'three';
import { hitName } from './batch.js';

// Interaktion (KONZEPT Kap. 4): Raycast aus der Kameramitte, Port-Highlight, E-Taste
// (Aktion selbst: cables.js - Kabel A -> B).
// Ports sind EINE InstancedMesh (batch.js); instanceId -> <geraet>_port_<nn>.
// Ein Port ist anwaehlbar, wenn er das naechste Objekt im Strahl ist (Glas, Geraete und
// Waende verdecken) und hoechstens REACH vom Kopf der Figur entfernt liegt.

const REACH = 1.4; // m, Kopf -> Port
const CLUSTER_REACH = REACH + 0.4; // Cluster schon etwas frueher zeigen
// Pulsieren: weicher Sinus, kein Blinken (Deckkraft nie 0)
const PULSE_HOVER = { hz: 1.2, min: 0.45, max: 0.7, scale: 1.6 };
const PULSE_CLUSTER = { hz: 0.8, min: 0.08, max: 0.18, scale: 1.25 };
const pulse = (t, p) => p.min + (p.max - p.min) * (0.5 + 0.5 * Math.sin(2 * Math.PI * p.hz * t));
const HOVER_COLOR = 0x37c8ff;
const SELECT_COLOR = 0xffa21f;

function marker(color, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  );
  m.matrixAutoUpdate = false;
  m.renderOrder = 2;
  m.visible = false;
  return m;
}

/** Port-Name -> lesbare Infos (<geraet>_port_<nn>). */
export function describePort(name, extras = {}) {
  const m = /^(.*)_port_(\w+)$/.exec(name);
  const device = m ? m[1] : name;
  const id = extras.leyonet_port ?? (m ? m[2] : '?');
  const kind = { rj45: 'RJ45', sfp: 'SFP+', keystone: 'Keystone', console: 'Konsole' }[extras.leyonet_port_kind]
    ?? extras.leyonet_port_kind ?? '';
  const label = extras.leyonet_port_label; // Router/Firewall: ETH0, WAN, LAN ...
  return { device, id: label ?? id, kind, led: `${device}_led_${/^\d+$/.test(id) ? `p${id}` : id}` };
}

export class PortInteraction {
  constructor({ scene, camera, batch, getHead, onUse, occluders = null }) {
    this.camera = camera;
    this.batch = batch;
    this.getHead = getHead;
    this.onUse = onUse;
    this.ray = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);
    this.occluders = occluders ?? [...batch.merged]; // Plan v3: Raum + Geraete
    this.screens = batch.screens ?? []; // Notebook-Displays: E = Notebook benutzen
    this.targets = batch.ports ? [batch.ports, ...this.occluders, ...this.screens] : [];
    this.lastHit = null; // { name, distance } - naechster Treffer (Stuhl, Geraet zum Ausbauen)
    this.screenHover = null; // GLB-Node des Notebooks, dessen Display anvisiert ist
    this.hover = null; // { index, name, info, distance }
    this.hoverMarker = marker(HOVER_COLOR, 0.55);
    this.markMarker = marker(SELECT_COLOR, 0.7);
    scene.add(this.hoverMarker, this.markMarker);
    // Cluster: Ports des anvisierten Geraets (1 InstancedMesh = 1 Draw Call)
    this.portsByDevice = new Map();
    (batch.ports?.userData.names ?? []).forEach((n, i) => {
      const dev = n.replace(/_port_\w+$/, '');
      if (!this.portsByDevice.has(dev)) this.portsByDevice.set(dev, []);
      this.portsByDevice.get(dev).push(i);
    });
    const maxPorts = Math.max(1, ...[...this.portsByDevice.values()].map((v) => v.length));
    const cm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      color: HOVER_COLOR, transparent: true, opacity: 0.12, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), maxPorts);
    cm.count = 0;
    cm.renderOrder = 1;
    cm.frustumCulled = false;
    this.clusterMarkers = cm;
    this.clusterDevice = null;
    scene.add(cm);
    this._sc = new THREE.Matrix4().makeScale(PULSE_CLUSTER.scale, PULSE_CLUSTER.scale, 1);
    this.scene = scene;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._s = new THREE.Matrix4().makeScale(PULSE_HOVER.scale, PULSE_HOVER.scale, 1);
  }

  _portMatrix(index, out) {
    this.batch.ports.getMatrixAt(index, out);
    return out.multiply(this._s);
  }

  /** Geraet (mit Ports) zu einem Treffer-Namen: Port-Instanz oder Primitive/Quellmesh. */
  _deviceOf(name) {
    if (!name) return null;
    if (/_port_\w+$/.test(name)) return name.replace(/_port_\w+$/, '');
    for (const d of this.portsByDevice.keys()) if (name === d || name.startsWith(`${d}_`)) return d;
    return null;
  }

  /** pro Frame: Hover + naechster Port-Cluster bestimmen, Marker pulsieren lassen. */
  update(t = performance.now() / 1000) {
    this.hover = null;
    if (!this.batch.ports) return null;
    this.ray.setFromCamera(this.center, this.camera);
    this.ray.far = 6;
    const hit = this.ray.intersectObjects(this.targets, false)[0];
    const head = this.getHead();
    const dist = hit ? hit.point.distanceTo(head) : Infinity;
    this.lastHit = hit ? { name: hitName(hit), distance: dist } : null;
    const ov = hit?.object.userData.leyonet_overlay;
    this.screenHover = hit && (ov === 'screen' || ov === 'kvm') && dist <= REACH + 0.4
      ? hit.object.name.replace(/_(screen|kvm)$/, '') : null;
    if (hit && hit.object === this.batch.ports && hit.instanceId !== undefined && dist <= REACH) {
      const name = hitName(hit);
      const info = describePort(name, this.batch.ports.userData.extras[hit.instanceId]);
      this.hover = { index: hit.instanceId, name, info, distance: dist };
    }
    // Cluster = Ports des anvisierten Geraets in Reichweite (nur dieses eine Geraet)
    const dev = hit && dist <= CLUSTER_REACH ? this._deviceOf(hitName(hit)) : null;
    const cm = this.clusterMarkers;
    if (dev !== this.clusterDevice) {
      this.clusterDevice = dev;
      const idx = dev ? this.portsByDevice.get(dev) : [];
      idx.forEach((pi, k) => {
        this.batch.ports.getMatrixAt(pi, this._m);
        cm.setMatrixAt(k, this._m.multiply(this._sc));
      });
      cm.count = idx.length;
      cm.instanceMatrix.needsUpdate = true;
    }
    cm.material.opacity = pulse(t, PULSE_CLUSTER);
    const hm = this.hoverMarker;
    hm.visible = !!this.hover;
    if (hm.visible) {
      this._portMatrix(this.hover.index, hm.matrix);
      hm.material.opacity = pulse(t, PULSE_HOVER);
    }
    return this.hover;
  }

  /** Plan v3: vor dem Neuaufbau der Geraete-Gruppe - Marker aus der Szene nehmen. */
  dispose() {
    this.scene.remove(this.hoverMarker, this.markMarker, this.clusterMarkers);
  }

  /** Oranger Marker auf Port `index` (Kabel-Startport A), null = aus. */
  mark(index) {
    if (index === null || index === undefined) {
      this.markMarker.visible = false;
      return;
    }
    this._portMatrix(index, this.markMarker.matrix);
    this.markMarker.visible = true;
  }

  /** E-Taste: gibt den Hover an onUse weiter (Kabel-Logik in cables.js). */
  use() {
    if (!this.hover) return null;
    return this.onUse?.(this.hover) ?? null;
  }
}

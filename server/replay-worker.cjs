'use strict';
// Ein Nachspiel je Worker: eigener Speicher, vom Hauptprozess nach Zeitlimit beendet (Schutz vor Überlastung).
const { parentPort, workerData } = require('node:worker_threads');
console.warn = () => {}; // Protokolle der Lernenden nie ins Log
const { judge, replay } = require('./kern.cjs');

(workerData.kind === 'verbund' ? judge : replay)(workerData).then((r) => parentPort.postMessage({ ok: true, ...r }), (e) => parentPort.postMessage({ ok: false, error: String(e && e.message) }));

'use strict';
// Startdatei (in Plesk: «Anwendungsstartdatei»), siehe docs/ADMIN_SERVER.md. Passenger faengt listen() ab.
const { createApp } = require('./app.cjs');

const app = createApp();
const port = Number(process.env.PORT) || 8787;
for (const w of app.warnings) console.warn(`Hinweis: ${w}`);
app.server.listen(port, process.env.HOST || undefined, () => console.log(`leyoNET-DC-Server läuft auf Port ${port}`));

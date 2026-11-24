// Touch-Steuerung (Plan v4 J, iPad): links Daumen-Joystick, rechts wischen = umsehen, Tippen = benutzen (E),
// Knoepfe fuer Shop, Inventar, Netzplan, Zoom, Ducken, Abbrechen, Ausbauen, Menue. Erscheint beim ersten Touch.
const STICK = 56; // Auslenkung in px = volles Tempo
const TAP_MS = 260;
const TAP_PX = 12;

/**
 * surface: Canvas des Renderers; on: { look(dx, dy), use(), shop(), inventory(), plan(), zoom(on), crouch(), cancel(), remove(), menu() }
 * Rueckgabe { move: { x, y } (x rechts, y vor; -1..1), active }
 */
export function initTouch(surface, on) {
  const state = { move: { x: 0, y: 0 }, active: false };
  let stick = null; // { id, x, y }
  let look = null; // { id, x, y, t, moved }
  let zoomed = false;
  const ui = document.createElement('div');
  ui.id = 'touch';
  ui.innerHTML = '<div class="stick"><i></i></div><div class="pad right"></div><div class="pad top"></div>';
  const stickEl = ui.querySelector('.stick');
  const knob = stickEl.querySelector('i');
  const button = (host, label, title, fn) => {
    const b = document.createElement('button');
    b.className = 'tbtn';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
    ui.querySelector(host).append(b);
  };
  button('.right', 'E', 'Benutzen', () => on.use());
  button('.right', 'Q', 'Abbrechen', () => on.cancel());
  button('.right', 'R', 'Ausbauen', () => on.remove());
  button('.right', 'Zoom', 'Zoomen', (b) => { zoomed = !zoomed; b.classList.toggle('on', zoomed); on.zoom(zoomed); });
  button('.right', 'C', 'Ducken', () => on.crouch());
  button('.top', 'Menü', 'Menü', () => on.menu());
  button('.top', 'Shop', 'Shop', () => on.shop());
  button('.top', 'Inventar', 'Inventar', () => on.inventory());
  button('.top', 'Plan', 'Netzplan', () => on.plan());

  const activate = () => {
    if (state.active) return;
    state.active = true;
    document.documentElement.classList.add('touch');
    document.body.append(ui);
  };
  // kein Scrollen/Zoomen der Seite und keine nachgemachten Maus-Ereignisse (sonst Pointer-Lock-Versuche)
  surface.style.touchAction = 'none';
  addEventListener('touchstart', activate, { passive: true, once: true });
  surface.addEventListener('touchstart', (e) => {
    e.preventDefault();
    activate();
    for (const t of e.changedTouches) {
      if (!stick && t.clientX < innerWidth * 0.4) {
        stick = { id: t.identifier, x: t.clientX, y: t.clientY, t: performance.now(), moved: 0 };
        stickEl.style.left = `${t.clientX}px`;
        stickEl.style.top = `${t.clientY}px`;
        stickEl.classList.add('on');
      } else if (!look) look = { id: t.identifier, x: t.clientX, y: t.clientY, t: performance.now(), moved: 0 };
    }
  }, { passive: false });
  surface.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (stick?.id === t.identifier) {
        let dx = t.clientX - stick.x, dy = t.clientY - stick.y;
        const d = Math.hypot(dx, dy);
        stick.moved = Math.max(stick.moved, d);
        if (d > STICK) { dx *= STICK / d; dy *= STICK / d; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const dead = d < 8;
        state.move.x = dead ? 0 : dx / STICK;
        state.move.y = dead ? 0 : -dy / STICK;
      }
      if (look?.id === t.identifier) {
        const dx = t.clientX - look.x, dy = t.clientY - look.y;
        look.moved += Math.hypot(dx, dy);
        look.x = t.clientX;
        look.y = t.clientY;
        if (look.moved > TAP_PX) on.look(dx, dy);
      }
    }
  }, { passive: false });
  const end = (e, cancelled) => {
    for (const t of e.changedTouches) {
      for (const p of [stick, look]) {
        if (p?.id === t.identifier && !cancelled && p.moved < TAP_PX && performance.now() - p.t < TAP_MS) on.use();
      }
      if (stick?.id === t.identifier) { stick = null; release(); }
      if (look?.id === t.identifier) look = null;
    }
  };
  function release() {
    state.move.x = state.move.y = 0;
    knob.style.transform = '';
    stickEl.classList.remove('on');
  }
  surface.addEventListener('touchend', (e) => { e.preventDefault(); end(e, false); }, { passive: false });
  surface.addEventListener('touchcancel', (e) => end(e, true));
  state.reset = () => { stick = null; look = null; release(); };
  return state;
}

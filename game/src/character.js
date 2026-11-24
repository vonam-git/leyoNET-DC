import * as THREE from 'three';

// Logische Zustaende -> Clip-Namen in character.glb (= Mixamo-Dateiname snake_case).
export const CLIP_ALIAS = {
  idle: 'idle',
  walk: 'walking',
  run: 'running',
  crouch_idle: 'crouch_idle_01',
  crouch_walk: 'crouched_walking',
  crouch_enter: 'standing_to_crouch',
  crouch_exit: 'crouch_to_standing',
  push: 'button_pushing',
  pickup: 'picking_up',
  grab: 'taking_item',
  look: 'looking_around',
  thumbsup: 'standing_thumbs_up',
  wave: 'waving',
  clap: 'clapping',
  sit: 'male_sitting_pose',
};

const FADE = 0.2;
const ONE_SHOT = new Set(['crouch_enter', 'crouch_exit', 'push', 'pickup', 'grab', 'thumbsup', 'wave', 'clap']);

export class CharacterAnimator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    const byName = new Map(clips.map((c) => [c.name, c]));
    for (const [state, clipName] of Object.entries(CLIP_ALIAS)) {
      const clip = byName.get(clipName);
      if (!clip) {
        console.warn(`[anim] Clip fehlt: ${clipName} (${state})`);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(state)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[state] = action;
    }
    this.current = null;
    this.oneShot = null; // laufende Trigger-Aktion (blockiert Bewegung)
    this._onShotDone = null;
    this.mixer.addEventListener('finished', (e) => {
      if (this.oneShot && e.action === this.actions[this.oneShot]) {
        const done = this._onShotDone;
        this.oneShot = null;
        this._onShotDone = null;
        done?.();
      }
    });
  }

  get busy() {
    return this.oneShot !== null;
  }

  // Wechselt per Crossfade auf einen Loop-Zustand.
  play(state) {
    if (this.busy || state === this.current) return;
    this._fadeTo(state);
  }

  // Einmalige Aktion: Bewegung pausiert, danach zurueck auf `returnTo`.
  trigger(state, returnTo, onDone) {
    if (this.busy || !this.actions[state]) return false;
    this._fadeTo(state);
    this.oneShot = state;
    this._onShotDone = () => {
      onDone?.();
      this._fadeTo(returnTo);
    };
    return true;
  }

  _fadeTo(state) {
    const next = this.actions[state];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev && prev !== next) prev.crossFadeTo(next, FADE, false);
    this.current = state;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}

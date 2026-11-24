// Headless-Check: character.glb laden, alle Alias-Clips binden, Zustandsmaschine durchspielen.
import { existsSync, readFileSync } from 'node:fs';
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { CharacterAnimator, CLIP_ALIAS } = await import('../src/character.js');

const glb = new URL('../../assets/out/character.glb', import.meta.url);
if (!existsSync(glb)) { console.log('SKIP: character.glb fehlt (Mixamo, nur lokal: blender/tasks/character.py)'); process.exit(0); }
const buf = readFileSync(glb);
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const anim = new CharacterAnimator(gltf.scene, gltf.animations);

let unbound = 0;
for (const [state, action] of Object.entries(anim.actions)) {
  // Binding wird erst beim ersten play/update aufgeloest
  action.play(); anim.mixer.update(0);
  const missing = action._propertyBindings.filter((p) => !p.binding.targetObject).length;
  unbound += missing;
  console.log(`${state.padEnd(13)} ${CLIP_ALIAS[state].padEnd(20)} ${action.getClip().duration.toFixed(2)} s  tracks ${action.getClip().tracks.length}  unbound ${missing}`);
  action.stop();
}
const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
console.log(`Hoehe ${size.y.toFixed(2)} m, unbound total ${unbound}`);

// Zustandsmaschine: idle -> walk -> trigger push (busy) -> zurueck idle
anim.current = null; anim.play('idle'); anim.update(0.1);
anim.play('walk'); anim.update(0.3);
const ok1 = anim.current === 'walk';
anim.trigger('push', 'idle'); const ok2 = anim.busy;
anim.play('run'); const ok3 = anim.current === 'push'; // blockiert waehrend One-Shot
for (let t = 0; t < 10 && anim.busy; t += 0.05) anim.update(0.05);
const ok4 = !anim.busy && anim.current === 'idle';
console.log(`statemachine walk=${ok1} busy=${ok2} blocked=${ok3} returned=${ok4}`);
process.exit(unbound === 0 && ok1 && ok2 && ok3 && ok4 ? 0 : 1);

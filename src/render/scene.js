import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LIGHT } from '../game/constants.js';

const FOV = 38;
const BACKGROUND = '#21150c';
const TURN_SECONDS = 0.9;

// Narrow portrait screens get a steeper view so the board fills them.
function viewHeight(aspect) {
  return aspect < 1 ? 1.35 + (1 - aspect) * 1.6 : 1.1;
}

const sideAngle = (color) => (color === LIGHT ? 0 : Math.PI);

/** `bounds` is the box that must stay on screen. */
export function createScene(container, { bounds }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  // Fades the table into the background instead of showing its edge.
  scene.fog = new THREE.Fog(BACKGROUND);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight('#fff3dc', '#3a2412', 1.1));
  const sun = new THREE.DirectionalLight('#ffe4b8', 2.2);
  sun.position.set(-6, 12, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  for (const side of ['left', 'bottom']) sun.shadow.camera[side] = -9;
  for (const side of ['right', 'top']) sun.shadow.camera[side] = 9;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#ffd9a8', 0.5);
  fill.position.set(7, 5, -6);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = 1.25;
  controls.target.set(0, -0.2, 0);

  let angle = sideAngle(LIGHT);
  let turn = null;

  // Closest distance along `direction` at which every corner of the bounds is on screen.
  function fitDistance(direction) {
    const corners = [];
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const probe = camera.clone();
    const point = new THREE.Vector3();
    const fits = (distance) => {
      probe.position.copy(direction).multiplyScalar(distance).add(controls.target);
      probe.lookAt(controls.target);
      probe.updateMatrixWorld();
      return corners.every((corner) => {
        point.copy(corner).project(probe);
        return Math.abs(point.x) <= 0.96 && point.y <= 0.8 && point.y >= -0.78;
      });
    };
    let near = 1;
    let far = 200;
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    return far;
  }

  const defaultDirection = () =>
    new THREE.Vector3(Math.sin(angle), viewHeight(camera.aspect), Math.cos(angle)).normalize();

  function resize() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const distance = fitDistance(defaultDirection());
    // Tall phones sit the camera much further back, so the fog follows the camera distance.
    scene.fog.near = distance * 1.3;
    scene.fog.far = distance * 2.6;
    controls.minDistance = distance * 0.5;
    controls.maxDistance = distance * 1.6;
    camera.position.copy(defaultDirection()).multiplyScalar(distance).add(controls.target);
    controls.update();
  }

  new ResizeObserver(resize).observe(container);
  resize();

  const frameListeners = [];
  renderer.setAnimationLoop((time) => {
    if (turn) {
      // Swings around the board's vertical axis only, keeping the player's zoom and tilt.
      turn.start ??= time;
      const k = Math.min(1, (time - turn.start) / 1000 / TURN_SECONDS);
      const eased = k * k * (3 - 2 * k);
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta = turn.from + (turn.to - turn.from) * eased;
      camera.position.setFromSpherical(spherical).add(controls.target);
      if (k === 1) turn = null;
    }
    for (const listener of frameListeners) listener(time);
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    renderer,
    controls,
    onFrame: (listener) => frameListeners.push(listener),
    /** Turns the view to look from `color`'s side of the board, as players swap seats. */
    faceSide(color) {
      angle = sideAngle(color);
      const offset = camera.position.clone().sub(controls.target);
      const from = Math.atan2(offset.x, offset.z);
      // Shortest way round, so the camera never spins more than half a turn.
      let delta = angle - from;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      if (Math.abs(delta) < 0.01) return;
      turn = { from, to: from + delta, start: null };
    },
  };
}

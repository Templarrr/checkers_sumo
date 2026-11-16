import * as THREE from 'three';
import { LIGHT, PIECE_RADIUS } from '../game/constants.js';
import { FRAME_SECONDS } from '../game/physics.js';
import { TABLE_Y } from './boardView.js';
import { PALETTE } from './palette.js';
import { woodMaterial } from './wood.js';

export const PIECE_HEIGHT = 0.16;
const GRAVITY = 9.8;
// How long a fallen piece keeps sliding on the table after it lands.
const LANDING_SECONDS = 0.6;

// Traitor check timing, in seconds. Air time grows with the number of half-flips, as a harder
// flick sends the checker higher.
const CHECK_PAUSE = 0.35;
const WINDUP = 0.2;
const AIR_BASE = 0.3;
const AIR_PER_HALF_FLIP = 0.06;
const SETTLE = 0.35;
const TOSS_GAP = 0.2;
// How far the flicked rim lifts before the checker leaves the board, in radians.
const LIFT = 0.35;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function checkerGeometry() {
  const r = PIECE_RADIUS;
  const h = PIECE_HEIGHT;
  // Half profile from the centre of the bottom out and up, with grooves on the rim like a real
  // wooden checker and a shallow dish on top.
  const profile = [
    [0, 0],
    [r - 0.02, 0],
    [r, 0.02],
    [r, 0.045],
    [r - 0.012, 0.055],
    [r, 0.065],
    [r, h - 0.065],
    [r - 0.012, h - 0.055],
    [r, h - 0.045],
    [r, h - 0.02],
    [r - 0.02, h],
    [r * 0.78, h],
    [r * 0.72, h - 0.02],
    [0, h - 0.02],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(profile, 48);
}

function inlayGeometry() {
  const ring = new THREE.RingGeometry(PIECE_RADIUS * 0.45, PIECE_RADIUS * 0.58, 48);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, PIECE_HEIGHT - 0.018, 0);
  return ring;
}

// The underside's centre is inlaid with the other side's wood, so a checker flipped over shows
// whose side its heart is on.
function heartGeometry() {
  const disc = new THREE.CircleGeometry(PIECE_RADIUS * 0.5, 48);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, -0.002, 0);
  return disc;
}

const decal = {
  // Decals float a hair off the checker; this keeps them on top with a coarse depth buffer.
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -4,
};

function buildMaterials() {
  const heart = (color, seed) => {
    const material = woodMaterial(color, { seed, roughness: 0.4 });
    Object.assign(material, decal);
    return material;
  };
  const make = (body, inlay, heartColor, seed) => ({
    body: woodMaterial(body, { seed, roughness: 0.45 }),
    inlay: new THREE.MeshStandardMaterial({
      color: inlay,
      roughness: 0.4,
      metalness: 0.1,
      ...decal,
    }),
    heart: heart(heartColor, seed + 2),
  });
  return {
    light: make(PALETTE.lightPiece, PALETTE.lightPieceInlay, PALETTE.darkPiece, 13),
    dark: make(PALETTE.darkPiece, PALETTE.darkPieceInlay, PALETTE.lightPiece, 17),
  };
}

/** Where a piece that left the board at `fall` is, `t` seconds after it left. */
function fallingPose(fall, t) {
  const drop = -TABLE_Y;
  const landAt = Math.sqrt((2 * drop) / GRAVITY);
  const flight = Math.min(t, landAt);
  let x = fall.x + fall.vx * flight;
  let z = fall.z + fall.vz * flight;
  if (t > landAt) {
    // Slides to a stop on the table with an easing that ends at rest.
    const slide = Math.min(t - landAt, LANDING_SECONDS);
    const travelled = slide - (slide * slide) / (2 * LANDING_SECONDS);
    x += fall.vx * travelled * 0.5;
    z += fall.vz * travelled * 0.5;
  }
  const y = Math.max(TABLE_Y, -0.5 * GRAVITY * flight * flight);
  // Tips forward over the edge while dropping and lands flat on the table.
  const tilt = 0.9 * Math.sin(Math.min(1, t / landAt) * Math.PI);
  return { x, y, z, tilt };
}

export const fallSeconds = () => Math.sqrt((2 * -TABLE_Y) / GRAVITY) + LANDING_SECONDS;

/** When each toss of a traitor check starts and how its flight goes, laid end to end. */
function checkTimeline(tosses) {
  let at = CHECK_PAUSE;
  const entries = tosses.map((toss) => {
    const air = AIR_BASE + AIR_PER_HALF_FLIP * toss.halfFlips;
    const lift = (GRAVITY * air) / 2;
    // A checker that comes down past the edge keeps falling to the table.
    const flight =
      toss.result === 'off'
        ? (lift + Math.sqrt(lift * lift + 2 * GRAVITY * -TABLE_Y)) / GRAVITY
        : air;
    const entry = { toss, start: at, air, lift, flight, end: at + WINDUP + flight + SETTLE };
    at = entry.end + TOSS_GAP;
    return entry;
  });
  return { entries, duration: at };
}

/**
 * Where a tossed checker is `u` seconds into its toss: the flicked rim lifts, then it tumbles
 * forward through its half-flips along a parabola and comes down flat. Landing on other
 * checkers, it first rests on them and sinks as they go.
 */
function tossPose(entry, u) {
  const { toss, air, lift, flight } = entry;
  const { from, to } = toss;
  const heading = Math.atan2(to.x - from.x, to.z - from.z);
  const spin = toss.halfFlips * Math.PI;
  if (u < WINDUP) {
    const k = u / WINDUP;
    // Rises as it tips, so its front rim stays on the board.
    const tilt = LIFT * k * k;
    return { x: from.x, y: PIECE_RADIUS * Math.sin(tilt), z: from.z, tilt, heading };
  }
  const f = Math.min(u - WINDUP, flight);
  const across = f / air;
  const x = from.x + (to.x - from.x) * across;
  const z = from.z + (to.z - from.z) * across;
  if (u - WINDUP < flight) {
    const y = lift * f - (GRAVITY * f * f) / 2 + PIECE_RADIUS * Math.sin(LIFT) * (1 - f / flight);
    return { x, y, z, tilt: LIFT + (spin - LIFT) * (f / flight), heading };
  }
  const settled = Math.min(1, (u - WINDUP - flight) / SETTLE);
  let y = 0;
  if (toss.result === 'off') y = TABLE_Y;
  else if (toss.killed.length) y = PIECE_HEIGHT * (1 - settled);
  return { x, y, z, tilt: spin, heading };
}

export function createPiecesView() {
  const group = new THREE.Group();
  const geometry = checkerGeometry();
  const inlay = inlayGeometry();
  const heart = heartGeometry();
  const materials = buildMaterials();
  const meshes = new Map();
  let playback = null;
  let aimingId = null;
  const turnAbout = new THREE.Quaternion();
  const part = new THREE.Quaternion();

  function meshFor(piece) {
    let mesh = meshes.get(piece.id);
    if (!mesh) {
      const set = piece.color === LIGHT ? materials.light : materials.dark;
      mesh = new THREE.Group();
      // Turns about the checker's middle, so it can flip in place.
      const pivot = new THREE.Group();
      pivot.position.y = -PIECE_HEIGHT / 2;
      const body = new THREE.Mesh(geometry, set.body.clone());
      body.castShadow = true;
      body.receiveShadow = true;
      pivot.add(body, new THREE.Mesh(inlay, set.inlay), new THREE.Mesh(heart, set.heart));
      mesh.add(pivot);
      mesh.userData = { body, yaw: 0, flipped: false };
      meshes.set(piece.id, mesh);
      group.add(mesh);
    }
    return mesh;
  }

  /**
   * Puts a checker with its bottom (or top, when flipped) at height y, tipped by `tilt` towards
   * `heading`. The tip is about a horizontal axis on top of how the checker lies, so a checker
   * that lands flat again keeps the grain where it was.
   */
  function place(mesh, x, y, z, tilt = 0, heading = 0) {
    const { yaw, flipped } = mesh.userData;
    mesh.position.set(x, y + PIECE_HEIGHT / 2, z);
    mesh.quaternion.setFromAxisAngle(X_AXIS, flipped ? Math.PI : 0);
    mesh.quaternion.premultiply(part.setFromAxisAngle(Y_AXIS, yaw));
    if (tilt) {
      turnAbout.setFromAxisAngle(Y_AXIS, -heading);
      turnAbout.premultiply(part.setFromAxisAngle(X_AXIS, tilt));
      turnAbout.premultiply(part.setFromAxisAngle(Y_AXIS, heading));
      mesh.quaternion.premultiply(turnAbout);
    }
  }

  // After an odd number of half-flips about the axis across `heading`, the checker lies the
  // other way up and its grain is mirrored across that axis.
  function finishFlip(mesh, heading) {
    mesh.userData.flipped = !mesh.userData.flipped;
    mesh.userData.yaw = 2 * heading - mesh.userData.yaw;
  }

  function showAiming() {
    for (const [id, mesh] of meshes) {
      mesh.userData.body.material.emissive.set(id === aimingId ? '#5a3a10' : '#000000');
    }
  }

  function stepShot(p, t) {
    const { frames, falls, hits } = p.simulation;
    while (p.nextHit < hits.length && hits[p.nextHit].time <= t) {
      p.onHit?.(hits[p.nextHit++].strength);
    }
    const exact = t / FRAME_SECONDS;
    const i = Math.min(Math.floor(exact), frames.length - 1);
    const j = Math.min(i + 1, frames.length - 1);
    const blend = Math.min(1, exact - i);
    p.pieces.forEach((piece, index) => {
      if (!piece.onBoard) return;
      const mesh = meshFor(piece);
      const fall = falls.find((f) => f.id === piece.id);
      if (fall && t >= fall.time) {
        const pose = fallingPose(fall, t - fall.time);
        place(mesh, pose.x, pose.y, pose.z, pose.tilt, Math.atan2(fall.vx, fall.vz));
        if (pose.y <= TABLE_Y && !p.landed.has(piece.id)) {
          p.landed.add(piece.id);
          p.onLand?.();
        }
        return;
      }
      const [x0, z0] = frames[i][index];
      const [x1, z1] = frames[j][index];
      place(mesh, x0 + (x1 - x0) * blend, 0, z0 + (z1 - z0) * blend);
    });
  }

  function stepCheck(p, t) {
    p.entries.forEach((entry, k) => {
      const u = t - entry.start;
      if (u < 0 || p.done.has(k)) return;
      const { toss } = entry;
      const mesh = meshes.get(toss.id);
      const pose = tossPose(entry, u);
      const landed = u >= WINDUP + entry.flight;
      if (landed && !p.landed.has(k)) {
        p.landed.add(k);
        p.onLand?.();
        if (toss.killed.length) p.onHit?.(2);
      }
      for (const id of toss.killed) {
        // Crushed checkers hop aside and vanish as the tossed one settles on them.
        const victim = meshes.get(id);
        const k2 = landed ? Math.min(1, (u - WINDUP - entry.flight) / SETTLE) : 0;
        victim.scale.setScalar(Math.max(0.001, 1 - k2));
        victim.visible = k2 < 1;
        if (landed) victim.position.y = PIECE_HEIGHT / 2 + 0.25 * Math.sin(Math.PI * k2);
      }
      place(mesh, pose.x, pose.y, pose.z, pose.tilt, pose.heading);
      if (u >= entry.end - entry.start) {
        p.done.add(k);
        if (toss.halfFlips % 2) finishFlip(mesh, pose.heading);
        place(mesh, pose.x, pose.y, pose.z);
      }
    });
  }

  function start(step, duration, handlers) {
    playback?.resolve();
    return new Promise((resolve) => {
      playback = {
        step,
        duration,
        start: null,
        nextHit: 0,
        landed: new Set(),
        resolve,
        ...handlers,
      };
    });
  }

  return {
    group,

    /** Puts every piece of `pieces` at rest where it stands and hides the others. */
    sync(pieces) {
      playback?.resolve();
      playback = null;
      const present = new Set();
      for (const piece of pieces) {
        if (!piece.onBoard) continue;
        present.add(piece.id);
        const mesh = meshFor(piece);
        mesh.visible = true;
        mesh.scale.setScalar(1);
        if (mesh.userData.flipped !== Boolean(piece.flipped)) {
          mesh.userData.flipped = Boolean(piece.flipped);
          mesh.userData.yaw = 0;
        }
        place(mesh, piece.x, 0, piece.z);
      }
      for (const [id, mesh] of meshes) if (!present.has(id)) mesh.visible = false;
    },

    /**
     * Replays a simulated shot in real time. `onHit(strength)` and `onLand()` fire as
     * collisions and landings happen, for sound. Resolves when everything is at rest.
     */
    play(pieces, simulation, { onHit, onLand } = {}) {
      const fallEnds = simulation.falls.map((f) => f.time + fallSeconds());
      const duration = Math.max(simulation.frames.length * FRAME_SECONDS, ...fallEnds);
      return start(stepShot, duration, { pieces, simulation, onHit, onLand });
    },

    /**
     * Replays the tosses of a traitor check, one after another, from where the shot left the
     * checkers. Takes the same handlers as `play`.
     */
    playCheck(tosses, { onHit, onLand } = {}) {
      const { entries, duration } = checkTimeline(tosses);
      return start(stepCheck, duration, { entries, done: new Set(), onHit, onLand });
    },

    setAiming(id) {
      aimingId = id;
      showAiming();
    },

    update(nowMs) {
      if (!playback) return;
      const p = playback;
      p.start ??= nowMs;
      const t = (nowMs - p.start) / 1000;
      p.step(p, t);
      if (t >= p.duration) {
        playback = null;
        p.resolve();
      }
    },
  };
}

import * as THREE from 'three';
import { BOARD_SIZE, HALF, PLAY_HALF } from '../game/constants.js';
import { PALETTE } from './palette.js';
import { woodMaterial } from './wood.js';

const SQUARE_HEIGHT = 0.12;
const FILES = 'abcdefgh';
// The board is a thick block standing on the table, so knocked-off pieces visibly drop.
const BASE_HEIGHT = 0.45;
export const TABLE_Y = -(SQUARE_HEIGHT + BASE_HEIGHT);

function buildSquares() {
  const squares = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, SQUARE_HEIGHT, 1);
  for (let rank = 0; rank < BOARD_SIZE; rank++) {
    for (let file = 0; file < BOARD_SIZE; file++) {
      const isLight = (file + rank) % 2 === 1;
      const index = rank * BOARD_SIZE + file;
      const material = woodMaterial(isLight ? PALETTE.lightSquare : PALETTE.darkSquare, {
        seed: isLight ? 3 : 5,
        roughness: 0.5,
        rotation: (index % 3) * 0.04 + (rank % 2 ? Math.PI / 2 : 0),
      });
      material.map.offset.set((index * 0.137) % 1, (index * 0.271) % 1);
      const square = new THREE.Mesh(geometry, material);
      square.position.set(file - HALF + 0.5, -SQUARE_HEIGHT / 2, HALF - 0.5 - rank);
      square.receiveShadow = true;
      squares.add(square);
    }
  }
  return squares;
}

// The frame is flush with the cells, so pieces slide onto it and stay in play until they pass
// its outer edge.
function buildFrame() {
  const size = PLAY_HALF * 2;
  const height = SQUARE_HEIGHT + BASE_HEIGHT;
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(size, height, size),
    woodMaterial(PALETTE.frame, { seed: 7, repeat: 2, roughness: 0.6 }),
  );
  // A hair below the cells' tops, so the cells always win the depth test where they overlap.
  frame.position.y = -height / 2 - 0.001;
  frame.castShadow = true;
  frame.receiveShadow = true;
  return frame;
}

function labelMesh(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.label;
  ctx.font = 'bold 44px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function buildLabels() {
  const labels = new THREE.Group();
  const offset = (HALF + PLAY_HALF) / 2;
  for (let i = 0; i < BOARD_SIZE; i++) {
    const along = i - HALF + 0.5;
    for (const side of [1, -1]) {
      const file = labelMesh(FILES[i]);
      file.position.set(along, 0.002, side * offset);
      const rank = labelMesh(String(i + 1));
      rank.position.set(side * offset, 0.002, -along);
      // Near labels read from Light's seat, far ones from Dark's.
      if (side < 0) file.rotation.z = Math.PI;
      if (side > 0) rank.rotation.z = Math.PI;
      labels.add(file, rank);
    }
  }
  return labels;
}

function buildTable() {
  const material = woodMaterial(PALETTE.table, { seed: 11, repeat: 6, roughness: 0.7 });
  const table = new THREE.Mesh(new THREE.CircleGeometry(16, 64), material);
  table.rotation.x = -Math.PI / 2;
  table.position.y = TABLE_Y;
  table.receiveShadow = true;
  return table;
}

export function createBoardView() {
  const group = new THREE.Group();
  group.add(buildSquares(), buildFrame(), buildLabels(), buildTable());
  // Room around the board for pieces landing on the table right next to it.
  const edge = PLAY_HALF + 0.4;
  const bounds = new THREE.Box3(
    new THREE.Vector3(-edge, TABLE_Y, -edge),
    new THREE.Vector3(edge, 0.4, edge),
  );
  return { group, bounds };
}

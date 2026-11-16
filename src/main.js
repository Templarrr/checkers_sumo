import { Vector3 } from 'three';
import './style.css';
import { createSound } from './audio/sound.js';
import { DARK, LIGHT } from './game/constants.js';
import { DRAW, countPieces, newMatch, nextRound, playShot } from './game/rules.js';
import { EASY, HARD, MEDIUM } from './players/bot.js';
import { createBotPlayer } from './players/botPlayer.js';
import { createHumanPlayer } from './players/human.js';
import { createAim } from './render/aim.js';
import { createBoardView } from './render/boardView.js';
import { createPiecesView } from './render/piecesView.js';
import { createScene } from './render/scene.js';

const $ = (id) => document.getElementById(id);
const NAMES = { [LIGHT]: 'Light', [DARK]: 'Dark' };

const container = $('app');
const boardView = createBoardView();
const piecesView = createPiecesView();
const { scene, camera, renderer, onFrame, faceSide } = createScene(container, {
  bounds: boardView.bounds,
});
scene.add(boardView.group, piecesView.group);
onFrame((time) => piecesView.update(time));

const aim = createAim({ container, canvas: renderer.domElement, camera, scene, piecesView });
const human = createHumanPlayer(aim);
// Either side can be a person (hot seat on one screen) or a bot. A bot plays whichever side is
// to move, so one instance can serve both sides of a bot-vs-bot game.
const PLAYERS = {
  human,
  [EASY]: createBotPlayer(EASY, { aim }),
  [MEDIUM]: createBotPlayer(MEDIUM, { aim }),
  [HARD]: createBotPlayer(HARD, { aim }),
};
const players = { [LIGHT]: human, [DARK]: human };
const pickers = { [LIGHT]: $('player-light'), [DARK]: $('player-dark') };
const storageKey = (color) => `checkersSumo.player.${color}`;

function setPlayer(color, choice) {
  const kind = PLAYERS[choice] ? choice : 'human';
  players[color] = PLAYERS[kind];
  pickers[color].value = kind;
  try {
    localStorage.setItem(storageKey(color), kind);
  } catch {
    // Storage can be blocked, e.g. in private windows; the choice just isn't remembered.
  }
}

function savedPlayer(color) {
  try {
    return localStorage.getItem(storageKey(color));
  } catch {
    return null;
  }
}

// The camera sits behind the side a person plays; with people on both sides or none, it
// follows whoever shoots.
function cameraSide() {
  const humans = [LIGHT, DARK].filter((color) => !players[color].isBot);
  return humans.length === 1 ? humans[0] : state.turn;
}

// The traitor check is on unless switched off, and the choice is remembered like the players.
const traitorBox = $('traitor-check');
const traitorKey = 'checkersSumo.traitorCheck';
try {
  traitorBox.checked = localStorage.getItem(traitorKey) !== 'off';
} catch {
  // Storage blocked: keep the default.
}
const freshMatch = () => newMatch({ traitorCheck: traitorBox.checked });

const sound = createSound();
const soundToggle = $('sound-toggle');
function showSoundToggle() {
  soundToggle.textContent = sound.muted ? 'Sound: off' : 'Sound: on';
  soundToggle.setAttribute('aria-pressed', String(!sound.muted));
}
soundToggle.addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  showSoundToggle();
});
showSoundToggle();

let state = freshMatch();
// Bumped whenever play restarts, so a shot still being chosen or replayed for an abandoned
// game is dropped.
let game = 0;

function showStatus(text) {
  const status = $('status');
  status.textContent = text ?? `${NAMES[state.turn]} to shoot`;
  if (state.roundWinner) delete status.dataset.turn;
  else status.dataset.turn = state.turn;

  const side = (color) =>
    `<span class="dot ${color}"></span>${NAMES[color]} ${countPieces(state.pieces, color)} on row ${state.rows[color] + 1}`;
  $('rows').innerHTML = `Round ${state.round} · ${side(LIGHT)} · ${side(DARK)}`;
}

// What the traitor check did, from the checkers before and after it.
function checkSummary({ before, after }) {
  const was = new Map(before.map((p) => [p.id, p]));
  const traitors = after.filter((p) => p.flipped && !was.get(p.id).flipped).length;
  const home = after.filter((p) => !p.flipped && was.get(p.id).flipped).length;
  const lost = before.length - after.length;
  const parts = [];
  if (traitors) parts.push(traitors > 1 ? `${traitors} traitors` : 'a traitor');
  if (home) parts.push(`${home} back home`);
  if (lost) parts.push(`${lost} lost`);
  return `Traitor check: ${parts.length ? parts.join(', ') : 'all stay loyal'}`;
}

function shotSummary(lastShot) {
  if (!lastShot) return null;
  const { shooter, knockedOff, ownLost, ownTurned, enemyTurned, extraShot, check } = lastShot;
  const turn = `${NAMES[state.turn]}'s turn`;
  let text = null;
  if (extraShot) text = `Hit! ${NAMES[shooter]} shoots again`;
  else if ((knockedOff || enemyTurned) && (ownLost || ownTurned))
    text = `Both sides lost pieces · ${turn}`;
  else if (ownLost || ownTurned) text = `Own piece lost · ${turn}`;
  if (check) return `${checkSummary(check)} · ${text ?? turn}`;
  return text;
}

function showRoundOver() {
  const { roundWinner, matchWinner, nextRows } = state;
  let title;
  let text;
  let button;
  if (matchWinner) {
    title = `${NAMES[matchWinner]} wins the game!`;
    text = `${NAMES[matchWinner]} has pushed all the way to the far side of the board.`;
    button = 'New game';
  } else if (roundWinner === DRAW) {
    title = 'Nobody won the round';
    text = `Both sides lost their last piece in the same shot. The round is replayed from the same rows, ${NAMES[state.turn]} starts.`;
    button = 'Replay round';
  } else {
    const loser = roundWinner === LIGHT ? DARK : LIGHT;
    const pushed = nextRows[loser] < state.rows[loser];
    title = `${NAMES[roundWinner]} wins round ${state.round}`;
    text =
      `${NAMES[roundWinner]} moves up to row ${nextRows[roundWinner] + 1} .` +
      (pushed ? ` ${NAMES[loser]} is pushed back to row ${nextRows[loser] + 1}.` : '') +
      ` ${NAMES[loser]} starts the next round.`;
    button = 'Next round';
  }
  $('round-title').textContent = title;
  $('round-text').textContent = text;
  $('round-next').textContent = button;
  $('round-over').hidden = false;
  $('round-next').focus();
  showStatus(matchWinner ? `${NAMES[matchWinner]} wins!` : 'Round over');
}

async function play() {
  const current = ++game;
  while (!state.roundWinner) {
    const player = players[state.turn];
    faceSide(cameraSide());
    $('hint').style.visibility = player.isBot ? 'hidden' : '';
    const summary = shotSummary(state.lastShot);
    showStatus(summary ?? (player.isBot ? `${NAMES[state.turn]} is thinking…` : undefined));
    const shot = await player.chooseShot(state);
    if (current !== game) return;
    let result;
    try {
      result = playShot(state, shot);
    } catch (error) {
      // A shot that breaks the rules is a bug in a player; ask again rather than stall.
      console.error(error);
      continue;
    }
    showStatus(`${NAMES[state.turn]} shoots…`);
    const before = state.pieces;
    await piecesView.play(before, result.simulation, {
      onHit: (strength) => sound.clack(strength),
      onLand: () => sound.thud(),
    });
    if (current !== game) return;
    const { check } = result.state.lastShot;
    if (check) {
      showStatus('Traitor check…');
      await piecesView.playCheck(check.tosses, {
        onHit: (strength) => sound.clack(strength),
        onLand: () => sound.thud(),
      });
      if (current !== game) return;
    }
    state = result.state;
    piecesView.sync(state.pieces);
  }
  showRoundOver();
}

function startRound(next) {
  game++;
  Object.values(PLAYERS).forEach((player) => player.cancel());
  state = next;
  $('round-over').hidden = true;
  piecesView.sync(state.pieces);
  play();
}

$('round-next').addEventListener('click', () => {
  startRound(state.matchWinner ? freshMatch() : nextRound(state));
});
$('new-game').addEventListener('click', () => startRound(freshMatch()));
traitorBox.addEventListener('change', () => {
  try {
    localStorage.setItem(traitorKey, traitorBox.checked ? 'on' : 'off');
  } catch {
    // Not remembered, as with the players.
  }
  startRound(freshMatch());
});
for (const color of [LIGHT, DARK]) {
  pickers[color].addEventListener('change', () => {
    setPlayer(color, pickers[color].value);
    startRound(freshMatch());
  });
  setPlayer(color, savedPlayer(color));
}
startRound(state);

// Lets scripted browser checks play shots without simulating pointer drags.
window.checkersSumo = {
  getState: () => state,
  // Starts play from a given position, such as one with a checker hanging over the edge.
  load: (position) => startRound({ ...state, ...position }),
  shoot: (shot) => aim.shoot(shot),
  // Where a piece is on screen, in CSS pixels, so a script can drag it like a player would.
  screenOf(pieceId) {
    const piece = state.pieces.find((p) => p.id === pieceId);
    const point = new Vector3(piece.x, 0, piece.z).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height,
    };
  },
};

import { Vector3 } from 'three';
import './style.css';
import { createSound } from './audio/sound.js';
import { DARK, LIGHT } from './game/constants.js';
import { DRAW, countPieces, newMatch, nextRound, playShot } from './game/rules.js';
import { EASY, MEDIUM } from './players/bot.js';
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
// The human always plays Light; Dark is either a second person on the same screen or a bot.
const OPPONENTS = {
  human,
  [EASY]: createBotPlayer(EASY, { aim }),
  [MEDIUM]: createBotPlayer(MEDIUM, { aim }),
};
const players = { [LIGHT]: human, [DARK]: human };
const opponentPicker = $('opponent');
const OPPONENT_KEY = 'checkersSumo.opponent';

function setOpponent(choice) {
  const opponent = OPPONENTS[choice] ? choice : 'human';
  players[DARK] = OPPONENTS[opponent];
  opponentPicker.value = opponent;
  try {
    localStorage.setItem(OPPONENT_KEY, opponent);
  } catch {
    // Storage can be blocked, e.g. in private windows; the choice just isn't remembered.
  }
}

function savedOpponent() {
  try {
    return localStorage.getItem(OPPONENT_KEY);
  } catch {
    return null;
  }
}

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

let state = newMatch();
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

function shotSummary(lastShot) {
  if (!lastShot) return null;
  const { shooter, knockedOff, ownLost, extraShot } = lastShot;
  if (extraShot) return `Hit! ${NAMES[shooter]} shoots again`;
  if (ownLost && knockedOff) return `Both sides lost pieces · ${NAMES[state.turn]}'s turn`;
  if (ownLost) return `Own piece off · ${NAMES[state.turn]}'s turn`;
  return null;
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
      `${NAMES[roundWinner]} moves up to row ${nextRows[roundWinner] + 1} and starts the next round.` +
      (pushed ? ` ${NAMES[loser]} is pushed back to row ${nextRows[loser] + 1}.` : '');
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
    // Against a bot the camera stays behind the human's pieces.
    faceSide(players[DARK].isBot ? LIGHT : state.turn);
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
    state = result.state;
    piecesView.sync(state.pieces);
  }
  showRoundOver();
}

function startRound(next) {
  game++;
  Object.values(OPPONENTS).forEach((player) => player.cancel());
  state = next;
  $('round-over').hidden = true;
  piecesView.sync(state.pieces);
  play();
}

$('round-next').addEventListener('click', () => {
  startRound(state.matchWinner ? newMatch() : nextRound(state));
});
$('new-game').addEventListener('click', () => startRound(newMatch()));
opponentPicker.addEventListener('change', () => {
  setOpponent(opponentPicker.value);
  startRound(newMatch());
});
setOpponent(savedOpponent());
startRound(state);

// Lets scripted browser checks play shots without simulating pointer drags.
window.checkersSumo = {
  getState: () => state,
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

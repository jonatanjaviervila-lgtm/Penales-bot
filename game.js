import crypto from 'node:crypto';

export function newGame(chatId, messageId, host) {
  return { id: crypto.randomBytes(8).toString('hex'), mode: 'versus', chatId, messageId, players: [host, null], scores: [0, 0], shots: [0, 0], turn: 0, picks: {}, results: [], status: 'waiting', created: Date.now() };
}

export function newSoloGame(user) {
  const game = newGame(user.id, null, user);
  game.mode = 'solo';
  game.players[1] = { id: 'bot', name: 'Dibu (simulado)' };
  game.status = 'playing';
  return game;
}

export function role(game, userId) {
  const index = game.players.findIndex(p => p && String(p.id) === String(userId));
  if (index < 0) return null;
  return { index, type: game.turn % 2 === index ? 'kicker' : 'keeper' };
}

export function winner(game) {
  const [a, b] = game.scores, [sa, sb] = game.shots;
  if (sa < 5 || sb < 5) {
    if (a > b + (5 - sb)) return 0;
    if (b > a + (5 - sa)) return 1;
  }
  if (sa >= 5 && sb >= 5 && sa === sb && a !== b) return a > b ? 0 : 1;
  return null;
}

export function select(game, userId, sector, random = Math.random) {
  if (game.status !== 'playing') throw new Error('El partido ya no acepta elecciones.');
  if (!Number.isInteger(sector) || sector < 0 || sector > 8) throw new Error('Sector inválido.');
  const r = role(game, userId);
  if (!r) throw new Error('No participás de este partido.');
  if (game.picks[r.type] !== undefined) throw new Error('Ya elegiste en este penal.');
  if (game.mode === 'solo') {
    if (r.index !== 0) throw new Error('Solo puede patear el jugador.');
    // El arquero anticipa la dirección con frecuencia, pero también se equivoca.
    const save = random() < 0.58 ? sector : Math.floor(random() * 9);
    const goal = sector !== save;
    game.shots[0]++;
    if (goal) game.scores[0]++;
    const result = { number: game.turn + 1, kicker: 0, keeper: 1, kick: sector, save, goal };
    game.results.push(result);
    game.turn++;
    if (game.turn >= 5) game.status = 'finished';
    return { result, won: null };
  }
  game.picks[r.type] = sector;
  if (game.picks.kicker === undefined || game.picks.keeper === undefined) return null;
  const kicker = game.turn % 2, keeper = 1 - kicker;
  const goal = game.picks.kicker !== game.picks.keeper;
  game.shots[kicker]++;
  if (goal) game.scores[kicker]++;
  const result = { number: game.turn + 1, kicker, keeper, kick: game.picks.kicker, save: game.picks.keeper, goal };
  game.results.push(result);
  game.turn++;
  game.picks = {};
  const won = winner(game);
  if (won !== null) game.status = 'finished';
  return { result, won };
}

export function publicState(game, userId) {
  const r = role(game, userId);
  return { id: game.id, mode: game.mode || 'versus', status: game.status, players: game.players.map(p => p?.name ?? null), scores: game.scores, shots: game.shots, turn: game.turn, role: game.mode === 'solo' ? 'kicker' : r?.type ?? null, selected: r ? game.picks[r.type] !== undefined : false, results: game.results, winner: game.status === 'finished' && game.mode !== 'solo' ? winner(game) : null };
}

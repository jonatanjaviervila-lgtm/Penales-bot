import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { newGame, newSoloGame, select, publicState } from './game.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.BOT_TOKEN;
const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, '');
const port = Number(process.env.PORT || 3000);
if (!token || !base?.startsWith('https://')) { console.error('Configurá BOT_TOKEN y una URL HTTPS (PUBLIC_URL o RENDER_EXTERNAL_URL).'); process.exit(1); }
const webhookSecret = crypto.createHash('sha256').update(`penales-webhook:${token}`).digest('hex');
const api = `https://api.telegram.org/bot${token}/`;
const dataPath = process.env.DATA_FILE || path.join(root, 'games.json');
let games = {};
try { games = JSON.parse(fs.readFileSync(dataPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
function persist() { fs.writeFileSync(dataPath + '.tmp', JSON.stringify(games)); fs.renameSync(dataPath + '.tmp', dataPath); }
async function tg(method, data) {
  const response = await fetch(api + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const payload = await response.json();
  if (!payload.ok) throw new Error(`${method}: ${payload.description}`);
  return payload.result;
}
const label = p => p?.name || 'Rival';
function board(g) {
  if (g.status === 'waiting') return `⚽ Desafío de penales de ${label(g.players[0])}.\nTocá «Jugar» para aceptar.`;
  const score = `${label(g.players[0])} ${g.scores[0]} (${g.shots[0]}) — ${g.scores[1]} (${g.shots[1]}) ${label(g.players[1])}`;
  const last = g.results.at(-1);
  const line = last ? `\nPenal ${last.number}: ${label(g.players[last.kicker])} ${last.goal ? '⚽ GOL' : '🧤 ATAJADO'} · tiro ${last.kick + 1}, arquero ${last.save + 1}` : '';
  if (g.status === 'finished') return `🏁 ${score}${line}\nGanó ${label(g.players[g.scores[0] > g.scores[1] ? 0 : 1])}.`;
  return `⚽ ${score}${line}\nPenal ${g.turn + 1}: ${label(g.players[g.turn % 2])} patea; ${label(g.players[1 - g.turn % 2])} ataja. Entren al privado del bot para elegir.`;
}
let botUsername;
async function updateBoard(g) {
  const markup = g.status === 'waiting' ? { inline_keyboard: [[{ text: '⚽ Jugar', callback_data: `join:${g.id}` }]] } : g.status === 'playing' ? { inline_keyboard: [[{ text: 'Abrir mi arco', url: `https://t.me/${botUsername}?start=${g.id}` }]] } : { inline_keyboard: [] };
  await tg('editMessageText', { chat_id: g.chatId, message_id: g.messageId, text: board(g), reply_markup: markup });
}
function person(user) { return { id: user.id, name: (user.first_name || user.username || 'Jugador').slice(0, 40) }; }
async function privateGame(chatId, g, userId) {
  if (!g || !g.players.some(p => p?.id === userId)) { await tg('sendMessage', { chat_id: chatId, text: 'Ese partido no está disponible para vos.' }); return; }
  const intro = g.mode === 'solo' ? '🧤 El Dibu te espera. Tenés cinco penales para meterle goles.' : `⚽ ${board(g)}`;
  await tg('sendMessage', { chat_id: chatId, text: `${intro}\nAbrí el arco y elegí tu sector.`, reply_markup: { inline_keyboard: [[{ text: 'Abrir arco', web_app: { url: `${base}/?game=${g.id}` } }]] } });
}
async function handleUpdate(u) {
  const msg = u.message;
  if (msg?.chat.type === 'private' && (msg.text?.match(/^\/dibu(?:@\w+)?(?:\s|$)/i) || msg.text?.match(/^\/start(?:@\w+)?\s+solo\s*$/i))) {
    const g = newSoloGame(person(msg.from)); games[g.id] = g; persist();
    await privateGame(msg.chat.id, g, msg.from.id); return;
  }
  if (msg?.text?.startsWith('/penales') && msg.chat.type !== 'private') {
    const existing = Object.values(games).find(g => g.chatId === msg.chat.id && ['waiting', 'playing'].includes(g.status));
    if (existing) { await tg('sendMessage', { chat_id: msg.chat.id, text: 'Ya hay un partido en curso en este grupo.' }); return; }
    const sent = await tg('sendMessage', { chat_id: msg.chat.id, text: '⚽ Preparando desafío…' });
    const g = newGame(msg.chat.id, sent.message_id, person(msg.from)); games[g.id] = g; persist(); await updateBoard(g); return;
  }
  if (msg?.chat.type === 'private' && msg.text?.startsWith('/start')) {
    const id = msg.text.split(/\s+/)[1];
    if (id) await privateGame(msg.chat.id, games[id], msg.from.id);
    else await tg('sendMessage', { chat_id: msg.chat.id, text: 'Para jugar solo contra el Dibu: /dibu. Para desafiar a alguien: /penales en un grupo.', reply_markup: { inline_keyboard: [[{ text: '🧤 Patearle al Dibu', callback_data: 'solo' }]] } });
    return;
  }
  const cb = u.callback_query;
  if (cb?.data === 'solo' && cb.message?.chat?.type === 'private') {
    const g = newSoloGame(person(cb.from)); games[g.id] = g; persist();
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    await privateGame(cb.message.chat.id, g, cb.from.id); return;
  }
  if (cb?.data?.startsWith('join:')) {
    const g = games[cb.data.slice(5)];
    if (!g || g.status !== 'waiting' || g.chatId !== cb.message?.chat?.id || g.messageId !== cb.message?.message_id) { await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Este desafío ya no está disponible.', show_alert: true }); return; }
    if (g.players[0].id === cb.from.id) { await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Necesitás un rival distinto.', show_alert: true }); return; }
    g.players[1] = person(cb.from); g.status = 'playing'; persist();
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '¡Aceptaste el desafío!' }); await updateBoard(g);
  }
}
function validateInitData(raw) {
  if (!raw || raw.length > 8192) throw Error('Abrí el arco desde Telegram.');
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw Error('Firma inválida.');
  const pairs = [...params.entries()].filter(([k]) => k !== 'hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(pairs.map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'))) throw Error('Firma inválida.');
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) throw Error('Sesión vencida. Abrí el arco de nuevo.');
  const user = JSON.parse(params.get('user') || '{}');
  if (!Number.isSafeInteger(user.id)) throw Error('Usuario inválido.');
  return user.id;
}
function json(res, status, payload) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); }
async function readBody(req) { let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 12000) throw Error('Solicitud demasiado grande.'); } return JSON.parse(body); }
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    if (req.method === 'POST' && url.pathname === '/telegram/webhook') {
      const received = req.headers['x-telegram-bot-api-secret-token'];
      if (typeof received !== 'string' || received.length !== webhookSecret.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(webhookSecret))) { json(res, 403, { error: 'Firma inválida.' }); return; }
      const update = await readBody(req);
      await handleUpdate(update);
      json(res, 200, { ok: true }); return;
    }
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(path.join(root, 'public', 'index.html'))); return; }
    if (req.method === 'GET' && url.pathname === '/dibu.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(fs.readFileSync(path.join(root, 'public', 'dibu.png'))); return; }
    if (req.method === 'GET' && url.pathname === '/health') { json(res, 200, { ok: true }); return; }
    if (req.method !== 'POST' || url.pathname !== '/api/game') { json(res, 404, { error: 'No encontrado.' }); return; }
    const body = await readBody(req); const id = validateInitData(body.initData);
    const g = games[body.game];
    if (!g || !g.players.some(p => p?.id === id)) { json(res, 403, { error: 'No participás de este partido.' }); return; }
    let outcome = null;
    if (body.action === 'restart' && g.mode === 'solo' && g.status === 'finished') {
      const fresh = newSoloGame(g.players[0]);
      Object.assign(g, { scores: fresh.scores, shots: fresh.shots, turn: 0, picks: {}, results: [], status: 'playing' });
      persist();
    } else if (body.action === 'pick') {
      outcome = select(g, id, body.sector); persist();
      if (outcome && g.mode !== 'solo') { try { await updateBoard(g); } catch (e) { console.error('No se pudo actualizar el grupo:', e); } }
    } else if (body.action !== 'state') throw Error('Acción inválida.');
    json(res, 200, { state: publicState(g, id), outcome });
  } catch (e) { json(res, 400, { error: e.message }); }
});
server.listen(port, () => console.log(`Servidor escuchando en puerto ${port}`));
async function setupWebhook() {
  botUsername = (await tg('getMe', {})).username;
  await tg('setWebhook', { url: `${base}/telegram/webhook`, secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'], max_connections: 1 });
  console.log('Webhook configurado.');
}
setupWebhook().catch(e => { console.error(e); process.exit(1); });

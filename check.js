const fs = require('fs');

const checks = JSON.parse(fs.readFileSync('checks.json', 'utf8'));
const prev = fs.existsSync('state.json') ? JSON.parse(fs.readFileSync('state.json', 'utf8')) : { sites: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RINGS = 10;
const EVERY_MS = 30000;

async function probe(c) {
  const t0 = Date.now();
  try {
    const r = await fetch(c.url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'boostbase-uptime' } });
    const body = c.expect ? await r.text() : '';
    const okStatus = (c.status || [200]).includes(r.status);
    const okBody = !c.expect || body.includes(c.expect);
    return { up: okStatus && okBody, why: okStatus ? (okBody ? '' : 'page loaded without its content') : 'HTTP ' + r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { up: false, why: e.name === 'TimeoutError' ? 'no answer in 20s' : e.message, ms: Date.now() - t0 };
  }
}

async function check(c) {
  for (let i = 0; i < 3; i++) {
    const r = await probe(c);
    if (r.up) return r;
    if (i < 2) await sleep(20000);
    else return r;
  }
}

async function tg(method, payload) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return { ok: false, description: 'secrets not set' };
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ chat_id: chat }, payload))
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: e.message };
  }
}

async function ring(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('::warning::Telegram secrets are not set, alert only logged');
    return;
  }
  let last = null;
  for (let n = 1; n <= RINGS; n++) {
    if (last) {
      const gone = await tg('deleteMessage', { message_id: last });
      if (!gone.ok && /not found/i.test(gone.description || '')) {
        console.log('Got it pressed after ring ' + (n - 1));
        return;
      }
    }
    const final = n === RINGS;
    const buttons = [{ text: 'Open site', url: 'https://www.boostbasegg.com/' }];
    if (!final) buttons.unshift({ text: '✅ Got it', callback_data: 'up:ack' });
    const sent = await tg('sendMessage', {
      text: text + '\n\n' + (final ? '🔕 Last ring, ' + RINGS + ' of ' + RINGS : '🔔 Ring ' + n + ' of ' + RINGS),
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [buttons] }
    });
    if (!sent.ok) {
      console.log('::warning::Telegram answered ' + (sent.description || 'an error'));
      return;
    }
    last = sent.result.message_id;
    if (!final) await sleep(EVERY_MS);
  }
  console.log('Rang ' + RINGS + ' times without Got it');
}

(async () => {
  const now = new Date().toISOString();
  const results = await Promise.all(checks.map(async c => [c, await check(c)]));
  const sites = {};
  const fresh = [];
  const back = [];
  for (const [c, r] of results) {
    const was = prev.sites[c.name] || { up: true };
    sites[c.name] = { up: r.up, why: r.why, since: was.up === r.up && was.since ? was.since : now };
    console.log(`${r.up ? 'UP  ' : 'DOWN'} ${c.name} ${r.ms}ms ${r.why}`);
    if (!r.up && was.up !== false) fresh.push(`${c.name}: ${r.why}\n${c.url}`);
    else if (r.up && was.up === false) back.push(`🟢 ${c.name} is back up after ${Math.round((Date.now() - Date.parse(was.since)) / 60000)} min`);
  }
  const down = Object.entries(sites).filter(([, s]) => !s.up).map(([n]) => n);
  const summary = down.length ? 'down: ' + down.join(', ') : 'all up';
  const changed = JSON.stringify(Object.fromEntries(Object.entries(sites).map(([n, s]) => [n, s.up]))) !==
    JSON.stringify(Object.fromEntries(Object.entries(prev.sites).map(([n, s]) => [n, s.up])));
  const month = now.slice(0, 7);
  if (changed || prev.month !== month) fs.writeFileSync('state.json', JSON.stringify({ summary, month, sites }, null, 2) + '\n');

  if (back.length) await tg('sendMessage', { text: back.join('\n'), disable_web_page_preview: true });
  if (fresh.length) await ring('🔴 BoostBase is down\n\n' + fresh.join('\n\n'));
  else if (process.env.SEND_TEST === 'true') await ring('🧪 BoostBase uptime test\nPress Got it to stop the ringing');
})();

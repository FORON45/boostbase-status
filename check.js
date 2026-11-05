const fs = require('fs');

const checks = JSON.parse(fs.readFileSync('checks.json', 'utf8'));
const prev = fs.existsSync('state.json') ? JSON.parse(fs.readFileSync('state.json', 'utf8')) : { sites: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function telegram(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) { console.log('::warning::Telegram secrets are not set, alert only logged'); return; }
  const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true })
  });
  if (!r.ok) console.log('::warning::Telegram answered ' + r.status);
}

(async () => {
  const now = new Date().toISOString();
  const results = await Promise.all(checks.map(async c => [c, await check(c)]));
  const sites = {};
  const alerts = [];
  for (const [c, r] of results) {
    const was = prev.sites[c.name] || { up: true };
    sites[c.name] = { up: r.up, why: r.why, since: was.up === r.up && was.since ? was.since : now };
    console.log(`${r.up ? 'UP  ' : 'DOWN'} ${c.name} ${r.ms}ms ${r.why}`);
    if (!r.up) alerts.push(`🔴 ${c.name} is down: ${r.why}\n${c.url}`);
    else if (was.up === false) alerts.push(`🟢 ${c.name} is back up after ${Math.round((Date.now() - Date.parse(was.since)) / 60000)} min`);
  }
  if (alerts.length) await telegram(alerts.join('\n\n'));
  const down = Object.entries(sites).filter(([, s]) => !s.up).map(([n]) => n);
  const summary = down.length ? 'down: ' + down.join(', ') : 'all up';
  const changed = JSON.stringify(Object.fromEntries(Object.entries(sites).map(([n, s]) => [n, s.up]))) !==
    JSON.stringify(Object.fromEntries(Object.entries(prev.sites).map(([n, s]) => [n, s.up])));
  const month = now.slice(0, 7);
  if (changed || prev.month !== month) fs.writeFileSync('state.json', JSON.stringify({ summary, month, sites }, null, 2) + '\n');
})();

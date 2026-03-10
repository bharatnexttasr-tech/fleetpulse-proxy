const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const TARGET         = 'http://3.7.16.195/webservice';
const PROJECT_ID     = 49;
const PORT           = process.env.PORT || 3000;
const SNAPSHOT_EVERY = 5 * 60 * 1000;
const ALERT_COOLDOWN = 30 * 60 * 1000;

const TG_TOKEN   = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const USERNAME   = process.env.USERNAME;
const PASSWORD   = process.env.PASSWORD;

const OVERSPEED_KMH = 80;
const STOPPED_HOURS = 2;
const COMPANY       = 'UIPL';

let authToken     = null;
let tokenExpiry   = null;
let alertCooldown = {};
let snapshots     = {};
let reportsHistory = [];
let latestReport   = null;
let snapshotCount  = 0;

// ── HTTP SERVER ────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, auth-code');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  const pu = url.parse(req.url);
  if (req.method === 'GET' && pu.pathname === '/report') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ latest: latestReport, history: reportsHistory.slice(-96) }));
    return;
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end('Not allowed'); return; }
  const targetUrl = TARGET + (pu.search || '');
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (req.headers['auth-code']) headers['auth-code'] = req.headers['auth-code'];
    const p = url.parse(targetUrl);
    const opts = { hostname: p.hostname, port: p.port || 80, path: p.path, method: 'POST', headers };
    const pr = http.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { res.writeHead(r.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(d); });
    });
    pr.on('error', e => { res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: e.message })); });
    pr.write(body); pr.end();
  });
});

server.listen(PORT, () => { console.log('FleetPulse on port ' + PORT); startSystem(); });

// ── TELEGRAM TEXT ─────────────────────────────────────────
function sendTelegram(message) {
  return new Promise((resolve) => {
    if (!TG_TOKEN || !TG_CHAT_ID) { resolve(null); return; }
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: message, parse_mode: 'HTML' });
    const tgUrl = url.parse('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage');
    const opts = { hostname: tgUrl.hostname, path: tgUrl.path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); });
    req.on('error', e => { console.error('TG err:', e.message); resolve(null); });
    req.write(body); req.end();
  });
}

// ── TELEGRAM PDF ──────────────────────────────────────────
function sendTelegramDocument(filePath, caption) {
  return new Promise((resolve) => {
    if (!TG_TOKEN || !TG_CHAT_ID) { resolve(null); return; }
    const fileContent = fs.readFileSync(filePath);
    const fileName    = path.basename(filePath);
    const boundary    = '----FPBoundary' + Date.now();
    const p1 = '--' + boundary + '\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n' + TG_CHAT_ID + '\r\n';
    const p2 = '--' + boundary + '\r\nContent-Disposition: form-data; name="caption"\r\n\r\n' + caption + '\r\n';
    const p3 = '--' + boundary + '\r\nContent-Disposition: form-data; name="document"; filename="' + fileName + '"\r\nContent-Type: application/pdf\r\n\r\n';
    const p4 = '\r\n--' + boundary + '--\r\n';
    const bodyBuffer = Buffer.concat([Buffer.from(p1), Buffer.from(p2), Buffer.from(p3), fileContent, Buffer.from(p4)]);
    const tgUrl = url.parse('https://api.telegram.org/bot' + TG_TOKEN + '/sendDocument');
    const opts = { hostname: tgUrl.hostname, path: tgUrl.path, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': bodyBuffer.length } };
    const req = https.request(opts, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { console.log('PDF sent to Telegram'); resolve(d); }); });
    req.on('error', e => { console.error('PDF TG err:', e.message); resolve(null); });
    req.write(bodyBuffer); req.end();
  });
}

// ── GENERATE PDF ──────────────────────────────────────────
function generatePDF(report) {
  const now = new Date(report.time);
  const timeStr = now.toLocaleString('en-IN');
  const s = report.summary;
  try {
    const PDFDocument = require('pdfkit');
    const filePath = '/tmp/fleet_' + Date.now() + '.pdf';
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(18).font('Helvetica-Bold').text('FleetPulse - UIPL Fleet Report', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('Generated: ' + timeStr, { align: 'center' });
    doc.moveDown();
    doc.fontSize(13).font('Helvetica-Bold').text('Fleet Summary');
    doc.fontSize(10).font('Helvetica');
    doc.text('Total: ' + s.total + '   Running: ' + s.running + '   Stopped: ' + s.stopped + '   Inactive: ' + s.inactive);
    doc.moveDown();
    doc.fontSize(13).font('Helvetica-Bold').text('Vehicle Details');
    doc.moveDown(0.3);
    const cols = [150, 70, 65, 75, 65, 75, 50];
    const heads = ['Vehicle', 'Status', 'Speed', 'Max Spd', 'Work', 'Fuel Delta', 'GPS'];
    let x = 40; const hy = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    heads.forEach((h, i) => { doc.text(h, x, hy, { width: cols[i], continued: i < heads.length - 1 }); x += cols[i]; });
    doc.font('Helvetica').moveDown(0.2);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke(); doc.moveDown(0.3);
    (report.vehicles || []).forEach(v => {
      const wm = parseInt(v.workMins) || 0;
      const wh = Math.floor(wm / 60); const wmin = wm % 60;
      const ws = wm > 0 ? (wh > 0 ? wh + 'h ' + wmin + 'm' : wmin + 'm') : '-';
      const row = [v.name, v.status, v.speed + ' km/h', v.maxSpeed + ' km/h', ws, String(v.fuel || '-'), v.gps];
      x = 40; const ry = doc.y;
      doc.fontSize(8).font('Helvetica');
      row.forEach((cell, i) => { doc.text(String(cell).substring(0, 20), x, ry, { width: cols[i], continued: i < row.length - 1 }); x += cols[i]; });
      doc.moveDown(0.3);
    });
    doc.moveDown();
    doc.fontSize(8).fillColor('grey').text('FleetPulse Automated Report - TASR Fleet Management', { align: 'center' });
    doc.end();
    return new Promise((resolve, reject) => { stream.on('finish', () => resolve(filePath)); stream.on('error', reject); });
  } catch (e) {
    console.log('PDFKit unavailable, using text fallback:', e.message);
    const lines = ['FLEETPULSE - UIPL FLEET REPORT', 'Generated: ' + timeStr, '', 'SUMMARY', 'Total: ' + s.total + ' | Running: ' + s.running + ' | Stopped: ' + s.stopped + ' | Inactive: ' + s.inactive, '', 'VEHICLES'];
    (report.vehicles || []).forEach(v => {
      const wm = parseInt(v.workMins) || 0; const wh = Math.floor(wm / 60); const wmin = wm % 60;
      lines.push(v.name + ' | ' + v.status + ' | ' + v.speed + 'km/h | Max:' + v.maxSpeed + 'km/h | ' + (wm > 0 ? (wh > 0 ? wh + 'h ' + wmin + 'm' : wmin + 'm') : '-') + ' | Fuel:' + (v.fuel || '-') + ' | GPS:' + v.gps);
    });
    const fp = '/tmp/fleet_' + Date.now() + '.txt';
    fs.writeFileSync(fp, lines.join('\n'));
    return Promise.resolve(fp);
  }
}

// ── API ────────────────────────────────────────────────────
function apiPost(apiPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const pb = JSON.stringify(body);
    const p = url.parse(TARGET + apiPath);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pb), ...extraHeaders };
    const opts = { hostname: p.hostname, port: p.port || 80, path: p.path, method: 'POST', headers };
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('Bad JSON')); } });
    });
    req.on('error', reject);
    req.write(pb); req.end();
  });
}

async function getToken() {
  if (authToken && tokenExpiry && Date.now() < tokenExpiry) return authToken;
  const res = await apiPost('?token=generateAccessToken', { username: USERNAME, password: PASSWORD });
  if (res.result !== 1) throw new Error('Token failed');
  authToken = res.data.token;
  tokenExpiry = Date.now() + 28 * 60 * 1000;
  return authToken;
}

async function fetchVehicles() {
  const token = await getToken();
  const res = await apiPost('?token=getTokenBaseLiveData&ProjectId=' + PROJECT_ID, { company_names: COMPANY, format: 'json' }, { 'auth-code': token });
  return (res.root && res.root.VehicleData) ? res.root.VehicleData : [];
}

// ── SNAPSHOT ──────────────────────────────────────────────
function takeSnapshot(vehicles) {
  vehicles.forEach(v => {
    const id = v.Vehicle_Name || v.Vehicle_No || v.Imeino;
    if (!snapshots[id]) snapshots[id] = [];
    const fuelVal = (v.Fuel && v.Fuel.length > 0) ? v.Fuel[0].value : null;
    snapshots[id].push({ time: Date.now(), status: v.Status || 'UNKNOWN', speed: parseInt(v.Speed) || 0, fuel: fuelVal, loc: v.Location || '', gps: v.GPS || 'OFF' });
    if (snapshots[id].length > 12) snapshots[id] = snapshots[id].slice(-12);
  });
}

// ── ALERTS ────────────────────────────────────────────────
function canAlert(id, type) {
  const key = id + '_' + type;
  if (!alertCooldown[key] || Date.now() - alertCooldown[key] > ALERT_COOLDOWN) { alertCooldown[key] = Date.now(); return true; }
  return false;
}

async function checkAlerts(vehicles) {
  const now = new Date();
  for (const v of vehicles) {
    const name = v.Vehicle_Name || v.Vehicle_No || 'Unknown';
    const status = (v.Status || '').toUpperCase();
    const speed = parseInt(v.Speed) || 0;
    const gps = v.GPS || '';
    const loc = v.Location || '-';
    const dt = v.Datetime || '';
    if (speed > OVERSPEED_KMH && canAlert(name, 'OVER'))
      await sendTelegram('\ud83d\udea8 <b>OVERSPEED</b>\n\ud83d\ude9b ' + name + '\n\u26a1 <b>' + speed + ' km/h</b>\n\ud83d\udccd ' + loc + '\n\ud83d\udd50 ' + dt);
    if (gps !== 'ON' && canAlert(name, 'GPS'))
      await sendTelegram('\ud83d\udce1 <b>GPS DISCONNECTED</b>\n\ud83d\ude9b ' + name + '\n\ud83d\udd50 ' + dt);
    if (status === 'STOP' && dt) {
      try {
        const parts = dt.split(' '); const dp = parts[0].split('-').map(Number); const tp = parts[1].split(':').map(Number);
        const last = new Date(dp[2], dp[1] - 1, dp[0], tp[0], tp[1], tp[2]);
        const hrs = (now - last) / 3600000;
        if (hrs >= STOPPED_HOURS && canAlert(name, 'STOP'))
          await sendTelegram('\ud83d\uded1 <b>STOPPED ' + hrs.toFixed(1) + ' HRS</b>\n\ud83d\ude9b ' + name + '\n\ud83d\udccd ' + loc + '\n\ud83d\udd50 ' + dt);
      } catch (e) {}
    }
  }
}

// ── 15-MIN REPORT + PDF ───────────────────────────────────
async function generate15MinReport(vehicles) {
  const now = new Date();
  let running = 0, stopped = 0, inactive = 0;
  const rows = [];
  for (const v of vehicles) {
    const id = v.Vehicle_Name || v.Vehicle_No || v.Imeino;
    const status = (v.Status || 'UNKNOWN').toUpperCase();
    const speed = parseInt(v.Speed) || 0;
    const gps = v.GPS || 'OFF';
    if (status === 'RUNNING') running++;
    else if (status === 'STOP') stopped++;
    else inactive++;
    const snaps = (snapshots[id] || []).slice(-3);
    const maxSpeed = snaps.length > 0 ? Math.max(...snaps.map(s => s.speed), speed) : speed;
    const workMins = snaps.filter(s => s.status === 'RUNNING' || s.status === 'STOP').length * 5;
    let fuel = '-';
    const fs2 = snaps.filter(s => s.fuel !== null);
    if (fs2.length >= 2) {
      const diff = fs2[0].fuel - fs2[fs2.length - 1].fuel;
      fuel = diff > 0 ? '-' + diff : (diff < 0 ? '+' + Math.abs(diff) + '(fill)' : '0');
    } else if (v.Fuel && v.Fuel.length > 0) fuel = 'S:' + v.Fuel[0].value;
    rows.push({ name: id, status, speed, maxSpeed, workMins, fuel, gps, loc: v.Location || '-' });
  }
  const report = { time: now.toISOString(), summary: { total: vehicles.length, running, stopped, inactive }, vehicles: rows };
  latestReport = report;
  reportsHistory.push(report);
  if (reportsHistory.length > 96) reportsHistory = reportsHistory.slice(-96);

  // Telegram text
  const si = s => s === 'RUNNING' ? '\ud83d\udfe2' : s === 'STOP' ? '\ud83d\udd34' : '\ud83d\ude34';
  const gi = g => g === 'ON' ? '\ud83d\udce1' : '\u274c';
  let msg = '\ud83d\udccb <b>UIPL FLEET REPORT</b>\n\ud83d\udd50 ' + now.toLocaleTimeString('en-IN', { hour12: false }) + ' | ' + now.toLocaleDateString('en-IN') + '\n';
  msg += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n';
  msg += '\ud83d\udfe2 <b>' + running + '</b> Running  \ud83d\udd34 <b>' + stopped + '</b> Stopped  \ud83d\ude34 <b>' + inactive + '</b> Inactive\n';
  msg += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n';
  rows.forEach(r => {
    const wm = parseInt(r.workMins) || 0; const wh = Math.floor(wm / 60); const wmin = wm % 60;
    msg += si(r.status) + ' <b>' + r.name + '</b> ' + gi(r.gps) + '\n';
    msg += '  \u26a1 ' + r.speed + 'km/h | Max: ' + r.maxSpeed + 'km/h\n';
    msg += '  \u23f1 ' + (wm > 0 ? (wh > 0 ? wh + 'h ' + wmin + 'm' : wmin + 'm') : '-') + '  \u26fd ' + r.fuel + '\n\n';
  });
  if (msg.length <= 4096) await sendTelegram(msg);
  else await sendTelegram('\ud83d\udccb <b>UIPL REPORT</b> ' + now.toLocaleTimeString('en-IN', { hour12: false }) + '\n\ud83d\udfe2' + running + ' \ud83d\udd34' + stopped + ' \ud83d\ude34' + inactive + '\n(See attached PDF)');

  // PDF
  try {
    const pdfPath = await generatePDF(report);
    await sendTelegramDocument(pdfPath, '\ud83d\udccb UIPL Fleet Report - ' + now.toLocaleString('en-IN'));
    try { fs.unlinkSync(pdfPath); } catch (e) {}
  } catch (e) { console.error('PDF error:', e.message); }
  console.log('15-min report sent: ' + vehicles.length + ' vehicles');
}

// ── MAIN LOOP ─────────────────────────────────────────────
async function runCycle() {
  console.log('[' + new Date().toLocaleString() + '] Cycle...');
  try {
    const vehicles = await fetchVehicles();
    console.log(vehicles.length + ' vehicles');
    takeSnapshot(vehicles);
    await checkAlerts(vehicles);
    snapshotCount++;
    if (snapshotCount % 3 === 0) await generate15MinReport(vehicles);
  } catch (e) {
    console.error('Cycle error:', e.message);
    if (e.message.includes('Token') || e.message.includes('auth')) authToken = null;
  }
}

function startSystem() {
  sendTelegram('\ud83d\ude80 <b>FleetPulse v2 Started!</b>\n\n\ud83c\udfed UIPL\n\ud83d\udcf8 Snapshot: 5 mins\n\ud83d\udccb Report + PDF: 15 mins\n\n\ud83d\udea8 Overspeed | \ud83d\uded1 Stopped | \ud83d\udce1 GPS alerts active');
  setTimeout(runCycle, 10000);
  setInterval(runCycle, SNAPSHOT_EVERY);
        }

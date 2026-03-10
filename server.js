const http = require('http');
const https = require('https');
const url = require('url');

// ─── CONFIG ───────────────────────────────────────────────
const TARGET          = 'http://3.7.16.195/webservice';
const PROJECT_ID      = 49;
const PORT            = process.env.PORT || 3000;
const SNAPSHOT_EVERY  = 5 * 60 * 1000;   // snapshot every 5 min
const REPORT_EVERY    = 15 * 60 * 1000;  // report every 15 min
const ALERT_COOLDOWN  = 30 * 60 * 1000;  // 30 min between same alert

// Telegram
const TG_TOKEN   = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

// Credentials
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;

// Thresholds
const OVERSPEED_KMH = 80;
const STOPPED_HOURS = 2;
const INACTIVE_DAYS = 1;
const COMPANY       = 'UIPL';

// ─── STATE ────────────────────────────────────────────────
let authToken    = null;
let tokenExpiry  = null;
let alertCooldown = {};

// Snapshots: { vehicleId: [{ time, status, speed, fuel }] }
let snapshots = {};

// Reports history (last 96 = 24 hrs of 15-min reports)
let reportsHistory = [];
let latestReport   = null;

// ─── HTTP SERVER ──────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, auth-code');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const pu = url.parse(req.url);

  // GET /report → latest report + history for dashboard
  if (req.method === 'GET' && pu.pathname === '/report') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ latest: latestReport, history: reportsHistory.slice(-96) }));
    return;
  }

  // POST proxy for live dashboard
  if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }
  const targetUrl = TARGET + (pu.search || '');
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (req.headers['auth-code']) headers['auth-code'] = req.headers['auth-code'];
    const p = url.parse(targetUrl);
    const opts = { hostname: p.hostname, port: p.port || 80, path: p.path, method: 'POST', headers };
    const pr = http.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        res.writeHead(r.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(d);
      });
    });
    pr.on('error', e => {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    });
    pr.write(body); pr.end();
  });
});

server.listen(PORT, () => {
  console.log('FleetPulse server running on port ' + PORT);
  startSystem();
});

// ─── TELEGRAM ─────────────────────────────────────────────
function sendTelegram(message) {
  return new Promise((resolve) => {
    if (!TG_TOKEN || !TG_CHAT_ID) { console.log('No TG creds'); resolve(null); return; }
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: message, parse_mode: 'HTML' });
    const tgUrl = url.parse(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
    const opts = {
      hostname: tgUrl.hostname, path: tgUrl.path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { console.log('TG sent: ' + message.substring(0,50)); resolve(d); });
    });
    req.on('error', e => { console.error('TG error:', e.message); resolve(null); });
    req.write(body); req.end();
  });
}

// ─── API ──────────────────────────────────────────────────
function apiPost(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const pb = JSON.stringify(body);
    const p = url.parse(TARGET + path);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pb), ...extraHeaders };
    const opts = { hostname: p.hostname, port: p.port || 80, path: p.path, method: 'POST', headers };
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('Bad JSON: ' + d.substring(0,80))); } });
    });
    req.on('error', reject);
    req.write(pb); req.end();
  });
}

async function getToken() {
  if (authToken && tokenExpiry && Date.now() < tokenExpiry) return authToken;
  console.log('Getting token...');
  const res = await apiPost('?token=generateAccessToken', { username: USERNAME, password: PASSWORD });
  if (res.result !== 1) throw new Error('Token failed');
  authToken = res.data.token;
  tokenExpiry = Date.now() + 28 * 60 * 1000;
  console.log('Token OK');
  return authToken;
}

async function fetchVehicles() {
  const token = await getToken();
  const res = await apiPost(
    '?token=getTokenBaseLiveData&ProjectId=' + PROJECT_ID,
    { company_names: COMPANY, format: 'json' },
    { 'auth-code': token }
  );
  return (res.root && res.root.VehicleData) ? res.root.VehicleData : [];
}

// ─── SNAPSHOT ─────────────────────────────────────────────
function takeSnapshot(vehicles) {
  const now = Date.now();
  vehicles.forEach(v => {
    const id = v.Vehicle_Name || v.Vehicle_No || v.Imeino;
    if (!snapshots[id]) snapshots[id] = [];

    const fuelVal = (v.Fuel && v.Fuel.length > 0) ? v.Fuel[0].value : null;
    snapshots[id].push({
      time:   now,
      status: v.Status || 'UNKNOWN',
      speed:  parseInt(v.Speed) || 0,
      fuel:   fuelVal,
      loc:    v.Location || '',
      driver: [v.Driver_First_Name, v.Driver_Last_Name].filter(x => x && x !== '--' && x !== 'null').join(' ') || '—',
      gps:    v.GPS || 'OFF'
    });

    // keep only last 12 snapshots (1 hr)
    if (snapshots[id].length > 12) snapshots[id] = snapshots[id].slice(-12);
  });
  console.log('Snapshot taken: ' + vehicles.length + ' vehicles at ' + new Date().toLocaleTimeString());
}

// ─── ALERTS ───────────────────────────────────────────────
function canAlert(id, type) {
  const key = id + '_' + type;
  const last = alertCooldown[key];
  if (!last || Date.now() - last > ALERT_COOLDOWN) { alertCooldown[key] = Date.now(); return true; }
  return false;
}

async function checkAlerts(vehicles) {
  const now = new Date();
  for (const v of vehicles) {
    const name   = v.Vehicle_Name || v.Vehicle_No || 'Unknown';
    const status = (v.Status || '').toUpperCase();
    const speed  = parseInt(v.Speed) || 0;
    const gps    = v.GPS || '';
    const loc    = v.Location || '—';
    const dt     = v.Datetime || '';

    if (speed > OVERSPEED_KMH && canAlert(name, 'OVER')) {
      await sendTelegram('🚨 <b>OVERSPEED</b>\n🚛 ' + name + '\n⚡ <b>' + speed + ' km/h</b>\n📍 ' + loc + '\n🕐 ' + dt);
    }
    if (gps !== 'ON' && canAlert(name, 'GPS')) {
      await sendTelegram('📡 <b>GPS DISCONNECTED</b>\n🚛 ' + name + '\n🕐 ' + dt);
    }
    if (status === 'STOP' && dt) {
      try {
        const p = dt.split(' '); const dp = p[0].split('-').map(Number); const tp = p[1].split(':').map(Number);
        const last = new Date(dp[2], dp[1]-1, dp[0], tp[0], tp[1], tp[2]);
        const hrs = (now - last) / 3600000;
        if (hrs >= STOPPED_HOURS && canAlert(name, 'STOP')) {
          await sendTelegram('🛑 <b>STOPPED ' + hrs.toFixed(1) + ' HRS</b>\n🚛 ' + name + '\n📍 ' + loc + '\n🕐 ' + dt);
        }
      } catch(e) {}
    }
  }
}

// ─── 15-MIN REPORT ────────────────────────────────────────
async function generate15MinReport(vehicles) {
  const now = new Date();
  const reportTime = now.toLocaleTimeString('en-IN', { hour12: false });
  const reportDate = now.toLocaleDateString('en-IN');

  let totalRunning = 0, totalStop = 0, totalInactive = 0;
  const vehicleRows = [];

  for (const v of vehicles) {
    const id     = v.Vehicle_Name || v.Vehicle_No || v.Imeino;
    const status = (v.Status || 'UNKNOWN').toUpperCase();
    const speed  = parseInt(v.Speed) || 0;
    const gps    = v.GPS || 'OFF';

    if (status === 'RUNNING') totalRunning++;
    else if (status === 'STOP') totalStop++;
    else totalInactive++;

    // Get snapshots for this vehicle (last 3 = 15 mins)
    const snaps = (snapshots[id] || []).slice(-3);

    // Max speed in period
    const maxSpeed = snaps.length > 0
      ? Math.max(...snaps.map(s => s.speed), speed)
      : speed;

    // Work hours: count snapshots where status is RUNNING or STOP (not INACTIVE)
    const workSnaps = snaps.filter(s => s.status === 'RUNNING' || s.status === 'STOP').length;
    const workMins  = workSnaps * 5; // each snap = 5 min

    // Fuel consumption (first - last sensor value)
    let fuelChange = '—';
    const fuelSnaps = snaps.filter(s => s.fuel !== null);
    if (fuelSnaps.length >= 2) {
      const fuelStart = fuelSnaps[0].fuel;
      const fuelEnd   = fuelSnaps[fuelSnaps.length - 1].fuel;
      const diff = fuelStart - fuelEnd;
      fuelChange = diff > 0 ? '-' + diff : (diff < 0 ? '+' + Math.abs(diff) + '(fill)' : '0');
    } else if (v.Fuel && v.Fuel.length > 0) {
      fuelChange = 'Sensor: ' + v.Fuel[0].value;
    }

    vehicleRows.push({
      name:      id,
      status:    status,
      speed:     speed,
      maxSpeed:  maxSpeed,
      workMins:  workMins,
      fuel:      fuelChange,
      gps:       gps,
      loc:       v.Location || '—'
    });
  }

  // Build Telegram message
  const statusIcon = s => s === 'RUNNING' ? '🟢' : s === 'STOP' ? '🔴' : '😴';
  const gpsIcon    = g => g === 'ON' ? '📡' : '❌';

  let msg = '📋 <b>UIPL FLEET REPORT</b>\n';
  msg += '🕐 ' + reportTime + ' | ' + reportDate + '\n';
  msg += '━━━━━━━━━━━━━━━━━━━\n';
  msg += '🟢 Running: <b>' + totalRunning + '</b>  🔴 Stopped: <b>' + totalStop + '</b>  😴 Inactive: <b>' + totalInactive + '</b>\n';
  msg += '━━━━━━━━━━━━━━━━━━━\n\n';

  vehicleRows.forEach(r => {
    msg += statusIcon(r.status) + ' <b>' + r.name + '</b> ' + gpsIcon(r.gps) + '\n';
    msg += '  ⚡ Speed: ' + r.speed + ' km/h | Max: ' + r.maxSpeed + ' km/h\n';
    msg += '  ⏱ Work: ' + (r.workMins > 0 ? r.workMins + ' min' : '—') + '\n';
    msg += '  ⛽ Fuel Δ: ' + r.fuel + '\n';
    msg += '  📍 ' + r.loc.substring(0, 50) + '\n\n';
  });

  msg += '━━━━━━━━━━━━━━━━━━━\n';
  msg += '🚛 Total: <b>' + vehicles.length + ' vehicles</b> | UIPL';

  // Save report
  const report = {
    time:     now.toISOString(),
    summary:  { total: vehicles.length, running: totalRunning, stopped: totalStop, inactive: totalInactive },
    vehicles: vehicleRows
  };
  latestReport = report;
  reportsHistory.push(report);
  if (reportsHistory.length > 96) reportsHistory = reportsHistory.slice(-96);

  // Split message if too long (Telegram limit 4096 chars)
  if (msg.length <= 4096) {
    await sendTelegram(msg);
  } else {
    // Send summary first
    let sumMsg = '📋 <b>UIPL FLEET REPORT</b> | ' + reportTime + '\n';
    sumMsg += '🟢 <b>' + totalRunning + '</b> Running  🔴 <b>' + totalStop + '</b> Stopped  😴 <b>' + totalInactive + '</b> Inactive\n\n';
    vehicleRows.forEach(r => {
      sumMsg += statusIcon(r.status) + ' ' + r.name + ' | ' + r.speed + 'km/h | ⛽' + r.fuel + ' | ⏱' + r.workMins + 'min\n';
    });
    await sendTelegram(sumMsg);
  }

  console.log('15-min report sent: ' + vehicles.length + ' vehicles');
}

// ─── MAIN SYSTEM ──────────────────────────────────────────
let snapshotCount = 0;

async function runCycle() {
  console.log('\n[' + new Date().toLocaleString() + '] Running cycle...');
  try {
    const vehicles = await fetchVehicles();
    console.log(vehicles.length + ' vehicles fetched');

    takeSnapshot(vehicles);
    await checkAlerts(vehicles);

    snapshotCount++;
    // Every 3rd snapshot = 15 mins → generate report
    if (snapshotCount % 3 === 0) {
      await generate15MinReport(vehicles);
    }
  } catch(e) {
    console.error('Cycle error:', e.message);
    if (e.message.includes('Token') || e.message.includes('auth')) authToken = null;
  }
}

function startSystem() {
  sendTelegram(
    '🚀 <b>FleetPulse Monitoring Started!</b>\n\n' +
    '🏭 Company: <b>UIPL</b>\n' +
    '📸 Snapshot: every 5 mins\n' +
    '📋 Full report: every 15 mins\n\n' +
    'Alerts: 🚨 Overspeed | 🛑 Stopped | 📡 GPS\n' +
    'Report includes: Speed, Max Speed, Work Hours, Fuel Δ'
  );
  // First run after 10 sec
  setTimeout(runCycle, 10000);
  // Then every 5 min
  setInterval(runCycle, SNAPSHOT_EVERY);
}

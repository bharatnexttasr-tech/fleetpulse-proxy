const http = require('http');
const https = require('https');
const url = require('url');

// CONFIG
const TARGET         = 'http://3.7.16.195/webservice';
const PROJECT_ID     = 49;
const PORT           = process.env.PORT || 3000;
const CHECK_INTERVAL = 5 * 60 * 1000;

// Telegram
const TG_TOKEN   = '8634539170:AAGO3FP2psy9rFxzygINlL6S2TznUXnc5rY';
const TG_CHAT_ID = '8768720207';
const TG_URL     = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;

// Thresholds
const OVERSPEED_KMH  = 80;
const STOPPED_HOURS  = 2;
const INACTIVE_DAYS  = 1;

// Companies
const COMPANIES = ['B S Sponge Pvt Ltd','NAGESHWAR','Shitla Enterprises','PPBCL','UIPL'];

// Credentials
const USERNAME = 'tasr.bharatnext@gmail.com';
const PASSWORD = 'Login@123';

// State
let authToken    = null;
let tokenExpiry  = null;
let alertCooldown = {};
const COOLDOWN_MS = 30 * 60 * 1000;

// HTTP Proxy Server (for dashboard)
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, auth-code');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }
  const parsedUrl = url.parse(req.url);
  const targetUrl = TARGET + (parsedUrl.search || '');
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (req.headers['auth-code']) headers['auth-code'] = req.headers['auth-code'];
    const parsed = url.parse(targetUrl);
    const opts = { hostname: parsed.hostname, port: parsed.port || 80, path: parsed.path, method: 'POST', headers };
    const pr = http.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { res.writeHead(r.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(d); });
    });
    pr.on('error', e => { res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: e.message })); });
    pr.write(body); pr.end();
  });
});

server.listen(PORT, () => {
  console.log('FleetPulse Proxy running on port ' + PORT);
  startMonitoring();
});

// Telegram
function sendTelegram(message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: message, parse_mode: 'HTML' });
    const parsed = url.parse(TG_URL);
    const opts = { hostname: parsed.hostname, path: parsed.path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { console.log('Telegram sent'); resolve(d); }); });
    req.on('error', e => { console.error('Telegram error:', e.message); resolve(null); });
    req.write(body); req.end();
  });
}

// API helpers
function apiPost(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const postBody = JSON.stringify(body);
    const parsed = url.parse(TARGET + path);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postBody), ...extraHeaders };
    const opts = { hostname: parsed.hostname, port: parsed.port || 80, path: parsed.path, method: 'POST', headers };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('Invalid JSON: ' + d.substring(0,100))); } });
    });
    req.on('error', reject);
    req.write(postBody); req.end();
  });
}

async function getToken() {
  if (authToken && tokenExpiry && Date.now() < tokenExpiry) return authToken;
  console.log('Getting new token...');
  const res = await apiPost('?token=generateAccessToken', { username: USERNAME, password: PASSWORD });
  if (res.result !== 1) throw new Error('Token failed');
  authToken = res.data.token;
  tokenExpiry = Date.now() + 28 * 60 * 1000;
  return authToken;
}

async function fetchCompany(company) {
  const token = await getToken();
  const res = await apiPost('?token=getTokenBaseLiveData&ProjectId=' + PROJECT_ID, { company_names: company, format: 'json' }, { 'auth-code': token });
  return res.root && res.root.VehicleData ? res.root.VehicleData : [];
}

function canAlert(vehicleId, alertType) {
  const key = vehicleId + '_' + alertType;
  const last = alertCooldown[key];
  if (!last || Date.now() - last > COOLDOWN_MS) { alertCooldown[key] = Date.now(); return true; }
  return false;
}

async function analyseVehicles(vehicles, company) {
  const alerts = [];
  const now = new Date();
  for (const v of vehicles) {
    const name   = v.Vehicle_Name || v.Vehicle_No || 'Unknown';
    const status = (v.Status || '').toUpperCase();
    const speed  = parseInt(v.Speed) || 0;
    const gps    = v.GPS || '';
    const loc    = v.Location || 'Unknown location';
    const dt     = v.Datetime || '';

    // Overspeed
    if (speed > OVERSPEED_KMH && canAlert(name, 'OVERSPEED')) {
      alerts.push('🚨 <b>OVERSPEED ALERT</b>\n🚛 ' + name + ' (' + company + ')\n⚡ Speed: <b>' + speed + ' km/h</b> (limit: ' + OVERSPEED_KMH + ')\n📍 ' + loc + '\n🕐 ' + dt);
    }

    // GPS Off
    if (gps !== 'ON' && canAlert(name, 'GPS_OFF')) {
      alerts.push('📡 <b>GPS DISCONNECTED</b>\n🚛 ' + name + ' (' + company + ')\n❌ GPS: ' + (gps || 'OFF') + '\n🕐 ' + dt);
    }

    // Stopped too long
    if (status === 'STOP' && dt) {
      try {
        const parts = dt.split(' ');
        const dp = parts[0].split('-').map(Number);
        const tp = parts[1].split(':').map(Number);
        const lastSeen = new Date(dp[2], dp[1]-1, dp[0], tp[0], tp[1], tp[2]);
        const diffHours = (now - lastSeen) / 3600000;
        if (diffHours >= STOPPED_HOURS && canAlert(name, 'STOPPED')) {
          alerts.push('🛑 <b>VEHICLE STOPPED</b>\n🚛 ' + name + ' (' + company + ')\n⏱ Stopped for <b>' + diffHours.toFixed(1) + ' hours</b>\n📍 ' + loc + '\n🕐 ' + dt);
        }
      } catch(e) {}
    }

    // Inactive
    if (status === 'INACTIVE' && dt) {
      try {
        const parts = dt.split(' ');
        const dp = parts[0].split('-').map(Number);
        const tp = parts[1].split(':').map(Number);
        const lastSeen = new Date(dp[2], dp[1]-1, dp[0], tp[0], tp[1], tp[2]);
        const diffDays = (now - lastSeen) / 86400000;
        if (diffDays >= INACTIVE_DAYS && canAlert(name, 'INACTIVE')) {
          alerts.push('⚠️ <b>VEHICLE INACTIVE</b>\n🚛 ' + name + ' (' + company + ')\n😴 Inactive for <b>' + diffDays.toFixed(1) + ' days</b>\n📍 ' + loc + '\n🕐 ' + dt);
        }
      } catch(e) {}
    }
  }
  return alerts;
}

async function sendDailySummary(allVehicles) {
  const total    = allVehicles.length;
  const running  = allVehicles.filter(v => v.Status === 'RUNNING').length;
  const stopped  = allVehicles.filter(v => v.Status === 'STOP').length;
  const inactive = allVehicles.filter(v => v.Status === 'INACTIVE').length;
  const gpsOn    = allVehicles.filter(v => v.GPS === 'ON').length;
  const msg = '📊 <b>FLEETPULSE DAILY SUMMARY</b>\n🕗 ' + new Date().toLocaleString('en-IN') + '\n\n🚛 Total: <b>' + total + '</b>\n🟢 Running: <b>' + running + '</b>\n🔴 Stopped: <b>' + stopped + '</b>\n😴 Inactive: <b>' + inactive + '</b>\n📡 GPS ON: <b>' + gpsOn + '</b>\n\n' + COMPANIES.join(', ');
  await sendTelegram(msg);
}

let lastSummaryDate = null;

async function runMonitor() {
  console.log('Running fleet check at ' + new Date().toLocaleString());
  try {
    const allVehicles = [];
    for (const company of COMPANIES) {
      try {
        console.log('Checking ' + company + '...');
        const vehicles = await fetchCompany(company);
        console.log(vehicles.length + ' vehicles');
        allVehicles.push(...vehicles);
        const alerts = await analyseVehicles(vehicles, company);
        for (const alert of alerts) {
          await sendTelegram(alert);
          await new Promise(r => setTimeout(r, 500));
        }
      } catch(e) {
        console.error('Error for ' + company + ':', e.message);
        if (e.message.includes('Token') || e.message.includes('auth')) authToken = null;
      }
      await new Promise(r => setTimeout(r, 62000)); // 62 sec between companies (API rate limit = 1/min)
    }

    // Daily summary at 8 AM
    const today = new Date().toDateString();
    if (new Date().getHours() === 8 && lastSummaryDate !== today) {
      lastSummaryDate = today;
      await sendDailySummary(allVehicles);
    }
    console.log('Check complete. ' + allVehicles.length + ' vehicles monitored.');
  } catch(e) {
    console.error('Monitor error:', e.message);
  }
}

function startMonitoring() {
  sendTelegram('🚀 <b>FleetPulse Alert System Started!</b>\n\n✅ Monitoring ' + COMPANIES.length + ' companies\n⏱ Checking every 5 minutes\n\nAlerts enabled:\n🚨 Overspeed (&gt;' + OVERSPEED_KMH + ' km/h)\n🛑 Stopped (&gt;' + STOPPED_HOURS + ' hrs)\n📡 GPS Disconnected\n😴 Inactive (&gt;' + INACTIVE_DAYS + ' day)\n📊 Daily Summary at 8 AM');
  setTimeout(runMonitor, 5000);
  setInterval(runMonitor, CHECK_INTERVAL);
}

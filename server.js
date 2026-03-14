const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
 
// ── CONFIG ────────────────────────────────────────────────
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
 
// ── IMEI MASTER LOOKUP TABLE ──────────────────────────────
// Format: IMEI => { company, branch, vehicleName, plateNo }
const IMEI_MAP = {
  // UIPL - BANDOL
  '868373076362351': { company:'UIPL', branch:'BANDOL',      vehicleName:'KOBELCO',          plateNo:'E-KB-1219-10' },
  '868373076365123': { company:'UIPL', branch:'BANDOL',      vehicleName:'GENERATOR',         plateNo:'DG-AL-0039-14' },
  '868373076365347': { company:'UIPL', branch:'BANDOL',      vehicleName:'HYVA',              plateNo:'MP17ZL2196' },
  '868373076494709': { company:'UIPL', branch:'BANDOL',      vehicleName:'WHEEL LOADER',      plateNo:'WL-XM-0845-3' },
  '863738076555268': { company:'UIPL', branch:'BANDOL',      vehicleName:'ROLLER',            plateNo:'SC-DP-1017-6' },
  '868373076362393': { company:'UIPL', branch:'BANDOL',      vehicleName:'WHEEL LOADER',      plateNo:'WL-XM-7301-7' },
  '863738076547018': { company:'UIPL', branch:'BANDOL',      vehicleName:'HYVA',              plateNo:'MP17HH4674' },
  '868373076362104': { company:'UIPL', branch:'BANDOL',      vehicleName:'DRILL COMPRESSOR',  plateNo:'ATLAS COPCO' },
  '863738071849591': { company:'UIPL', branch:'BANDOL',      vehicleName:'KOBELCO',           plateNo:'E-KB-6451-26' },
  // UIPL - HARRAI NEW
  '868373076362054': { company:'UIPL', branch:'HARRAI NEW',  vehicleName:'HYVA',              plateNo:'MP17ZC9547' },
  '868373076365370': { company:'UIPL', branch:'HARRAI NEW',  vehicleName:'HYVA',              plateNo:'MP17ZG2877' },
  '868373076364993': { company:'UIPL', branch:'HARRAI NEW',  vehicleName:'HAYVA',             plateNo:'MP17ZG2819' },
  '868373076365099': { company:'UIPL', branch:'HARRAI NEW',  vehicleName:'HYVA',              plateNo:'MP17ZC9514' },
  '868373076365081': { company:'UIPL', branch:'HARRAI NEW',  vehicleName:'HYVA',              plateNo:'MP17ZG2696' },
  '863738076555060': { company:'UIPL', branch:'HARRAI NEW',  vehicleName:'HYVA',              plateNo:'MP17ZC9507' },
  // UIPL - SHAHPURA
  '868373075844185': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'GRADER',            plateNo:'MG-SL-0079-14' },
  '867747076927936': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'EXR',               plateNo:'E-KB-6450-27' },
  '868373075704819': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'HYVA',              plateNo:'MP17ZL0943' },
  '868373075822629': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'GRADER',            plateNo:'WL-XM-3141-4' },
  '868373075793028': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'MP17ZL0987' },
  '868373075793036': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'MP17ZK2568' },
  '868373075844391': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'MP17HH3776' },
  '868373075794646': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'MP17ZL2109' },
  '861076084222759': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'MP17ZK2511' },
  '868373076365222': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'MP17HH4672' },
  '868373075822686': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'MP17HH4781' },
  '861076084222916': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'HYVA',              plateNo:'MP17ZL1066' },
  '867747077156667': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'MP17HH4299' },
  '868373075704637': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'DG-AL-315-20' },
  '868373075843971': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'DG-SF-0226-23' },
  '868373075740136': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'TIPPER',            plateNo:'WL-XM-7943' },
  '868373075844169': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'EXR',               plateNo:'E-TH-2710-19' },
  '868373075844086': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'DIESEL TANKER',     plateNo:'MP17G2523' },
  '868373075844011': { company:'UIPL', branch:'SHAHPURA',    vehicleName:'EXR',               plateNo:'E-KM-0437-29' },
  // NAGESHWAR - PARAS POWER
  '869925072005588': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04PC2169' },
  '869925072005919': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04PC2168' },
  '869925072013731': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04NS9713' },
  '869925072108150': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04NS9711' },
  '869925072118639': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04NS9716' },
  '869925072005752': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04NS9714' },
  '869925072021825': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04NS9715' },
  '869925072101379': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04NS9712' },
  '869925072131533': { company:'NAGESHWAR', branch:'PARAS POWER', vehicleName:'TIPPER', plateNo:'CG04PB8675' },
  // PPBCL
  '353691847956918': { company:'PPBCL', branch:'PPBCL', vehicleName:'CAMPER', plateNo:'CG10BS7256' },
  // Shitla Enterprises
  '353691848840350': { company:'Shitla Enterprises', branch:'SE', vehicleName:'LOADER', plateNo:'401200' },
};
 
// ── RESOLVE VEHICLE INFO FROM API FIELDS ──────────────────
function resolveVehicle(v) {
  const imei = String(v.Imeino || v.IMEI || '').trim();
  const mapped = IMEI_MAP[imei];
  let vehicleName, plateNo, branch;
 
  if (mapped) {
    vehicleName = mapped.vehicleName;
    plateNo     = mapped.plateNo;
    branch      = mapped.branch;
  } else {
    // Fallback to API fields
    vehicleName = v.Vehicle_Name || '';
    plateNo     = v.Vehicle_No   || '';
    branch      = v.Branch_Name  || v.Group_Name || v.Branch || 'UNKNOWN';
    // If vehicleName looks like IMEI (all digits, 15 chars), use plateNo as name
    if (/^\d{15}$/.test(vehicleName)) vehicleName = plateNo || imei;
  }
 
  const displayId = plateNo && vehicleName
    ? `${plateNo} - ${vehicleName}`
    : (plateNo || vehicleName || imei || 'UNKNOWN');
 
  // Determine status with IDLE logic
  const rawStatus = (v.Status || 'UNKNOWN').toUpperCase();
  const speed = parseInt(v.Speed) || 0;
  let status;
  if (rawStatus === 'RUNNING' && speed === 0) status = 'IDLE';
  else if (rawStatus === 'RUNNING') status = 'RUNNING';
  else if (rawStatus === 'STOP') status = 'STOP';
  else status = 'INACTIVE';
 
  return { imei, displayId, vehicleName, plateNo, branch, status, speed,
           gps: v.GPS || 'OFF', loc: v.Location || '—', dt: v.Datetime || '',
           fuel: (v.Fuel && v.Fuel.length > 0) ? v.Fuel[0].value : null };
}
 
// ── STATE ─────────────────────────────────────────────────
let authToken     = null;
let tokenExpiry   = null;
let alertCooldown = {};
let snapshots     = {};
let reportsHistory = [];
let latestReport   = null;
let snapshotCount  = 0;
let reportLogs     = []; // timestamped event log for /logs endpoint
 
function addLog(type, status, detail = '') {
  const entry = { time: new Date().toISOString(), type, status, detail };
  reportLogs.push(entry);
  if (reportLogs.length > 200) reportLogs = reportLogs.slice(-200);
  console.log(`[LOG] ${entry.time} | ${type} | ${status} | ${detail}`);
}
 
// ── HTTP SERVER ───────────────────────────────────────────
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
  if (req.method === 'GET' && pu.pathname === '/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: reportLogs.slice().reverse(), serverStart: serverStartTime, totalReports: reportLogs.filter(l => l.type === 'REPORT_GENERATED').length }));
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
const serverStartTime = new Date().toISOString();
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
 
// ── STATUS COLOR (RGB) ────────────────────────────────────
function statusColor(status) {
  if (status === 'RUNNING') return '#c6efce'; // light green
  if (status === 'IDLE')    return '#ffeb9c'; // light yellow
  if (status === 'STOP')    return '#ffc7ce'; // light red/pink
  return '#bdd7ee';                           // light blue (inactive)
}
function statusTextColor(status) {
  if (status === 'RUNNING') return '#1a5c2a';
  if (status === 'IDLE')    return '#7a5000';
  if (status === 'STOP')    return '#8b0000';
  return '#1a3a5c';
}
function statusEmoji(status) {
  if (status === 'RUNNING') return '🟢';
  if (status === 'IDLE')    return '🟡';
  if (status === 'STOP')    return '🔴';
  return '🔵';
}
 
// ── GENERATE PDF ──────────────────────────────────────────
function generatePDF(report) {
  const now = new Date(report.time);
  const timeStr = now.toLocaleString('en-IN');
  try {
    const PDFDocument = require('pdfkit');
    const filePath = '/tmp/fleet_' + Date.now() + '.pdf';
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
 
    // ── PAGE HEADER ──
    doc.rect(0, 0, doc.page.width, 50).fill('#1a1a2e');
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#ffd60a')
       .text('FleetPulse — UIPL Fleet Report', 36, 14, { align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor('#ffffff')
       .text('Generated: ' + timeStr, 0, 18, { align: 'right', width: doc.page.width - 36 });
    doc.moveDown(2.5);
 
    // ── GRAND SUMMARY BAR ──
    const gs = report.grandSummary;
    const barY = doc.y;
    const bw = (doc.page.width - 72) / 4;
    const summaryItems = [
      { label: 'RUNNING', val: gs.running,  color: '#c6efce', text: '#276221' },
      { label: 'IDLE',    val: gs.idle,     color: '#ffeb9c', text: '#9c6500' },
      { label: 'STOPPED', val: gs.stopped,  color: '#ffc7ce', text: '#9c0006' },
      { label: 'INACTIVE',val: gs.inactive, color: '#bdd7ee', text: '#1f4e79' },
    ];
    summaryItems.forEach((item, i) => {
      const bx = 36 + i * bw;
      doc.rect(bx, barY, bw - 6, 40).fill(item.color);
      doc.fontSize(20).font('Helvetica-Bold').fillColor(item.text)
         .text(String(item.val), bx, barY + 4, { width: bw - 6, align: 'center' });
      doc.fontSize(7).font('Helvetica').fillColor('#555')
         .text(item.label, bx, barY + 26, { width: bw - 6, align: 'center' });
    });
    doc.moveDown(3.5);
 
    // ── LEGEND ──
    const lx = 36; const ly = doc.y;
    [['🟢 RUNNING', '#c6efce'], ['🟡 IDLE', '#ffeb9c'], ['🔴 STOPPED', '#ffc7ce'], ['🔵 INACTIVE', '#bdd7ee']].forEach((l, i) => {
      doc.rect(lx + i * 140, ly, 12, 12).fill(l[1]);
      doc.fontSize(8).font('Helvetica').fillColor('#333').text(l[0], lx + i * 140 + 16, ly + 1);
    });
    doc.moveDown(1.8);
 
    // ── TABLE COLUMNS ──
    const cols  = [160, 75, 55, 55, 60, 70, 55, 75, 70];
    const heads = ['Vehicle ID', 'Branch', 'Status', 'Speed', 'Max Spd', 'Work Time', 'GPS', 'Fuel Drop', 'Location'];
    const tableW = cols.reduce((a, b) => a + b, 0);
 
    // ── PER BRANCH SECTIONS ──
    const branches = report.branches || [];
    for (const branch of branches) {
      // Branch header
      if (doc.y > doc.page.height - 120) doc.addPage();
      const bhY = doc.y;
      doc.rect(36, bhY, tableW, 22).fill('#1a1a2e');
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffd60a')
         .text('📍 ' + branch.name, 42, bhY + 5);
 
      // Branch summary inline
      const bsum = branch.summary;
      const sumStr = `Active: ${bsum.active}  (🟢 ${bsum.running}  🟡 ${bsum.idle}  🔴 ${bsum.stopped})   🔵 Inactive: ${bsum.inactive}   Total: ${bsum.total}`;
      doc.fontSize(8).font('Helvetica').fillColor('#aaa')
         .text(sumStr, 300, bhY + 7);
      doc.moveDown(1.8);
 
      // Table header row
      let hx = 36; const hy = doc.y;
      doc.rect(36, hy, tableW, 16).fill('#2d2d44');
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffd60a');
      heads.forEach((h, i) => {
        doc.text(h, hx + 2, hy + 4, { width: cols[i] - 4, align: i === 0 ? 'left' : 'center' });
        hx += cols[i];
      });
      doc.moveDown(1.5);
 
      // Vehicle rows
      for (const v of branch.vehicles) {
        if (doc.y > doc.page.height - 50) {
          doc.addPage();
          // Repeat header on new page
          let hx2 = 36; const hy2 = doc.y;
          doc.rect(36, hy2, tableW, 16).fill('#2d2d44');
          doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#ffd60a');
          heads.forEach((h, i) => {
            doc.text(h, hx2 + 2, hy2 + 4, { width: cols[i] - 4, align: i === 0 ? 'left' : 'center' });
            hx2 += cols[i];
          });
          doc.moveDown(1.5);
        }
 
        const rowY = doc.y;
        const rowH = 16;
        const [r, g, b] = statusColor(v.status);
        doc.rect(36, rowY, tableW, rowH).fill(`rgb(${r},${g},${b})`);
 
        const wm = parseInt(v.workMins) || 0;
        const wh = Math.floor(wm / 60); const wmin = wm % 60;
        const ws = wm > 0 ? (wh > 0 ? wh + 'h ' + wmin + 'm' : wmin + 'm') : '—';
        const row = [
          v.displayId,
          branch.name,
          v.status,
          v.speed > 0 ? v.speed + ' km/h' : '0',
          v.maxSpeed > 0 ? v.maxSpeed + ' km/h' : '0',
          ws,
          v.gps,
          (v.loc || '—').substring(0, 22)
        ];
 
        let rx = 36;
        doc.fontSize(7.5).font('Helvetica').fillColor('#000');
        row.forEach((cell, i) => {
          doc.text(String(cell), rx + 2, rowY + 4, { width: cols[i] - 4, align: i === 0 ? 'left' : 'center', lineBreak: false });
          rx += cols[i];
        });
        doc.moveDown(1.4);
      }
      doc.moveDown(0.5);
    }
 
    // ── FOOTER ──
    doc.moveDown(0.5);
    doc.fontSize(7.5).fillColor('#888').font('Helvetica')
       .text('FleetPulse Automated Report — TASR Fleet Management', { align: 'center' });
 
    doc.end();
    return new Promise((resolve, reject) => { stream.on('finish', () => resolve(filePath)); stream.on('error', reject); });
 
  } catch (e) {
    console.log('PDFKit unavailable, text fallback:', e.message);
    const fp = '/tmp/fleet_' + Date.now() + '.txt';
    const lines = ['FLEETPULSE - UIPL FLEET REPORT', 'Generated: ' + timeStr, ''];
    (report.branches || []).forEach(br => {
      lines.push('=== ' + br.name + ' ===');
      lines.push(`Active: ${br.summary.active} | Inactive: ${br.summary.inactive}`);
      br.vehicles.forEach(v => lines.push(`${v.displayId} | ${v.status} | ${v.speed}km/h | GPS:${v.gps}`));
      lines.push('');
    });
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
  const res = await apiPost('?token=getTokenBaseLiveData&ProjectId=' + PROJECT_ID,
    { company_names: COMPANY, format: 'json' }, { 'auth-code': token });
  return (res.root && res.root.VehicleData) ? res.root.VehicleData : [];
}
 
// ── SNAPSHOT ──────────────────────────────────────────────
function takeSnapshot(vehicles) {
  vehicles.forEach(v => {
    const info = resolveVehicle(v);
    if (!snapshots[info.imei]) snapshots[info.imei] = [];
    snapshots[info.imei].push({
      time: Date.now(), status: info.status, speed: info.speed,
      fuel: info.fuel, loc: info.loc, gps: info.gps
    });
    if (snapshots[info.imei].length > 12) snapshots[info.imei] = snapshots[info.imei].slice(-12);
  });
}
 
// ── ALERTS ────────────────────────────────────────────────
function canAlert(id, type) {
  const key = id + '_' + type;
  if (!alertCooldown[key] || Date.now() - alertCooldown[key] > ALERT_COOLDOWN) {
    alertCooldown[key] = Date.now(); return true;
  }
  return false;
}
 
async function checkAlerts(vehicles) {
  for (const v of vehicles) {
    const info = resolveVehicle(v);
    const { displayId, status, speed, gps, loc, dt } = info;
    if (speed > OVERSPEED_KMH && canAlert(info.imei, 'OVER'))
      await sendTelegram(`🚨 <b>OVERSPEED</b>\n🚛 ${displayId}\n⚡ <b>${speed} km/h</b>\n📍 ${loc}\n🕐 ${dt}`);
    if (gps !== 'ON' && canAlert(info.imei, 'GPS'))
      await sendTelegram(`📡 <b>GPS DISCONNECTED</b>\n🚛 ${displayId}\n🕐 ${dt}`);
    if (status === 'STOP' && dt) {
      try {
        const parts = dt.split(' ');
        const dp = parts[0].split('-').map(Number);
        const tp = parts[1].split(':').map(Number);
        const last = new Date(dp[2], dp[1] - 1, dp[0], tp[0], tp[1], tp[2]);
        const hrs = (Date.now() - last) / 3600000;
        if (hrs >= STOPPED_HOURS && canAlert(info.imei, 'STOP'))
          await sendTelegram(`🛑 <b>STOPPED ${hrs.toFixed(1)} HRS</b>\n🚛 ${displayId}\n📍 ${loc}\n🕐 ${dt}`);
      } catch (e) {}
    }
  }
}
 
// ── 15-MIN REPORT ─────────────────────────────────────────
async function generate15MinReport(vehicles) {
  const now = new Date();
  const reportId = 'RPT-' + now.getTime();
 
  addLog('REPORT_GENERATED', 'STARTED', `${vehicles.length} vehicles`);
 
  // Resolve all vehicles and group by branch
  const branchMap = {};
  let grandRunning = 0, grandIdle = 0, grandStopped = 0, grandInactive = 0;
 
  for (const v of vehicles) {
    const info = resolveVehicle(v);
    const snaps = (snapshots[info.imei] || []).slice(-3);
    const maxSpeed = snaps.length > 0 ? Math.max(...snaps.map(s => s.speed), info.speed) : info.speed;
    const workMins = snaps.filter(s => ['RUNNING','IDLE','STOP'].includes(s.status)).length * 5;
 
    // ── FUEL CONSUMPTION CALC ──
    // fuelStart = oldest snapshot, fuelEnd = newest snapshot
    // fuelDrop = start - end (positive = consumed, negative = filled)
    let fuelStart = null, fuelEnd = null, fuelDrop = null, fuelDisplay = '—';
    const fsnaps = snaps.filter(s => s.fuel !== null && s.fuel !== undefined);
    if (fsnaps.length >= 2) {
      fuelStart = parseFloat(fsnaps[0].fuel);
      fuelEnd   = parseFloat(fsnaps[fsnaps.length - 1].fuel);
      fuelDrop  = parseFloat((fuelStart - fuelEnd).toFixed(1));
      if (fuelDrop > 0)       fuelDisplay = `-${fuelDrop}L`;
      else if (fuelDrop < 0)  fuelDisplay = `+${Math.abs(fuelDrop)}L ↑FILL`;
      else                    fuelDisplay = 'No change';
    } else if (info.fuel !== null && info.fuel !== undefined) {
      fuelDisplay = `${parseFloat(info.fuel)}L (cur)`;
    }
 
    const row = { ...info, maxSpeed, workMins, fuelDrop, fuelStart, fuelEnd, fuelDisplay };
 
    if (!branchMap[info.branch]) branchMap[info.branch] = [];
    branchMap[info.branch].push(row);
 
    if (info.status === 'RUNNING')      grandRunning++;
    else if (info.status === 'IDLE')    grandIdle++;
    else if (info.status === 'STOP')    grandStopped++;
    else                                grandInactive++;
  }
 
  // Build branch summaries
  const branches = Object.keys(branchMap).sort().map(bname => {
    const bv = branchMap[bname];
    const running  = bv.filter(v => v.status === 'RUNNING').length;
    const idle     = bv.filter(v => v.status === 'IDLE').length;
    const stopped  = bv.filter(v => v.status === 'STOP').length;
    const inactive = bv.filter(v => v.status === 'INACTIVE').length;
    const totalFuelDrop = bv.reduce((sum, v) => sum + (v.fuelDrop > 0 ? v.fuelDrop : 0), 0);
    return {
      name: bname, vehicles: bv,
      summary: { total: bv.length, running, idle, stopped, inactive, active: running+idle+stopped, totalFuelDrop: totalFuelDrop.toFixed(1) }
    };
  });
 
  const report = {
    id: reportId,
    time: now.toISOString(),
    grandSummary: { total: vehicles.length, running: grandRunning, idle: grandIdle, stopped: grandStopped, inactive: grandInactive },
    branches
  };
  latestReport = report;
  reportsHistory.push(report);
  if (reportsHistory.length > 96) reportsHistory = reportsHistory.slice(-96);
 
  addLog('REPORT_GENERATED', 'OK', `🟢${grandRunning} 🟡${grandIdle} 🔴${grandStopped} 🔵${grandInactive}`);
 
  // ── TELEGRAM TEXT (monospace aligned) ──
  const timeStr = now.toLocaleTimeString('en-IN', { hour12: false });
  const dateStr = now.toLocaleDateString('en-IN');
 
  let msg = `📋 <b>UIPL FLEET REPORT</b>\n`;
  msg += `🕐 ${timeStr}  |  ${dateStr}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🟢 <b>${grandRunning}</b> Running  🟡 <b>${grandIdle}</b> Idle  🔴 <b>${grandStopped}</b> Stopped  🔵 <b>${grandInactive}</b> Inactive\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
 
  for (const br of branches) {
    const bs = br.summary;
    msg += `📍 <b>${br.name}</b>\n`;
    msg += `Active: <b>${bs.active}</b> (🟢${bs.running} 🟡${bs.idle} 🔴${bs.stopped})  🔵Inactive: <b>${bs.inactive}</b>  ⛽ Total Drop: <b>${bs.totalFuelDrop}L</b>\n`;
    msg += `<code>`;
    msg += `${'Vehicle'.padEnd(22)} St  Spd  Fuel\n`;
    msg += `${'─'.repeat(42)}\n`;
    for (const v of br.vehicles) {
      const name  = v.displayId.substring(0, 21).padEnd(22);
      const st    = v.status === 'RUNNING' ? '🟢' : v.status === 'IDLE' ? '🟡' : v.status === 'STOP' ? '🔴' : '🔵';
      const spd   = String(v.speed > 0 ? v.speed+'k' : '0').padStart(4);
      const fuel  = v.fuelDisplay.padStart(10);
      msg += `${name}${st}${spd}${fuel}\n`;
    }
    msg += `</code>\n`;
  }
 
  let tgTextOk = false;
  try {
    const tgRes = msg.length <= 4096
      ? await sendTelegram(msg)
      : await sendTelegram(`📋 <b>UIPL REPORT</b> ${timeStr}\n🟢${grandRunning} 🟡${grandIdle} 🔴${grandStopped} 🔵${grandInactive}\n(See PDF for details)`);
    const parsed = JSON.parse(tgRes || '{}');
    tgTextOk = parsed.ok === true;
    addLog('TELEGRAM_TEXT', tgTextOk ? 'OK' : 'FAIL', tgTextOk ? 'Message sent' : (parsed.description || 'Unknown error'));
  } catch (e) {
    addLog('TELEGRAM_TEXT', 'FAIL', e.message);
  }
 
  // ── SEND PDF ──
  let pdfOk = false;
  try {
    addLog('PDF_GENERATE', 'STARTED', `${vehicles.length} vehicles`);
    const pdfPath = await generatePDF(report);
    addLog('PDF_GENERATE', 'OK', pdfPath);
    const pdfRes = await sendTelegramDocument(pdfPath, `📋 UIPL Fleet Report — ${now.toLocaleString('en-IN')}`);
    const pdfParsed = JSON.parse(pdfRes || '{}');
    pdfOk = pdfParsed.ok === true;
    addLog('TELEGRAM_PDF', pdfOk ? 'OK' : 'FAIL', pdfOk ? 'PDF delivered' : (pdfParsed.description || 'Unknown'));
    try { fs.unlinkSync(pdfPath); } catch (e) {}
  } catch (e) {
    addLog('PDF_GENERATE', 'FAIL', e.message);
  }
 
  console.log(`15-min report done: ${vehicles.length} vehicles, ${branches.length} branches | TG:${tgTextOk} PDF:${pdfOk}`);
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
  addLog('SERVER_START', 'OK', 'FleetPulse v3 started — UIPL 3 branches');
  sendTelegram('🚀 <b>FleetPulse v3 Started!</b>\n\n🏭 UIPL — 3 Branches\n📸 Snapshot: 5 mins\n📋 Report + PDF: 15 mins\n\n🟢 Running 🟡 Idle 🔴 Stopped 🔵 Inactive\n🚨 Overspeed | 🛑 Stopped | 📡 GPS alerts active');
  setTimeout(runCycle, 10000);
  setInterval(runCycle, SNAPSHOT_EVERY);
}

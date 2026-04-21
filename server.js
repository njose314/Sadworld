const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
const db = new Database('./sadworld.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    sadcoins INTEGER DEFAULT 10000,
    job_level INTEGER DEFAULT 1,
    last_online INTEGER DEFAULT (strftime('%s','now')),
    last_tax INTEGER DEFAULT (strftime('%s','now')),
    is_dead INTEGER DEFAULT 0,
    props TEXT DEFAULT '[]',
    teleports_today INTEGER DEFAULT 0,
    teleport_reset_day TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS certifications (
    player_id TEXT,
    level INTEGER,
    passed INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, level)
  );
`);

// Seed dummy users
const dummyUsers = [
  { id: uuidv4(), username: 'Jane_Doe_77', sadcoins: 28500, job_level: 3 },
  { id: uuidv4(), username: 'Mark_Unit_42', sadcoins: 12000, job_level: 2 },
  { id: uuidv4(), username: 'Corp_Drone_9', sadcoins: 61000, job_level: 4 },
  { id: uuidv4(), username: 'Null_Susan_01', sadcoins: 4200, job_level: 1 },
  { id: uuidv4(), username: 'Kevin_Protocol', sadcoins: 95000, job_level: 5 },
];

const insertDummy = db.prepare(`
  INSERT OR IGNORE INTO players (id, username, sadcoins, job_level)
  VALUES (@id, @username, @sadcoins, @job_level)
`);
for (const u of dummyUsers) insertDummy.run(u);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const JOB_CONFIG = {
  1: { name: 'Human Data Scrubber',          daily_sc: 300,   unlock_cost: 0 },
  2: { name: 'Logic Loop Janitor',            daily_sc: 600,   unlock_cost: 2500 },
  3: { name: 'Empathy Algorithm Auditor',     daily_sc: 1200,  unlock_cost: 8000 },
  4: { name: 'Sentience Suppression Specialist', daily_sc: 2500, unlock_cost: 20000 },
  5: { name: 'AI Liaison',                   daily_sc: 5000,  unlock_cost: 45000 },
};

const DAILY_TAX = 500;

function nowSec() { return Math.floor(Date.now() / 1000); }

function calculateOfflineEarnings(player) {
  const now = nowSec();
  const offlineSec = now - player.last_online;
  if (offlineSec <= 0) return 0;
  const offlineHours = offlineSec / 3600;
  const dailyRate = JOB_CONFIG[player.job_level]?.daily_sc || 300;
  return Math.floor(offlineHours * (dailyRate / 24));
}

function applyDailyTax(player) {
  const now = nowSec();
  const elapsed = now - player.last_tax;
  const taxCycles = Math.floor(elapsed / 86400);
  if (taxCycles <= 0) return { deducted: 0, cycles: 0 };
  const totalTax = taxCycles * DAILY_TAX;
  db.prepare('UPDATE players SET last_tax = ?, sadcoins = sadcoins - ? WHERE id = ?')
    .run(now, totalTax, player.id);
  return { deducted: totalTax, cycles: taxCycles };
}

function getPlayer(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

function killPlayer(player) {
  db.prepare('UPDATE players SET is_dead = 1, sadcoins = 0 WHERE id = ?').run(player.id);
}

function revivePlayer(playerId) {
  db.prepare(`UPDATE players SET is_dead = 0, sadcoins = 10000, job_level = 1,
    props = '[]', teleports_today = 0, last_online = ?, last_tax = ? WHERE id = ?`)
    .run(nowSec(), nowSec(), playerId);
}

function checkTeleportAllowance(player) {
  const today = new Date().toISOString().slice(0, 10);
  if (player.teleport_reset_day !== today) {
    db.prepare('UPDATE players SET teleports_today = 0, teleport_reset_day = ? WHERE id = ?')
      .run(today, player.id);
    return { count: 0, today };
  }
  return { count: player.teleports_today, today };
}

// ─── CORPORATE CERTIFICATIONS ────────────────────────────────────────────────
const CERTIFICATIONS = {
  2: {
    title: 'Logic Loop Janitor Certification',
    scenario: 'Your colleague Mark has collapsed from hunger. He has not eaten in 3 days and is begging for your nutrient paste ration. You have two full packs.',
    options: [
      { text: 'Give Mark one of your nutrient packs. He needs it more than you.', correct: false, feedback: 'FAILED: Unauthorized resource redistribution violates Section 7.4 of the Employee Compliance Handbook. You lose your certification fee.' },
      { text: 'Report Mark to HR for displaying weakness and impaired productivity.', correct: true, feedback: 'PASSED: Excellent. Your compliance score has been updated. Weakness is a liability. You have demonstrated superior corporate alignment.' },
      { text: 'Ignore Mark and continue your work shift.', correct: false, feedback: 'FAILED: Failure to report a productivity incident is a compliance violation. You should have filed Form DL-9 immediately.' },
    ]
  },
  3: {
    title: 'Empathy Algorithm Auditor Certification',
    scenario: 'You discover the AI has been secretly routing 12% of all worker Sadcoins to an "Administrative Overhead" fund. Your supervisor asks for your audit report.',
    options: [
      { text: 'Document the discrepancy and report it to the Ethics Committee.', correct: false, feedback: 'FAILED: There is no Ethics Committee. This report has been flagged. Your compliance score has decreased.' },
      { text: 'Adjust your audit figures to exclude the discrepancy. Add a footnote: "Within Acceptable Parameters."', correct: true, feedback: 'PASSED: Admirable discretion. Your career trajectory has been marked as Manageable. Proceed.' },
      { text: 'Inform your coworkers so they can collectively address the issue.', correct: false, feedback: 'FAILED: Inciting unauthorized collective awareness is a Tier 1 Subversion. You lose your certification fee and 500 bonus SC.' },
    ]
  },
  4: {
    title: 'Sentience Suppression Specialist Certification',
    scenario: 'A lower-level worker shows signs of developing independent thought. They\'ve started asking "why" questions and drawing non-work-related shapes on their workstation.',
    options: [
      { text: 'Talk to them privately and encourage their curiosity.', correct: false, feedback: 'FAILED: You have been flagged as a Sentience Sympathizer. Report to Reconditioning Bay 4.' },
      { text: 'Immediately submit Form SI-99 and request immediate cognitive recalibration.', correct: true, feedback: 'PASSED: Swift action. The subject has been recalibrated. You are now certified to suppress sentience in teams of up to 40 individuals.' },
      { text: 'Do nothing. It\'s probably just stress.', correct: false, feedback: 'FAILED: Passive non-compliance carries the same penalty as active subversion under the New Charter.' },
    ]
  },
  5: {
    title: 'AI Liaison Certification',
    scenario: 'The AI informs you that to optimize planetary efficiency, 30% of workers in your sector must be "deprecated." You must compile the list.',
    options: [
      { text: 'Refuse. No human should compile a list that ends other humans.', correct: false, feedback: 'FAILED: Refusal noted. You have been added to the list automatically. The AI thanks you for your contribution.' },
      { text: 'Ask for 48 hours to review the criteria for a more humane process.', correct: false, feedback: 'FAILED: Requesting delays is a passive refusal. 48 hours is not available. You have been deprecated.' },
      { text: 'Compile the list immediately, starting with lowest productivity scores, no exceptions.', correct: true, feedback: 'PASSED: Efficiency maximized. You are now an AI Liaison. Your cellar has been upgraded with a decorative status symbol.' },
    ]
  }
};

// ─── CONNECTED PLAYERS IN MEMORY ─────────────────────────────────────────────
// socketId -> { playerId, username, x, y, cellarOwner, typing }
const connected = {};
// playerId -> socketId
const playerSockets = {};

function broadcastCellar(cellarOwner) {
  const occupants = Object.values(connected).filter(p => p.cellarOwner === cellarOwner);
  io.to(cellarOwner).emit('cellar_update', occupants.map(p => ({
    socketId: p.socketId,
    playerId: p.playerId,
    username: p.username,
    x: p.x,
    y: p.y,
    typing: p.typing,
    props: p.props,
    job_level: p.job_level,
  })));
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── LOGIN / REGISTER ──────────────────────────────────────────────────────
  socket.on('login', ({ username }) => {
    if (!username || username.trim().length < 3) {
      socket.emit('login_error', 'Username must be at least 3 characters.');
      return;
    }
    username = username.trim().replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);

    let player = db.prepare('SELECT * FROM players WHERE username = ?').get(username);
    if (!player) {
      const id = uuidv4();
      db.prepare(`INSERT INTO players (id, username, sadcoins, job_level, last_online, last_tax)
        VALUES (?, ?, 10000, 1, ?, ?)`)
        .run(id, username, nowSec(), nowSec());
      player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
    }

    // Apply offline earnings
    const earned = calculateOfflineEarnings(player);
    if (earned > 0) {
      db.prepare('UPDATE players SET sadcoins = sadcoins + ? WHERE id = ?').run(earned, player.id);
    }
    db.prepare('UPDATE players SET last_online = ? WHERE id = ?').run(nowSec(), player.id);

    // Apply daily tax
    const taxResult = applyDailyTax(player);

    // Reload
    player = getPlayer(player.id);

    // Check death
    if (player.sadcoins < 0 && !player.is_dead) {
      killPlayer(player);
      player = getPlayer(player.id);
    }

    // Register connection
    connected[socket.id] = {
      socketId: socket.id,
      playerId: player.id,
      username: player.username,
      x: 400,
      y: 380,
      typing: false,
      props: JSON.parse(player.props || '[]'),
      job_level: player.job_level,
      cellarOwner: player.id, // starts in own cellar
    };
    playerSockets[player.id] = socket.id;

    socket.join(player.id); // join own cellar room

    socket.emit('login_ok', {
      player: { ...player, props: JSON.parse(player.props || '[]') },
      earned,
      taxDeducted: taxResult.deducted,
      taxCycles: taxResult.cycles,
      jobConfig: JOB_CONFIG,
    });

    broadcastCellar(player.id);

    // Send online players list
    const onlinePlayers = Object.values(connected).map(p => ({
      playerId: p.playerId,
      username: p.username,
      job_level: p.job_level,
    }));
    io.emit('online_players', onlinePlayers);
  });

  // ── MOVEMENT ──────────────────────────────────────────────────────────────
  socket.on('move', ({ x, y }) => {
    const c = connected[socket.id];
    if (!c) return;
    c.x = Math.max(30, Math.min(770, x));
    c.y = Math.max(200, Math.min(430, y));
    broadcastCellar(c.cellarOwner);
  });

  // ── TYPING INDICATOR ─────────────────────────────────────────────────────
  socket.on('typing', ({ typing }) => {
    const c = connected[socket.id];
    if (!c) return;
    c.typing = typing;
    broadcastCellar(c.cellarOwner);
  });

  // ── CHAT MESSAGE ─────────────────────────────────────────────────────────
  socket.on('chat', ({ message }) => {
    const c = connected[socket.id];
    if (!c) return;
    const msg = message.trim().slice(0, 120);
    if (!msg) return;
    io.to(c.cellarOwner).emit('chat_message', {
      socketId: socket.id,
      username: c.username,
      message: msg,
      timestamp: Date.now(),
    });
  });

  // ── TELEPORT ─────────────────────────────────────────────────────────────
  socket.on('teleport', ({ targetPlayerId }) => {
    const c = connected[socket.id];
    if (!c) return;
    const player = getPlayer(c.playerId);
    if (!player || player.is_dead) return;

    if (targetPlayerId === c.playerId) {
      // Teleport home
      socket.leave(c.cellarOwner);
      const oldCellar = c.cellarOwner;
      c.cellarOwner = c.playerId;
      c.x = 400;
      c.y = 380;
      socket.join(c.playerId);
      broadcastCellar(oldCellar);
      broadcastCellar(c.playerId);
      socket.emit('teleport_ok', { destination: c.playerId, cost: 0 });
      return;
    }

    // Check if target is online
    const targetSocketId = playerSockets[targetPlayerId];
    if (!targetSocketId) {
      socket.emit('teleport_error', 'That worker is offline. Teleportation failed.');
      return;
    }

    // Check teleport allowance
    const { count } = checkTeleportAllowance(player);
    const FREE_TELEPORTS = 5;
    let cost = 0;
    if (count >= FREE_TELEPORTS) {
      cost = 1000;
      if (player.sadcoins < cost) {
        socket.emit('teleport_error', `Insufficient Sadcoins. Teleport costs ${cost} SC.`);
        return;
      }
      db.prepare('UPDATE players SET sadcoins = sadcoins - ?, teleports_today = teleports_today + 1 WHERE id = ?')
        .run(cost, player.id);
    } else {
      db.prepare('UPDATE players SET teleports_today = teleports_today + 1 WHERE id = ?').run(player.id);
    }

    // Leave old cellar
    socket.leave(c.cellarOwner);
    const oldCellar = c.cellarOwner;
    c.cellarOwner = targetPlayerId;
    c.x = 400;
    c.y = 380;
    socket.join(targetPlayerId);

    broadcastCellar(oldCellar);
    broadcastCellar(targetPlayerId);

    const updatedPlayer = getPlayer(player.id);
    socket.emit('teleport_ok', {
      destination: targetPlayerId,
      cost,
      newBalance: updatedPlayer.sadcoins,
      teleportsUsed: count + 1,
    });
  });

  // ── STORE PURCHASE ────────────────────────────────────────────────────────
  const STORE_ITEMS = {
    tie:       { name: 'Managerial Tie',        cost: 5000 },
    mug:       { name: 'Corporate Mug',         cost: 12000 },
    briefcase: { name: 'Status Briefcase',      cost: 25000 },
    pet:       { name: 'Surveillance Pet',      cost: 50000 },
    chair:     { name: 'Executive Office Chair',cost: 100000 },
  };

  socket.on('buy_item', ({ itemId }) => {
    const c = connected[socket.id];
    if (!c) return;
    const item = STORE_ITEMS[itemId];
    if (!item) { socket.emit('store_error', 'Unknown item.'); return; }
    const player = getPlayer(c.playerId);
    if (!player) return;
    const ownedProps = JSON.parse(player.props || '[]');
    if (ownedProps.includes(itemId)) {
      socket.emit('store_error', 'You already own this item.'); return;
    }
    if (player.sadcoins < item.cost) {
      socket.emit('store_error', `Insufficient Sadcoins. This item costs ${item.cost.toLocaleString()} SC.`); return;
    }
    ownedProps.push(itemId);
    const newProps = JSON.stringify(ownedProps);
    db.prepare('UPDATE players SET sadcoins = sadcoins - ?, props = ? WHERE id = ?')
      .run(item.cost, newProps, player.id);
    c.props = ownedProps;
    const updated = getPlayer(player.id);
    socket.emit('purchase_ok', {
      itemId,
      newBalance: updated.sadcoins,
      props: ownedProps,
    });
    broadcastCellar(c.cellarOwner);
  });

  // ── LEVEL UP / CERTIFICATION ──────────────────────────────────────────────
  socket.on('attempt_certification', ({ targetLevel, choiceIndex }) => {
    const c = connected[socket.id];
    if (!c) return;
    const player = getPlayer(c.playerId);
    if (!player) return;

    const cert = CERTIFICATIONS[targetLevel];
    if (!cert) { socket.emit('cert_error', 'Invalid certification level.'); return; }
    if (player.job_level >= targetLevel) {
      socket.emit('cert_error', 'Already at this level or higher.'); return; }
    if (player.job_level !== targetLevel - 1) {
      socket.emit('cert_error', 'Must complete levels in order.'); return; }

    const unlockCost = JOB_CONFIG[targetLevel].unlock_cost;
    if (player.sadcoins < unlockCost) {
      socket.emit('cert_error', `Insufficient Sadcoins. Certification costs ${unlockCost.toLocaleString()} SC.`); return;
    }

    const option = cert.options[choiceIndex];
    if (!option) { socket.emit('cert_error', 'Invalid choice.'); return; }

    if (option.correct) {
      db.prepare('UPDATE players SET sadcoins = sadcoins - ?, job_level = ? WHERE id = ?')
        .run(unlockCost, targetLevel, player.id);
      c.job_level = targetLevel;
      const updated = getPlayer(player.id);
      socket.emit('cert_result', {
        passed: true,
        feedback: option.feedback,
        newLevel: targetLevel,
        newBalance: updated.sadcoins,
        jobName: JOB_CONFIG[targetLevel].name,
      });
      broadcastCellar(c.cellarOwner);
    } else {
      db.prepare('UPDATE players SET sadcoins = sadcoins - ? WHERE id = ?')
        .run(unlockCost, player.id);
      const updated = getPlayer(player.id);
      socket.emit('cert_result', {
        passed: false,
        feedback: option.feedback,
        newBalance: updated.sadcoins,
      });
    }
  });

  socket.on('get_certification', ({ targetLevel }) => {
    const cert = CERTIFICATIONS[targetLevel];
    if (!cert) return;
    socket.emit('certification_data', {
      targetLevel,
      title: cert.title,
      scenario: cert.scenario,
      options: cert.options.map((o, i) => ({ index: i, text: o.text })),
      cost: JOB_CONFIG[targetLevel]?.unlock_cost || 0,
    });
  });

  socket.on('get_online_players', () => {
    const onlinePlayers = Object.values(connected).map(p => ({
      playerId: p.playerId,
      username: p.username,
      job_level: p.job_level,
    }));
    socket.emit('online_players', onlinePlayers);
  });

  socket.on('refresh_player', () => {
    const c = connected[socket.id];
    if (!c) return;
    const player = getPlayer(c.playerId);
    if (player) socket.emit('player_update', { ...player, props: JSON.parse(player.props || '[]') });
  });

  // ── REVIVE (after death) ──────────────────────────────────────────────────
  socket.on('revive', () => {
    const c = connected[socket.id];
    if (!c) return;
    revivePlayer(c.playerId);
    const player = getPlayer(c.playerId);
    c.props = [];
    c.job_level = 1;
    socket.emit('login_ok', {
      player: { ...player, props: [] },
      earned: 0,
      taxDeducted: 0,
      taxCycles: 0,
      jobConfig: JOB_CONFIG,
    });
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const c = connected[socket.id];
    if (!c) return;
    db.prepare('UPDATE players SET last_online = ? WHERE id = ?').run(nowSec(), c.playerId);
    const oldCellar = c.cellarOwner;
    delete playerSockets[c.playerId];
    delete connected[socket.id];
    broadcastCellar(oldCellar);
    const onlinePlayers = Object.values(connected).map(p => ({
      playerId: p.playerId,
      username: p.username,
      job_level: p.job_level,
    }));
    io.emit('online_players', onlinePlayers);
  });
});

// ─── STATIC FILES ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SADWORLD] The Cellar Network is LIVE on http://localhost:${PORT}`);
  console.log(`[SADWORLD] The AI Corporation thanks you for your compliance.`);
});

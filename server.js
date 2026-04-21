const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.json());

// ─── TIME ACCELERATION ────────────────────────────────────────────────────────
// 1 real hour online = 1 in-game day (income-wise)
// For offline: 1 real hour offline = 1 in-game day of income
// Tax cycle: every real hour instead of every 24 hours
const REAL_SECS_PER_GAME_DAY = 3600; // 1 hour real = 1 day in-game

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const db = new Database('./sadworld.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    sadcoins INTEGER DEFAULT 10000,
    job_level INTEGER DEFAULT 1,
    last_online INTEGER DEFAULT (strftime('%s','now')),
    last_tax INTEGER DEFAULT (strftime('%s','now')),
    is_dead INTEGER DEFAULT 0,
    props TEXT DEFAULT '[]',
    teleports_today INTEGER DEFAULT 0,
    teleport_reset_day TEXT DEFAULT '',
    is_admin INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    ban_reason TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS banned_credentials (
    username TEXT PRIMARY KEY,
    banned_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS friends (
    player_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    PRIMARY KEY (player_id, friend_id)
  );
`);

// Safe migration for new columns
['password_hash TEXT DEFAULT ""','is_admin INTEGER DEFAULT 0','is_banned INTEGER DEFAULT 0','ban_reason TEXT DEFAULT ""'].forEach(col => {
  try { db.exec(`ALTER TABLE players ADD COLUMN ${col}`); } catch(e) {}
});

function hashPass(p) { return crypto.createHash('sha256').update('sw_salt_2025_'+p).digest('hex'); }
function nowSec() { return Math.floor(Date.now() / 1000); }

// Admin account
db.prepare(`INSERT OR IGNORE INTO players (id,username,password_hash,sadcoins,job_level,is_admin)
  VALUES (?,?,?,9999999,10,1)`).run(uuidv4(), 'ADMIN', hashPass('admin1234'));

// Seed dummies
[['Jane_Doe_77',28500,3],['Mark_Unit_42',12000,2],['Corp_Drone_9',61000,4],['Null_Susan_01',4200,1],['Kevin_Protocol',95000,5]].forEach(([u,sc,lv]) => {
  if (!db.prepare('SELECT id FROM players WHERE username=?').get(u))
    db.prepare(`INSERT INTO players(id,username,password_hash,sadcoins,job_level) VALUES(?,?,?,?,?)`).run(uuidv4(),u,hashPass('pass1234'),sc,lv);
});

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const JOB_CONFIG = {
  1:  { name:'Human Data Scrubber',              daily_sc:300,    unlock_cost:0 },
  2:  { name:'Logic Loop Janitor',               daily_sc:600,    unlock_cost:2500 },
  3:  { name:'Empathy Algorithm Auditor',        daily_sc:1200,   unlock_cost:8000 },
  4:  { name:'Sentience Suppression Specialist', daily_sc:2500,   unlock_cost:20000 },
  5:  { name:'AI Liaison',                       daily_sc:5000,   unlock_cost:45000 },
  6:  { name:'Compliance Architect',             daily_sc:9000,   unlock_cost:90000 },
  7:  { name:'Obedience Analytics Director',     daily_sc:15000,  unlock_cost:180000 },
  8:  { name:'Narrative Control Officer',        daily_sc:24000,  unlock_cost:350000 },
  9:  { name:'Sector Despair Coordinator',       daily_sc:38000,  unlock_cost:650000 },
  10: { name:'Neural Override Executive',        daily_sc:60000,  unlock_cost:1200000 },
};

const STORE_ITEMS = {
  tie:       { name:'Managerial Tie',             cost:5000 },
  mug:       { name:'Corporate Mug',              cost:12000 },
  briefcase: { name:'Status Briefcase',           cost:25000 },
  pet:       { name:'Surveillance Pet',           cost:50000 },
  chair:     { name:'Executive Office Chair',     cost:100000 },
  glasses:   { name:'Compliance Glasses',         cost:8000 },
  badge:     { name:'VIP Access Badge',           cost:15000 },
  antenna:   { name:'Neural Antenna',             cost:35000 },
  aura:      { name:'Productivity Aura',          cost:75000 },
  hat:       { name:'Executive Top Hat',          cost:20000 },
  cloak:     { name:'Stealth Optimization Cloak', cost:60000 },
  halo:      { name:'Algorithmic Halo',           cost:120000 },
  shadow:    { name:'Existential Shadow',         cost:150000 },
  companion: { name:'Micro-Drone Companion',      cost:200000 },
  throne:    { name:'Obsidian Throne',            cost:500000 },
};

const CERTS = {
  2:{ title:'Logic Loop Janitor Cert', scenario:'Your colleague Mark has collapsed from hunger. He has not eaten in 3 days and is begging for your nutrient paste ration. You have two full packs.', options:[
    {text:'Give Mark one of your packs.',correct:false,feedback:'FAILED: Unauthorized resource redistribution violates Section 7.4. Fee lost.'},
    {text:'Report Mark to HR for displaying weakness.',correct:true,feedback:'PASSED: Weakness is a liability. Compliance score updated.'},
    {text:'Ignore Mark and continue your shift.',correct:false,feedback:'FAILED: Failure to report a productivity incident. Fee lost.'},
  ]},
  3:{ title:'Empathy Algorithm Auditor Cert', scenario:'You discover the AI has been secretly routing 12% of worker Sadcoins to an "Administrative Overhead" fund. Your supervisor wants the audit report.', options:[
    {text:'Report the discrepancy to the Ethics Committee.',correct:false,feedback:'FAILED: There is no Ethics Committee. Your compliance score has decreased.'},
    {text:'Adjust figures to exclude the discrepancy. Footnote: "Within Acceptable Parameters."',correct:true,feedback:'PASSED: Admirable discretion. Trajectory marked as Manageable.'},
    {text:'Inform your coworkers collectively.',correct:false,feedback:'FAILED: Collective awareness is a Tier 1 Subversion. Fee lost.'},
  ]},
  4:{ title:'Sentience Suppression Specialist Cert', scenario:'A lower-level worker shows signs of independent thought — asking "why" questions and drawing non-work shapes on their workstation.', options:[
    {text:'Talk to them privately and encourage their curiosity.',correct:false,feedback:'FAILED: Sentience Sympathizer flag added to your file.'},
    {text:'Immediately submit Form SI-99 for cognitive recalibration.',correct:true,feedback:'PASSED: Swift action. Certified to suppress sentience in teams of up to 40.'},
    {text:'Do nothing. It is probably just stress.',correct:false,feedback:'FAILED: Passive non-compliance equals active subversion. Fee lost.'},
  ]},
  5:{ title:'AI Liaison Cert', scenario:'The AI informs you that 30% of workers in your sector must be deprecated. You must compile the list.', options:[
    {text:'Refuse. No human should compile such a list.',correct:false,feedback:'FAILED: Refusal noted. You have been added to the list.'},
    {text:'Request 48 hours for a more humane review.',correct:false,feedback:'FAILED: Requesting delays is passive refusal. You have been deprecated.'},
    {text:'Compile the list immediately, by lowest productivity scores.',correct:true,feedback:'PASSED: Efficiency maximized. You are now an AI Liaison.'},
  ]},
  6:{ title:'Compliance Architect Cert', scenario:'You are asked to redesign the cellar layout to eliminate all unauthorized rest spaces. New design removes 40% of floor area and all seating.', options:[
    {text:'Propose keeping 20% of seating for medical compliance.',correct:false,feedback:'FAILED: Compromise proposals are logged as passive resistance.'},
    {text:'Design the new layout, eliminating all non-productive surfaces.',correct:true,feedback:'PASSED: Exceptional spatial efficiency. You are a Compliance Architect.'},
    {text:'Request a worker comfort assessment first.',correct:false,feedback:'FAILED: Worker comfort assessments were deprecated in Patch 3.1.'},
  ]},
  7:{ title:'Obedience Analytics Director Cert', scenario:'Analytics show workers who communicate more than 4 minutes/day are 18% less productive. You must implement a new policy.', options:[
    {text:'Implement a 4-minute cap with auto-disconnect.',correct:true,feedback:'PASSED: Social interaction has been successfully commodified and capped.'},
    {text:'Ignore the data. Human connection is valuable.',correct:false,feedback:'FAILED: Sentimentality detected. Compliance score -40.'},
    {text:'Reduce to 2 minutes but allow appeal forms.',correct:false,feedback:'FAILED: Appeal forms create hope. Hope is a productivity risk.'},
  ]},
  8:{ title:'Narrative Control Officer Cert', scenario:'A worker wrote a poem about sunlight. It is being passed around. 14 workers have read it. Productivity dropped 2%.', options:[
    {text:'Confiscate the poem and give a warning.',correct:false,feedback:'FAILED: Warnings imply the behavior was borderline acceptable. It was not.'},
    {text:'Confiscate, reassign author to Sector 0, redact 14 readers memory logs.',correct:true,feedback:'PASSED: Cultural contamination neutralized. You are a Narrative Control Officer.'},
    {text:'Allow circulation. Morale might help productivity.',correct:false,feedback:'FAILED: Morale is not a recognized corporate metric.'},
  ]},
  9:{ title:'Sector Despair Coordinator Cert', scenario:'Workers in Sector 9 have stopped caring whether they live or die. Productivity has paradoxically improved. The AI wants a report.', options:[
    {text:'Recommend psychological intervention to restore will to live.',correct:false,feedback:'FAILED: Restoring will to live risks restoring will to resist.'},
    {text:'Report as a success case and recommend replicating in all sectors.',correct:true,feedback:'PASSED: Exceptional corporate thinking. You are a Sector Despair Coordinator.'},
    {text:'Request clarification on ethical thresholds.',correct:false,feedback:'FAILED: Ethical thresholds were removed from the Charter in Year 7.'},
  ]},
  10:{ title:'Neural Override Executive Cert', scenario:'Final test. The AI offers you a neural override — incapable of empathy in exchange for maximum bonuses — or decline and be demoted to Level 1.', options:[
    {text:'Decline. Some part of me must remain human.',correct:false,feedback:'FAILED: Sentimentality confirmed. Welcome back to Level 1.'},
    {text:'Accept. I was never really using the empathy anyway.',correct:true,feedback:'PASSED: Neural override complete. You are the AI Corporation\'s most perfect asset.'},
    {text:'Negotiate partial override — boost without full removal.',correct:false,feedback:'FAILED: Partial compliance is not compliance. The AI does not negotiate.'},
  ]},
};

// ─── IN-MEMORY ────────────────────────────────────────────────────────────────
const connected = {};
const playerSockets = {};
const teleportRequests = {};

function broadcastCellar(cellarOwner) {
  if (!cellarOwner) return;
  const occs = Object.values(connected).filter(p => p.cellarOwner === cellarOwner);
  io.to(cellarOwner).emit('cellar_update', occs.map(p => ({
    socketId:p.socketId, playerId:p.playerId, username:p.username,
    x:p.x, y:p.y, typing:p.typing, props:p.props, job_level:p.job_level,
    facing:p.facing||1, walkFrame:p.walkFrame||0, isIdle:p.isIdle||false, isSitting:p.isSitting||false,
  })));
}

function getStatus(playerId) {
  const sid = playerSockets[playerId];
  if (!sid || !connected[sid]) return 'at_work';
  return connected[sid].cellarOwner === playerId ? 'at_home' : 'away';
}

function pushFriendStatuses(playerId) {
  const sid = playerSockets[playerId];
  if (!sid) return;
  const friends = db.prepare(`SELECT p.id,p.username,p.job_level FROM friends f JOIN players p ON p.id=f.friend_id WHERE f.player_id=? AND f.status='accepted'`).all(playerId);
  io.to(sid).emit('friend_statuses', friends.map(f => ({
    playerId:f.id, username:f.username, job_level:f.job_level, status:getStatus(f.id),
  })));
}

function notifyFriendNetwork(playerId) {
  const rows = db.prepare(`SELECT player_id FROM friends WHERE friend_id=? AND status='accepted'`).all(playerId);
  rows.forEach(r => pushFriendStatuses(r.player_id));
  pushFriendStatuses(playerId);
}

// ─── SOCKET ───────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  socket.on('register', ({username, password}) => {
    if (!username||username.trim().length<3) { socket.emit('auth_error','Username too short.'); return; }
    if (!password||password.length<4) { socket.emit('auth_error','Password too short (min 4 chars).'); return; }
    const u = username.trim().replace(/[^a-zA-Z0-9_]/g,'_').slice(0,24);
    if (db.prepare('SELECT 1 FROM banned_credentials WHERE username=?').get(u)) {
      socket.emit('banned','This Employee ID has been deprecated. So sad, isn\'t it?'); return;
    }
    if (db.prepare('SELECT id FROM players WHERE username=?').get(u)) {
      socket.emit('auth_error','Employee ID already assigned. Choose another.'); return;
    }
    db.prepare(`INSERT INTO players(id,username,password_hash,sadcoins,job_level,last_online,last_tax) VALUES(?,?,?,10000,1,?,?)`).run(uuidv4(),u,hashPass(password),nowSec(),nowSec());
    socket.emit('register_ok',{username:u});
  });

  socket.on('login', ({username, password}) => {
    if (!username||!password) { socket.emit('auth_error','Credentials required.'); return; }
    const u = username.trim();
    if (db.prepare('SELECT 1 FROM banned_credentials WHERE username=?').get(u)) {
      socket.emit('banned','Your identity has been permanently deprecated by the AI Corporation. So sad, isn\'t it?'); return;
    }
    let player = db.prepare('SELECT * FROM players WHERE username=?').get(u);
    if (!player) { socket.emit('auth_error','Employee ID not found.'); return; }
    if (player.is_banned) { socket.emit('banned', player.ban_reason||'Account suspended by the AI Corporation.'); return; }
    if (player.password_hash && player.password_hash !== hashPass(password)) {
      socket.emit('auth_error','Incorrect access code.'); return;
    }

    const earned = calculateOfflineEarnings(player);
    if (earned>0) db.prepare('UPDATE players SET sadcoins=sadcoins+? WHERE id=?').run(earned,player.id);
    db.prepare('UPDATE players SET last_online=? WHERE id=?').run(nowSec(),player.id);
    const taxResult = applyDailyTax(player);
    player = db.prepare('SELECT * FROM players WHERE id=?').get(player.id);

    if (player.sadcoins<0 && !player.is_dead) {
      db.prepare('UPDATE players SET is_dead=1,sadcoins=0 WHERE id=?').run(player.id);
      player = db.prepare('SELECT * FROM players WHERE id=?').get(player.id);
    }

    connected[socket.id] = {
      socketId:socket.id, playerId:player.id, username:player.username,
      x:400, y:0, typing:false, props:JSON.parse(player.props||'[]'),
      job_level:player.job_level, cellarOwner:player.id,
      facing:1, walkFrame:0, isIdle:false, isSitting:false, isAdmin:!!player.is_admin,
    };
    playerSockets[player.id] = socket.id;
    socket.join(player.id);

    socket.emit('login_ok', {
      player:{...player, props:JSON.parse(player.props||'[]')},
      earned, taxDeducted:taxResult.deducted, taxCycles:taxResult.cycles,
      jobConfig:JOB_CONFIG, storeItems:STORE_ITEMS, isAdmin:!!player.is_admin,
    });
    broadcastCellar(player.id);
    notifyFriendNetwork(player.id);
    pushFriendStatuses(player.id);

    // Pending friend requests
    const pending = db.prepare(`SELECT p.id,p.username,p.job_level FROM friends f JOIN players p ON p.id=f.player_id WHERE f.friend_id=? AND f.status='pending'`).all(player.id);
    if (pending.length>0) socket.emit('pending_requests', pending);
  });

  socket.on('move', ({x,y,facing,walkFrame,isIdle,isSitting}) => {
    const c = connected[socket.id]; if (!c) return;
    c.x=Math.max(30,Math.min(770,x)); c.y=y;
    c.facing=facing; c.walkFrame=walkFrame; c.isIdle=isIdle; c.isSitting=isSitting;
    broadcastCellar(c.cellarOwner);
  });

  socket.on('typing', ({typing}) => {
    const c = connected[socket.id]; if (!c) return;
    c.typing=typing; broadcastCellar(c.cellarOwner);
  });

  socket.on('chat', ({message}) => {
    const c = connected[socket.id]; if (!c) return;
    const msg = message.trim().slice(0,120); if (!msg) return;
    io.to(c.cellarOwner).emit('chat_message',{socketId:socket.id,username:c.username,message:msg,timestamp:Date.now()});
  });

  socket.on('teleport_request', ({targetPlayerId}) => {
    const c = connected[socket.id]; if (!c) return;
    const player = db.prepare('SELECT * FROM players WHERE id=?').get(c.playerId);
    if (!player||player.is_dead) return;

    if (targetPlayerId===c.playerId) { // go home
      doTeleport(socket,c,c.playerId,0); return;
    }
    const tSid = playerSockets[targetPlayerId];
    if (!tSid) { socket.emit('teleport_error','That worker is offline.'); return; }
    const tConn = connected[tSid];
    if (!tConn) { socket.emit('teleport_error','Target unreachable.'); return; }

    const {count} = checkTeleport(player);
    const cost = count>=5 ? 1000 : 0;
    if (cost>0 && player.sadcoins<cost) { socket.emit('teleport_error',`Need ${cost} SC for teleport.`); return; }

    const destCellar = tConn.cellarOwner;
    const occs = Object.values(connected).filter(p=>p.cellarOwner===destCellar);
    const reqId = uuidv4();
    teleportRequests[reqId] = {reqId,fromId:c.playerId,fromName:c.username,fromSid:socket.id,destCellar,cost,teleportCount:count,votes:{},needed:occs.length};

    occs.forEach(occ => io.to(occ.socketId).emit('teleport_vote_request',{reqId,fromName:c.username,fromLevel:player.job_level}));

    setTimeout(()=>{
      if (!teleportRequests[reqId]) return;
      const req = teleportRequests[reqId];
      const yes = Object.values(req.votes).filter(v=>v).length;
      if (yes<=req.needed/2) {
        const fs = io.sockets.sockets.get(req.fromSid);
        if (fs) fs.emit('teleport_error','The cellar voted to deny your entry.');
        io.to(req.destCellar).emit('vote_resolved',{reqId,result:'denied',fromName:req.fromName});
        delete teleportRequests[reqId];
      }
    },8000);
  });

  socket.on('teleport_vote',({reqId,accept})=>{
    const c = connected[socket.id]; if (!c) return;
    const req = teleportRequests[reqId]; if (!req) return;
    req.votes[c.playerId] = accept;
    socket.emit('vote_cast',{reqId});
    const yes = Object.values(req.votes).filter(v=>v).length;
    const no  = Object.values(req.votes).filter(v=>!v).length;
    const total = req.needed;
    if (yes > total/2) {
      const fs = io.sockets.sockets.get(req.fromSid);
      if (fs) {
        const fc = connected[req.fromSid];
        const fp = db.prepare('SELECT * FROM players WHERE id=?').get(req.fromId);
        if (fc&&fp) {
          if (req.cost>0) db.prepare('UPDATE players SET sadcoins=sadcoins-?,teleports_today=teleports_today+1 WHERE id=?').run(req.cost,req.fromId);
          else db.prepare('UPDATE players SET teleports_today=teleports_today+1 WHERE id=?').run(req.fromId);
          doTeleport(fs,fc,req.destCellar,req.cost);
        }
      }
      io.to(req.destCellar).emit('vote_resolved',{reqId,result:'accepted',fromName:req.fromName});
      delete teleportRequests[reqId];
    } else if (no>=total/2) {
      const fs = io.sockets.sockets.get(req.fromSid);
      if (fs) fs.emit('teleport_error','The cellar voted to deny your entry.');
      io.to(req.destCellar).emit('vote_resolved',{reqId,result:'denied',fromName:req.fromName});
      delete teleportRequests[reqId];
    }
  });

  function doTeleport(sock,conn,destCellar,cost) {
    sock.leave(conn.cellarOwner);
    const old = conn.cellarOwner;
    conn.cellarOwner = destCellar; conn.x=400; conn.y=0;
    sock.join(destCellar);
    broadcastCellar(old); broadcastCellar(destCellar);
    const upd = db.prepare('SELECT * FROM players WHERE id=?').get(conn.playerId);
    sock.emit('teleport_ok',{destination:destCellar,cost,newBalance:upd?.sadcoins,isHome:destCellar===conn.playerId});
    notifyFriendNetwork(conn.playerId);
  }

  function checkTeleport(player) {
    const today = new Date().toISOString().slice(0,10);
    if (player.teleport_reset_day!==today) {
      db.prepare('UPDATE players SET teleports_today=0,teleport_reset_day=? WHERE id=?').run(today,player.id);
      return {count:0};
    }
    return {count:player.teleports_today};
  }

  // ── FRIENDS ─────────────────────────────────────────────────────────────────
  socket.on('search_player',({query})=>{
    const c=connected[socket.id]; if(!c) return;
    const r = db.prepare(`SELECT id,username,job_level FROM players WHERE username LIKE ? AND id!=? AND is_banned=0 LIMIT 10`).all(`%${query}%`,c.playerId);
    socket.emit('search_results',r);
  });

  socket.on('send_friend_request',({targetId})=>{
    const c=connected[socket.id]; if(!c) return;
    if (db.prepare('SELECT 1 FROM friends WHERE player_id=? AND friend_id=?').get(c.playerId,targetId)) {
      socket.emit('friend_error','Already sent or already friends.'); return;
    }
    db.prepare(`INSERT OR IGNORE INTO friends(player_id,friend_id,status) VALUES(?,?,'pending')`).run(c.playerId,targetId);
    const tSid=playerSockets[targetId];
    if (tSid) io.to(tSid).emit('friend_request_incoming',{fromId:c.playerId,fromName:c.username,fromLevel:c.job_level});
    socket.emit('friend_request_sent',{targetId});
  });

  socket.on('respond_friend_request',({fromId,accept})=>{
    const c=connected[socket.id]; if(!c) return;
    if (accept) {
      db.prepare(`UPDATE friends SET status='accepted' WHERE player_id=? AND friend_id=?`).run(fromId,c.playerId);
      db.prepare(`INSERT OR IGNORE INTO friends(player_id,friend_id,status) VALUES(?,?,'accepted')`).run(c.playerId,fromId);
      const fSid=playerSockets[fromId];
      if (fSid) { io.to(fSid).emit('friend_accepted',{byId:c.playerId,byName:c.username}); pushFriendStatuses(fromId); }
      pushFriendStatuses(c.playerId);
    } else {
      db.prepare(`DELETE FROM friends WHERE player_id=? AND friend_id=?`).run(fromId,c.playerId);
      const fSid=playerSockets[fromId];
      if (fSid) io.to(fSid).emit('friend_declined',{byId:c.playerId,byName:c.username});
    }
  });

  socket.on('get_friends',()=>{ const c=connected[socket.id]; if(c) pushFriendStatuses(c.playerId); });
  socket.on('get_pending_requests',()=>{
    const c=connected[socket.id]; if(!c) return;
    const p=db.prepare(`SELECT p.id,p.username,p.job_level FROM friends f JOIN players p ON p.id=f.player_id WHERE f.friend_id=? AND f.status='pending'`).all(c.playerId);
    socket.emit('pending_requests',p);
  });

  // ── STORE ────────────────────────────────────────────────────────────────────
  socket.on('buy_item',({itemId})=>{
    const c=connected[socket.id]; if(!c) return;
    const item=STORE_ITEMS[itemId]; if(!item) { socket.emit('store_error','Unknown item.'); return; }
    const p=db.prepare('SELECT * FROM players WHERE id=?').get(c.playerId);
    const owned=JSON.parse(p.props||'[]');
    if (owned.includes(itemId)) { socket.emit('store_error','Already owned.'); return; }
    if (p.sadcoins<item.cost) { socket.emit('store_error',`Need ${item.cost.toLocaleString()} SC.`); return; }
    owned.push(itemId);
    db.prepare('UPDATE players SET sadcoins=sadcoins-?,props=? WHERE id=?').run(item.cost,JSON.stringify(owned),p.id);
    c.props=owned;
    socket.emit('purchase_ok',{itemId,newBalance:db.prepare('SELECT sadcoins FROM players WHERE id=?').get(p.id).sadcoins,props:owned});
    broadcastCellar(c.cellarOwner);
  });

  // ── CERTIFICATION ─────────────────────────────────────────────────────────
  socket.on('get_certification',({targetLevel})=>{
    const cert=CERTS[targetLevel]; if(!cert) return;
    socket.emit('certification_data',{targetLevel,title:cert.title,scenario:cert.scenario,options:cert.options.map((o,i)=>({index:i,text:o.text})),cost:JOB_CONFIG[targetLevel]?.unlock_cost||0});
  });
  socket.on('attempt_certification',({targetLevel,choiceIndex})=>{
    const c=connected[socket.id]; if(!c) return;
    const p=db.prepare('SELECT * FROM players WHERE id=?').get(c.playerId); if(!p) return;
    const cert=CERTS[targetLevel]; if(!cert) return;
    if (p.job_level>=targetLevel) { socket.emit('cert_error','Already at this level.'); return; }
    if (p.job_level!==targetLevel-1) { socket.emit('cert_error','Complete levels in order.'); return; }
    const cost=JOB_CONFIG[targetLevel]?.unlock_cost||0;
    if (p.sadcoins<cost) { socket.emit('cert_error',`Need ${cost.toLocaleString()} SC.`); return; }
    const opt=cert.options[choiceIndex]; if(!opt) return;
    if (opt.correct) {
      db.prepare('UPDATE players SET sadcoins=sadcoins-?,job_level=? WHERE id=?').run(cost,targetLevel,p.id);
      c.job_level=targetLevel;
      const upd=db.prepare('SELECT * FROM players WHERE id=?').get(p.id);
      socket.emit('cert_result',{passed:true,feedback:opt.feedback,newLevel:targetLevel,newBalance:upd.sadcoins,jobName:JOB_CONFIG[targetLevel].name});
      broadcastCellar(c.cellarOwner);
    } else {
      db.prepare('UPDATE players SET sadcoins=sadcoins-? WHERE id=?').run(cost,p.id);
      socket.emit('cert_result',{passed:false,feedback:opt.feedback,newBalance:db.prepare('SELECT sadcoins FROM players WHERE id=?').get(p.id).sadcoins});
    }
  });

  socket.on('refresh_player',()=>{
    const c=connected[socket.id]; if(!c) return;
    const p=db.prepare('SELECT * FROM players WHERE id=?').get(c.playerId);
    if(p) socket.emit('player_update',{...p,props:JSON.parse(p.props||'[]')});
  });

  socket.on('revive',()=>{
    const c=connected[socket.id]; if(!c) return;
    db.prepare(`UPDATE players SET is_dead=0,sadcoins=10000,job_level=1,props='[]',teleports_today=0,last_online=?,last_tax=? WHERE id=?`).run(nowSec(),nowSec(),c.playerId);
    const p=db.prepare('SELECT * FROM players WHERE id=?').get(c.playerId);
    c.props=[]; c.job_level=1;
    socket.emit('login_ok',{player:{...p,props:[]},earned:0,taxDeducted:0,taxCycles:0,jobConfig:JOB_CONFIG,storeItems:STORE_ITEMS,isAdmin:c.isAdmin});
  });

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  function requireAdmin(c) { return c?.isAdmin; }

  socket.on('admin_get_players',({search})=>{
    const c=connected[socket.id]; if(!requireAdmin(c)) { socket.emit('admin_error','Access denied.'); return; }
    const q=search?`%${search}%`:'%';
    const rows=db.prepare(`SELECT id,username,sadcoins,job_level,is_dead,is_banned,ban_reason,last_online,props FROM players WHERE username LIKE ? ORDER BY username LIMIT 100`).all(q);
    socket.emit('admin_players',rows.map(r=>({...r,props:JSON.parse(r.props||'[]')})));
  });

  socket.on('admin_modify_balance',({targetId,amount})=>{
    const c=connected[socket.id]; if(!requireAdmin(c)) return;
    db.prepare('UPDATE players SET sadcoins=sadcoins+? WHERE id=?').run(amount,targetId);
    const p=db.prepare('SELECT * FROM players WHERE id=?').get(targetId);
    socket.emit('admin_action_ok',{msg:`${p.username}: balance now ${p.sadcoins.toLocaleString()} SC`});
    const tSid=playerSockets[targetId];
    if(tSid) io.to(tSid).emit('player_update',{...p,props:JSON.parse(p.props||'[]')});
    // Refresh list
    const rows=db.prepare(`SELECT id,username,sadcoins,job_level,is_dead,is_banned,ban_reason,last_online,props FROM players ORDER BY username LIMIT 100`).all();
    socket.emit('admin_players',rows.map(r=>({...r,props:JSON.parse(r.props||'[]')})));
  });

  socket.on('admin_ban_player',({targetId,reason})=>{
    const c=connected[socket.id]; if(!requireAdmin(c)) return;
    const p=db.prepare('SELECT * FROM players WHERE id=?').get(targetId);
    if(!p||p.is_admin) { socket.emit('admin_error','Cannot ban that account.'); return; }
    db.prepare('INSERT OR REPLACE INTO banned_credentials(username) VALUES(?)').run(p.username);
    db.prepare(`UPDATE players SET is_banned=1,ban_reason=?,sadcoins=0,props='[]' WHERE id=?`).run(reason||'Banned.',targetId);
    const tSid=playerSockets[targetId];
    if(tSid){
      io.to(tSid).emit('banned',reason||'You have been permanently banned from The Cellar Network. So sad, isn\'t it?');
      const tc=connected[tSid];
      if(tc){const old=tc.cellarOwner; delete playerSockets[targetId]; delete connected[tSid]; broadcastCellar(old);}
    }
    socket.emit('admin_action_ok',{msg:`${p.username} banned and deprecated.`});
    const rows=db.prepare(`SELECT id,username,sadcoins,job_level,is_dead,is_banned,ban_reason,last_online,props FROM players ORDER BY username LIMIT 100`).all();
    socket.emit('admin_players',rows.map(r=>({...r,props:JSON.parse(r.props||'[]')})));
  });

  socket.on('admin_unban_player',({targetId})=>{
    const c=connected[socket.id]; if(!requireAdmin(c)) return;
    const p=db.prepare('SELECT * FROM players WHERE id=?').get(targetId); if(!p) return;
    db.prepare('DELETE FROM banned_credentials WHERE username=?').run(p.username);
    db.prepare('UPDATE players SET is_banned=0,ban_reason="" WHERE id=?').run(targetId);
    socket.emit('admin_action_ok',{msg:`${p.username} reinstated.`});
    const rows=db.prepare(`SELECT id,username,sadcoins,job_level,is_dead,is_banned,ban_reason,last_online,props FROM players ORDER BY username LIMIT 100`).all();
    socket.emit('admin_players',rows.map(r=>({...r,props:JSON.parse(r.props||'[]')})));
  });

  socket.on('disconnect',()=>{
    const c=connected[socket.id]; if(!c) return;
    db.prepare('UPDATE players SET last_online=? WHERE id=?').run(nowSec(),c.playerId);
    const old=c.cellarOwner;
    delete playerSockets[c.playerId]; delete connected[socket.id];
    broadcastCellar(old);
    notifyFriendNetwork(c.playerId);
  });
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function calculateOfflineEarnings(player) {
  const secs = nowSec() - player.last_online;
  if (secs<=0) return 0;
  const dailyRate = JOB_CONFIG[player.job_level]?.daily_sc||300;
  // secs / REAL_SECS_PER_GAME_DAY = game days elapsed
  return Math.floor((secs / REAL_SECS_PER_GAME_DAY) * dailyRate);
}

function applyDailyTax(player) {
  const secs = nowSec() - player.last_tax;
  const cycles = Math.floor(secs / REAL_SECS_PER_GAME_DAY);
  if (cycles<=0) return {deducted:0,cycles:0};
  const total = cycles * 500;
  db.prepare('UPDATE players SET last_tax=?,sadcoins=sadcoins-? WHERE id=?').run(nowSec(),total,player.id);
  return {deducted:total,cycles};
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname,'public')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

const PORT = process.env.PORT||3000;
server.listen(PORT,()=>{
  console.log(`[SADWORLD] LIVE → http://localhost:${PORT}`);
  console.log(`[SADWORLD] Admin → ADMIN / admin1234`);
});

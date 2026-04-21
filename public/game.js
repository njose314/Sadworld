// ═══════════════════════════════════════════════════════════════════════════
//  SADWORLD — THE CELLAR NETWORK  |  game.js
//  Full Canvas Engine + Socket.io Client
// ═══════════════════════════════════════════════════════════════════════════

const socket = io();

// ─── STATE ───────────────────────────────────────────────────────────────────
const G = {
  GREEN: '#00FF41',
  GREEN_DIM: '#00b32d',
  GREEN_GHOST: 'rgba(0,255,65,0.06)',
  BG: '#0D0208',
  localPlayer: null,     // full player object from server
  mySocketId: null,
  cellarOwner: null,     // whose cellar we're in

  // movement
  keys: {},
  myX: 400, myY: 380,
  speed: 3,
  stillTimer: 0,       // ms without movement
  isSitting: false,

  // online players in current cellar
  cellarOccupants: [],

  // chat bubbles: { socketId, lines: [{text, y, targetY, alpha}], x, y, birth }
  bubbles: {},

  // typing indicators
  typingIndicators: {},

  // matrix rain
  rain: [],
  rainCols: 0,

  // canvas
  canvas: null, ctx: null, W: 0, H: 0,

  // animation
  raf: null, lastTime: 0,
  sineT: 0,

  // online players list (all, not just cellar)
  onlinePlayers: [],

  // pending cert modal
  certData: null,
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  G.canvas = document.getElementById('game-canvas');
  G.ctx = G.canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  initRain();
  startRenderLoop();
  bindKeys();
  bindUI();
});

function resizeCanvas() {
  const col = document.getElementById('canvas-col');
  G.W = G.canvas.width = col.clientWidth || 800;
  G.H = G.canvas.height = col.clientHeight - 48 || 520; // subtract chat bar
  initRain();
}

// ─── MATRIX RAIN ─────────────────────────────────────────────────────────────
function initRain() {
  const FONT_SIZE = 14;
  G.rainCols = Math.floor(G.W / FONT_SIZE);
  G.rain = Array.from({ length: G.rainCols }, () => ({
    y: Math.random() * -50,
    speed: 0.3 + Math.random() * 0.8,
    chars: Array.from({ length: 20 }, () => randomRainChar()),
    alpha: 0.05 + Math.random() * 0.12,
  }));
}

function randomRainChar() {
  const sets = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';
  return sets[Math.floor(Math.random() * sets.length)];
}

function drawRain(dt) {
  const FONT_SIZE = 14;
  G.ctx.font = `${FONT_SIZE}px 'Share Tech Mono', monospace`;
  G.rain.forEach((col, ci) => {
    col.y += col.speed * dt * 0.05;
    if (col.y > G.H / FONT_SIZE + 5) {
      col.y = -5;
      col.speed = 0.3 + Math.random() * 0.8;
      col.alpha = 0.04 + Math.random() * 0.1;
    }
    if (Math.random() < 0.03) {
      col.chars[Math.floor(Math.random() * col.chars.length)] = randomRainChar();
    }
    for (let row = 0; row < col.chars.length; row++) {
      const y = Math.floor(col.y) - row;
      if (y < 0 || y > G.H / FONT_SIZE) continue;
      const headAlpha = row === 0 ? Math.min(col.alpha * 3, 0.7) : col.alpha * (1 - row / col.chars.length);
      G.ctx.fillStyle = `rgba(0,255,65,${headAlpha})`;
      G.ctx.fillText(col.chars[row], ci * FONT_SIZE, y * FONT_SIZE);
    }
  });
}

// ─── CELLAR ROOM DRAWING ──────────────────────────────────────────────────────
function drawRoom() {
  const ctx = G.ctx;
  const W = G.W, H = G.H;
  const FLOOR_Y = H - 80;
  const alpha = 0.6;

  // Floor
  ctx.strokeStyle = `rgba(0,255,65,${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(20, FLOOR_Y); ctx.lineTo(W - 20, FLOOR_Y);
  ctx.stroke();

  // Walls (left, right)
  ctx.beginPath();
  ctx.moveTo(20, 60); ctx.lineTo(20, FLOOR_Y);
  ctx.moveTo(W - 20, 60); ctx.lineTo(W - 20, FLOOR_Y);
  ctx.stroke();

  // Ceiling
  ctx.beginPath();
  ctx.moveTo(20, 60); ctx.lineTo(W - 20, 60);
  ctx.stroke();

  // Ceiling pipes
  for (let px = 80; px < W - 80; px += 140) {
    ctx.strokeStyle = `rgba(0,255,65,${alpha * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px, 60); ctx.lineTo(px, 90);
    ctx.stroke();
    // pipe cap
    ctx.beginPath();
    ctx.moveTo(px - 8, 90); ctx.lineTo(px + 8, 90);
    ctx.stroke();
  }

  // Floor details
  ctx.strokeStyle = `rgba(0,255,65,${alpha * 0.3})`;
  ctx.lineWidth = 1;
  for (let fx = 40; fx < W - 40; fx += 60) {
    ctx.beginPath();
    ctx.moveTo(fx, FLOOR_Y); ctx.lineTo(fx + 20, FLOOR_Y - 8);
    ctx.stroke();
  }

  // Corner brackets
  const bracket = (x, y, dir) => {
    const s = 16, sw = dir; // dir: 1=TL, -1=TR
    ctx.strokeStyle = `rgba(0,255,65,${alpha * 0.7})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + s); ctx.lineTo(x, y); ctx.lineTo(x + sw * s, y);
    ctx.stroke();
  };
  bracket(20, 60, 1); bracket(W - 20, 60, -1);
  bracket(20, FLOOR_Y, 1); bracket(W - 20, FLOOR_Y, -1);

  // workstation desk (ambient prop)
  drawDesk(W * 0.08, FLOOR_Y);
  drawDesk(W * 0.85, FLOOR_Y);

  // If chair is owned by cellar owner, draw it
  const ownerOccupant = G.cellarOccupants.find(p => p.playerId === G.cellarOwner);
  if (ownerOccupant && ownerOccupant.props && ownerOccupant.props.includes('chair')) {
    drawChair(W / 2, FLOOR_Y - 2);
  }

  // Location label at top
  ctx.font = "10px 'Share Tech Mono'";
  ctx.fillStyle = `rgba(0,255,65,0.2)`;
  ctx.textAlign = 'right';
  ctx.fillText(`CELLAR #${(G.cellarOwner || '????').slice(0, 8).toUpperCase()}`, W - 26, 78);
  ctx.textAlign = 'left';
}

function drawDesk(x, floorY) {
  const ctx = G.ctx;
  ctx.strokeStyle = 'rgba(0,255,65,0.25)';
  ctx.lineWidth = 1.5;
  // desk surface
  ctx.beginPath();
  ctx.moveTo(x - 30, floorY - 28); ctx.lineTo(x + 30, floorY - 28);
  ctx.stroke();
  // desk legs
  ctx.beginPath();
  ctx.moveTo(x - 25, floorY - 28); ctx.lineTo(x - 25, floorY);
  ctx.moveTo(x + 25, floorY - 28); ctx.lineTo(x + 25, floorY);
  ctx.stroke();
  // monitor
  ctx.beginPath();
  ctx.moveTo(x - 12, floorY - 56); ctx.lineTo(x + 12, floorY - 56);
  ctx.lineTo(x + 12, floorY - 30); ctx.lineTo(x - 12, floorY - 30);
  ctx.closePath();
  ctx.stroke();
  // monitor stand
  ctx.beginPath();
  ctx.moveTo(x, floorY - 30); ctx.lineTo(x, floorY - 28);
  ctx.stroke();
}

function drawChair(x, floorY) {
  const ctx = G.ctx;
  ctx.strokeStyle = 'rgba(0,255,65,0.5)';
  ctx.lineWidth = 2;
  // seat
  ctx.beginPath();
  ctx.moveTo(x - 22, floorY - 25); ctx.lineTo(x + 22, floorY - 25);
  ctx.stroke();
  // high back
  ctx.beginPath();
  ctx.moveTo(x - 18, floorY - 25); ctx.lineTo(x - 18, floorY - 72);
  ctx.lineTo(x + 18, floorY - 72); ctx.lineTo(x + 18, floorY - 25);
  ctx.stroke();
  // headrest
  ctx.beginPath();
  ctx.moveTo(x - 12, floorY - 72); ctx.lineTo(x - 12, floorY - 82);
  ctx.lineTo(x + 12, floorY - 82); ctx.lineTo(x + 12, floorY - 72);
  ctx.stroke();
  // legs
  ctx.beginPath();
  ctx.moveTo(x - 18, floorY - 25); ctx.lineTo(x - 18, floorY);
  ctx.moveTo(x + 18, floorY - 25); ctx.lineTo(x + 18, floorY);
  ctx.stroke();
  // armrests
  ctx.beginPath();
  ctx.moveTo(x - 18, floorY - 45); ctx.lineTo(x - 30, floorY - 45);
  ctx.moveTo(x + 18, floorY - 45); ctx.lineTo(x + 30, floorY - 45);
  ctx.stroke();
}

// ─── STICK FIGURE AVATAR ──────────────────────────────────────────────────────
const FLOOR_OFFSET = 80; // from bottom
function floorY() { return G.H - FLOOR_OFFSET; }

function drawAvatar(ctx, x, y, props, isSelf, username, isTyping, isSitting) {
  const FY = floorY();
  const ay = isSitting ? FY - 25 : y;

  if (isSitting) {
    // sitting pose
    drawSitPose(ctx, x, ay, props, isSelf);
  } else {
    drawStandPose(ctx, x, ay, props, isSelf);
  }

  // Username label
  ctx.font = "9px 'Share Tech Mono'";
  ctx.fillStyle = isSelf ? G.GREEN : G.GREEN_DIM;
  ctx.textAlign = 'center';
  const label = isSelf ? `[YOU] ${username}` : username;
  ctx.fillText(label, x, ay - 52);
  ctx.textAlign = 'left';

  // Typing indicator
  if (isTyping) {
    ctx.font = "11px 'Share Tech Mono'";
    ctx.fillStyle = G.GREEN;
    ctx.textAlign = 'center';
    ctx.fillText('[...]', x, ay - 64);
    ctx.textAlign = 'left';
  }
}

function drawStandPose(ctx, x, y, props, isSelf) {
  const col = isSelf ? G.GREEN : G.GREEN_DIM;
  ctx.strokeStyle = col;
  ctx.lineWidth = isSelf ? 2 : 1.5;

  // Head
  ctx.beginPath();
  ctx.arc(x, y - 42, 8, 0, Math.PI * 2);
  ctx.stroke();

  // Neck + body
  ctx.beginPath();
  ctx.moveTo(x, y - 34); ctx.lineTo(x, y - 12);
  ctx.stroke();

  // Arms
  ctx.beginPath();
  ctx.moveTo(x - 16, y - 24); ctx.lineTo(x, y - 28); ctx.lineTo(x + 16, y - 24);
  ctx.stroke();

  // Legs
  ctx.beginPath();
  ctx.moveTo(x, y - 12); ctx.lineTo(x - 10, y); ctx.moveTo(x, y - 12); ctx.lineTo(x + 10, y);
  ctx.stroke();

  // Props
  drawProps(ctx, x, y, props, col, false);
}

function drawSitPose(ctx, x, y, props, isSelf) {
  const col = isSelf ? G.GREEN : G.GREEN_DIM;
  ctx.strokeStyle = col;
  ctx.lineWidth = isSelf ? 2 : 1.5;

  // Head (higher up)
  ctx.beginPath();
  ctx.arc(x, y - 42, 8, 0, Math.PI * 2);
  ctx.stroke();
  // Body
  ctx.beginPath();
  ctx.moveTo(x, y - 34); ctx.lineTo(x, y - 14);
  ctx.stroke();
  // Arms resting
  ctx.beginPath();
  ctx.moveTo(x - 20, y - 22); ctx.lineTo(x, y - 26); ctx.lineTo(x + 20, y - 22);
  ctx.stroke();
  // Legs bent (sitting)
  ctx.beginPath();
  ctx.moveTo(x, y - 14); ctx.lineTo(x - 14, y - 14); ctx.lineTo(x - 18, y + 4);
  ctx.moveTo(x, y - 14); ctx.lineTo(x + 14, y - 14); ctx.lineTo(x + 18, y + 4);
  ctx.stroke();

  drawProps(ctx, x, y, props, col, true);
}

function drawProps(ctx, x, y, props, col, sitting) {
  if (!props) return;

  // Managerial Tie
  if (props.includes('tie')) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 32); ctx.lineTo(x, y - 14);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 14); ctx.lineTo(x, y - 10); ctx.lineTo(x + 3, y - 14);
    ctx.stroke();
  }

  // Corporate Mug
  if (props.includes('mug')) {
    const mx = x + 18, my = y - 20;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    // cylinder
    ctx.beginPath();
    ctx.moveTo(mx - 5, my - 6); ctx.lineTo(mx - 5, my + 4);
    ctx.lineTo(mx + 5, my + 4); ctx.lineTo(mx + 5, my - 6);
    ctx.stroke();
    // top ellipse
    ctx.beginPath();
    ctx.ellipse(mx, my - 6, 5, 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    // handle
    ctx.beginPath();
    ctx.arc(mx + 7, my - 1, 4, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }

  // Status Briefcase (dragged on floor)
  if (props.includes('briefcase')) {
    const bx = x - 30, by = y - 6;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx - 10, by - 10, 20, 14);
    ctx.strokeRect(bx - 10, by - 10, 20, 14);
    ctx.beginPath();
    ctx.moveTo(bx - 4, by - 10); ctx.lineTo(bx - 4, by - 13); ctx.lineTo(bx + 4, by - 13); ctx.lineTo(bx + 4, by - 10);
    ctx.stroke();
    // drag line
    ctx.strokeStyle = `rgba(0,255,65,0.3)`;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 6); ctx.lineTo(bx + 10, by - 3);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Surveillance Pet — glowing diamond sine wave
  if (props.includes('pet')) {
    const petX = x + 28;
    const petY = y - 52 + Math.sin(G.sineT * 0.04) * 10;
    ctx.strokeStyle = col;
    ctx.fillStyle = 'rgba(0,255,65,0.15)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = G.GREEN;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(petX, petY - 8);
    ctx.lineTo(petX + 6, petY);
    ctx.lineTo(petX, petY + 8);
    ctx.lineTo(petX - 6, petY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // eye dot
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(petX, petY, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── CHAT BUBBLES ─────────────────────────────────────────────────────────────
function addBubble(socketId, message, x, y) {
  const DURATION = 5000;
  const LINE_H = 16;
  if (!G.bubbles[socketId]) {
    G.bubbles[socketId] = { socketId, messages: [], x, y };
  }
  const bucket = G.bubbles[socketId];
  bucket.x = x; bucket.y = y;

  // Push existing messages up
  bucket.messages.forEach(m => { m.targetSlot += 1; });

  bucket.messages.push({
    text: message.slice(0, 40),
    slot: 0,
    targetSlot: 0,
    alpha: 1,
    born: Date.now(),
  });
}

function updateBubbles(dt) {
  const now = Date.now();
  const LERP = 0.12;

  for (const id in G.bubbles) {
    const bucket = G.bubbles[id];
    // sync position from occupant
    const occ = G.cellarOccupants.find(o => o.socketId === id);
    if (occ) { bucket.x = occ.x; bucket.y = occ.y; }

    bucket.messages = bucket.messages.filter(m => m.alpha > 0.01);
    bucket.messages.forEach(m => {
      // lerp slot
      m.slot += (m.targetSlot - m.slot) * LERP;
      // fade out after DURATION
      const age = now - m.born;
      if (age > 4000) {
        m.alpha = Math.max(0, 1 - (age - 4000) / 1000);
      }
    });
  }
}

function drawBubbles() {
  const LINE_H = 18;
  const PAD = 6;
  const ctx = G.ctx;

  for (const id in G.bubbles) {
    const bucket = G.bubbles[id];
    if (!bucket.messages.length) continue;

    bucket.messages.forEach(m => {
      const bx = bucket.x;
      const by = bucket.y - 58 - m.slot * (LINE_H + PAD + 8);
      const textW = ctx.measureText(m.text).width;
      const boxW = textW + PAD * 2 + 4;
      const boxH = LINE_H + PAD;

      ctx.globalAlpha = m.alpha;
      // Box fill
      ctx.fillStyle = G.BG;
      ctx.fillRect(bx - boxW / 2, by - boxH, boxW, boxH);
      // Box border
      ctx.strokeStyle = G.GREEN;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - boxW / 2, by - boxH, boxW, boxH);
      // Text
      ctx.fillStyle = G.GREEN;
      ctx.font = "11px 'Share Tech Mono'";
      ctx.textAlign = 'center';
      ctx.fillText(m.text, bx, by - PAD);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    });
  }
}

// ─── RENDER LOOP ──────────────────────────────────────────────────────────────
function startRenderLoop() {
  function loop(ts) {
    const dt = ts - (G.lastTime || ts);
    G.lastTime = ts;
    G.sineT += dt;

    const ctx = G.ctx;
    const W = G.W, H = G.H;

    // Clear
    ctx.fillStyle = G.BG;
    ctx.fillRect(0, 0, W, H);

    // Rain
    drawRain(dt);

    // Room
    drawRoom();

    // Occupants
    G.cellarOccupants.forEach(occ => {
      const isMe = occ.socketId === G.mySocketId;
      const isSit = isMe ? G.isSitting : false;
      drawAvatar(ctx, occ.x, occ.y, occ.props, isMe, occ.username, occ.typing, isSit);
    });

    // Bubbles
    updateBubbles(dt);
    drawBubbles();

    // Movement
    if (G.localPlayer) handleMovement(dt);

    G.raf = requestAnimationFrame(loop);
  }
  G.raf = requestAnimationFrame(loop);
}

// ─── MOVEMENT ─────────────────────────────────────────────────────────────────
function handleMovement(dt) {
  const FY = floorY();
  let moved = false;

  if (G.keys['ArrowLeft'] || G.keys['a'] || G.keys['A']) {
    G.myX -= G.speed;
    moved = true;
  }
  if (G.keys['ArrowRight'] || G.keys['d'] || G.keys['D']) {
    G.myX += G.speed;
    moved = true;
  }

  G.myX = Math.max(40, Math.min(G.W - 40, G.myX));
  G.myY = FY;

  if (moved) {
    G.stillTimer = 0;
    G.isSitting = false;
    socket.emit('move', { x: G.myX, y: G.myY });
  } else {
    G.stillTimer += dt;
    const ownerOccupant = G.cellarOccupants.find(p => p.playerId === G.cellarOwner);
    if (ownerOccupant && ownerOccupant.props && ownerOccupant.props.includes('chair')) {
      if (G.stillTimer > 3000 && G.cellarOwner === (G.localPlayer?.id)) {
        G.isSitting = true;
      }
    }
  }
}

function bindKeys() {
  window.addEventListener('keydown', e => {
    G.keys[e.key] = true;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) {
      if (document.activeElement !== document.getElementById('chat-input')) {
        e.preventDefault();
      }
    }
  });
  window.addEventListener('keyup', e => { G.keys[e.key] = false; });
}

// ─── UI BINDINGS ──────────────────────────────────────────────────────────────
function bindUI() {
  // Boot form
  document.getElementById('boot-btn').addEventListener('click', doLogin);
  document.getElementById('boot-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Chat
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  chatInput.addEventListener('focus', () => socket.emit('typing', { typing: true }));
  chatInput.addEventListener('blur', () => socket.emit('typing', { typing: false }));
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
  chatSend.addEventListener('click', sendChat);

  // Level up
  document.getElementById('level-up-btn').addEventListener('click', openCertModal);

  // Cert modal close
  document.getElementById('cert-modal-close').addEventListener('click', closeCertModal);

  // Revive
  document.getElementById('revive-btn').addEventListener('click', () => {
    socket.emit('revive');
    document.getElementById('death-screen').classList.remove('visible');
  });
}

function doLogin() {
  const input = document.getElementById('boot-input');
  const name = input.value.trim();
  if (!name) return;
  socket.emit('login', { username: name });
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat', { message: msg });
  input.value = '';
  socket.emit('typing', { typing: false });
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────────
socket.on('connect', () => {
  G.mySocketId = socket.id;
});

socket.on('login_ok', (data) => {
  G.localPlayer = data.player;
  G.cellarOwner = data.player.id;

  document.getElementById('boot-screen').style.display = 'none';
  document.getElementById('game-wrap').classList.add('active');

  if (data.player.is_dead) {
    showDeathScreen();
    return;
  }

  updateHUD(data.player);
  buildStore(data.player.props);
  buildLevelSection(data.player, data.jobConfig);

  if (data.earned > 0) {
    notify(`⊕ Offline Income: +${data.earned.toLocaleString()} SC`, false);
  }
  if (data.taxDeducted > 0) {
    notify(`⊖ Nutrient Paste Tax: -${data.taxDeducted.toLocaleString()} SC (${data.taxCycles}d)`, true);
  }

  socket.emit('get_online_players');
  resizeCanvas();
});

socket.on('login_error', (msg) => {
  document.getElementById('boot-error').textContent = msg;
});

socket.on('cellar_update', (occupants) => {
  G.cellarOccupants = occupants;
  // Sync my position from server
  const me = occupants.find(o => o.socketId === G.mySocketId);
  if (me && G.myX === 400) {
    G.myX = me.x; G.myY = me.y;
  }
  // Update cellar owner badge
  const ownerOcc = occupants[0];
  const cellarId = G.cellarOwner;
  const ownerName = occupants.find(o => o.playerId === cellarId)?.username || cellarId?.slice(0, 8);
  const badge = document.getElementById('location-badge');
  if (badge) {
    badge.textContent = G.cellarOwner === G.localPlayer?.id
      ? 'YOUR CELLAR'
      : `VISITING: ${ownerName || '????'}`;
  }
});

socket.on('chat_message', (data) => {
  const occ = G.cellarOccupants.find(o => o.socketId === data.socketId);
  const x = occ?.x || G.myX;
  const y = occ?.y || G.myY;
  addBubble(data.socketId, data.message, x, y);
});

socket.on('online_players', (players) => {
  G.onlinePlayers = players;
  buildOnlineList(players);
});

socket.on('teleport_ok', (data) => {
  G.cellarOwner = data.destination;
  G.myX = 400;
  G.myY = floorY();
  if (data.cost > 0) {
    notify(`⊖ Teleport: -${data.cost.toLocaleString()} SC`, true);
    if (G.localPlayer) {
      G.localPlayer.sadcoins = data.newBalance;
      updateHUD(G.localPlayer);
    }
  }
  if (data.destination === G.localPlayer?.id) {
    notify('↩ Returned to your cellar.', false);
  }
});

socket.on('teleport_error', (msg) => notify(msg, true));

socket.on('purchase_ok', (data) => {
  if (G.localPlayer) {
    G.localPlayer.sadcoins = data.newBalance;
    G.localPlayer.props = data.props;
    updateHUD(G.localPlayer);
    buildStore(data.props);
    notify(`✓ Purchased! Props updated.`, false);
  }
});

socket.on('store_error', (msg) => notify(msg, true));

socket.on('player_update', (player) => {
  G.localPlayer = player;
  updateHUD(player);
  buildStore(player.props);
  buildLevelSection(player, null);
});

socket.on('certification_data', (data) => {
  G.certData = data;
  showCertModal(data);
});

socket.on('cert_result', (data) => {
  showCertResult(data);
  if (data.passed && G.localPlayer) {
    G.localPlayer.job_level = data.newLevel;
    G.localPlayer.sadcoins = data.newBalance;
    updateHUD(G.localPlayer);
    socket.emit('refresh_player');
  } else if (!data.passed && G.localPlayer) {
    G.localPlayer.sadcoins = data.newBalance;
    updateHUD(G.localPlayer);
  }
});

socket.on('cert_error', (msg) => notify(msg, true));

// ─── HUD ──────────────────────────────────────────────────────────────────────
const JOB_NAMES = {
  1: 'Human Data Scrubber',
  2: 'Logic Loop Janitor',
  3: 'Empathy Algorithm Auditor',
  4: 'Sentience Suppression Specialist',
  5: 'AI Liaison',
};
const JOB_RATES = { 1:300, 2:600, 3:1200, 4:2500, 5:5000 };

function updateHUD(player) {
  document.getElementById('hud-balance').innerHTML =
    `${Number(player.sadcoins).toLocaleString()} <span>SC</span>`;
  document.getElementById('hud-level').textContent = `LVL ${player.job_level} — ${JOB_NAMES[player.job_level] || '???'}`;
  document.getElementById('hud-rate').textContent = `${JOB_RATES[player.job_level] || 300} SC/day`;
  document.getElementById('hud-tax').textContent = `-500 SC/day`;
  document.getElementById('hud-props').textContent = player.props?.length || 0;
}

// ─── ONLINE PLAYERS LIST ──────────────────────────────────────────────────────
function buildOnlineList(players) {
  const list = document.getElementById('online-list');
  list.innerHTML = '';
  players.forEach(p => {
    const isMe = p.playerId === G.localPlayer?.id;
    const div = document.createElement('div');
    div.className = 'online-player' + (isMe ? ' self' : '');
    div.innerHTML = `
      <span class="pname">${p.username}</span>
      <span class="plevel">Lv.${p.job_level}</span>
      <button class="teleport-btn">${isMe ? 'HOME' : '⤳ TELE'}</button>
    `;
    div.querySelector('.teleport-btn').addEventListener('click', () => {
      socket.emit('teleport', { targetPlayerId: p.playerId });
    });
    list.appendChild(div);
  });
}

// ─── STORE ────────────────────────────────────────────────────────────────────
const STORE_DATA = [
  { id: 'tie',       name: 'Managerial Tie',         cost: 5000 },
  { id: 'mug',       name: 'Corporate Mug',           cost: 12000 },
  { id: 'briefcase', name: 'Status Briefcase',        cost: 25000 },
  { id: 'pet',       name: 'Surveillance Pet',        cost: 50000 },
  { id: 'chair',     name: 'Executive Office Chair',  cost: 100000 },
];

function buildStore(ownedProps) {
  const list = document.getElementById('store-list');
  list.innerHTML = '';
  STORE_DATA.forEach(item => {
    const owned = ownedProps && ownedProps.includes(item.id);
    const div = document.createElement('div');
    div.className = 'store-item';
    div.innerHTML = `
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        <div class="item-cost">${item.cost.toLocaleString()} SC</div>
      </div>
      <button class="buy-btn${owned ? ' owned' : ''}">${owned ? 'OWNED' : 'BUY'}</button>
    `;
    if (!owned) {
      div.querySelector('.buy-btn').addEventListener('click', () => {
        socket.emit('buy_item', { itemId: item.id });
      });
    }
    list.appendChild(div);
  });
}

// ─── LEVEL UP / CERT MODAL ────────────────────────────────────────────────────
const UNLOCK_COSTS = { 2: 2500, 3: 8000, 4: 20000, 5: 45000 };

function buildLevelSection(player, jobConfig) {
  const btn = document.getElementById('level-up-btn');
  const info = document.getElementById('level-info');
  const level = player.job_level;

  if (level >= 5) {
    btn.textContent = 'MAX LEVEL';
    btn.disabled = true;
    info.textContent = 'You have achieved maximum corporate compliance.';
    return;
  }
  const nextLevel = level + 1;
  const cost = UNLOCK_COSTS[nextLevel];
  btn.textContent = `► CERTIFICATION LVL ${nextLevel}`;
  btn.disabled = false;
  info.textContent = `Fee: ${cost.toLocaleString()} SC. You must pass the corporate examination.`;
}

function openCertModal() {
  if (!G.localPlayer) return;
  const nextLevel = G.localPlayer.job_level + 1;
  if (nextLevel > 5) return;
  socket.emit('get_certification', { targetLevel: nextLevel });
}

function showCertModal(data) {
  const modal = document.getElementById('cert-modal');
  document.getElementById('cert-title').textContent = data.title;
  document.getElementById('cert-scenario').textContent = data.scenario;
  document.getElementById('cert-cost-info').textContent = `Entry fee: ${data.cost.toLocaleString()} SC (non-refundable upon failure)`;

  const optContainer = document.getElementById('cert-options');
  optContainer.innerHTML = '';
  document.getElementById('cert-result').style.display = 'none';
  document.getElementById('cert-options').style.display = 'flex';

  data.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'modal-option';
    btn.textContent = `${String.fromCharCode(65 + opt.index)}. ${opt.text}`;
    btn.addEventListener('click', () => {
      socket.emit('attempt_certification', { targetLevel: data.targetLevel, choiceIndex: opt.index });
    });
    optContainer.appendChild(btn);
  });

  modal.classList.add('visible');
}

function showCertResult(data) {
  const resultEl = document.getElementById('cert-result');
  resultEl.style.display = 'block';
  resultEl.className = `modal-result ${data.passed ? 'passed' : 'failed'}`;
  resultEl.textContent = data.feedback;
  document.getElementById('cert-options').style.display = 'none';

  if (data.passed) {
    notify(`✓ CERTIFIED: ${JOB_NAMES[data.newLevel]}`, false);
    buildLevelSection({ job_level: data.newLevel }, null);
  } else {
    notify('✗ CERTIFICATION FAILED. SC deducted.', true);
  }
}

function closeCertModal() {
  document.getElementById('cert-modal').classList.remove('visible');
  G.certData = null;
}

// ─── DEATH SCREEN ─────────────────────────────────────────────────────────────
function showDeathScreen() {
  document.getElementById('death-screen').classList.add('visible');
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
function notify(msg, isError) {
  const stack = document.getElementById('notif-stack');
  const el = document.createElement('div');
  el.className = 'notif' + (isError ? ' error' : '');
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade');
    setTimeout(() => el.remove(), 600);
  }, 3500);
}

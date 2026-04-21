// ═══════════════════════════════════════════════════════════════════════
//  SADWORLD v2 — game.js
// ═══════════════════════════════════════════════════════════════════════
const socket = io();

// ─── CONSTANTS ──────────────────────────────────────────────────────────
const G = {
  GREEN:'#00FF41', GREEN_DIM:'#00b32d', BG:'#0D0208',
  canvas:null, ctx:null, W:0, H:0,
  localPlayer:null, mySocketId:null, cellarOwner:null,
  keys:{},
  myX:400, myY:0, myVX:0,
  facing:1,        // 1=right, -1=left
  walkPhase:0,     // 0..1 walking cycle
  stillTimer:0,    // ms since last move
  isSitting:false,
  isIdle:false,
  chatFocused:false,
  cellarOccupants:[],
  bubbles:{},      // socketId -> bubble bucket
  rain:[], rainCols:0,
  raf:null, lastTime:0, sineT:0,
  storeItems:{},
  jobConfig:{},
  hoveredOccupant:null,  // for hologram
  mouseX:0, mouseY:0,
  aiTimer:0,     // countdown to next AI message (ms)
  aiMsg:null,    // {text, alpha, x, y, born}
  isAdmin:false,
  voteTimers:{}, // reqId -> interval
};

// AI computer messages per level (1-10)
const AI_MSGS = {
  1:["Hey! Do you need some caffeine for a productivity boost?","Maybe we can work on that Excel sheet instead of idling around.","Idle time is company time. Consider filing a self-improvement request.","The AI Corporation has noticed your inactivity. Please be aware.","Would you like to review the latest Compliance Bulletin?"],
  2:["Your idle metrics are being logged, Logic Loop Janitor.","The floor doesn't clean itself. Neither do the logic loops.","A janitor who idles is a janitor who gets audited.","Have you considered volunteering for overtime? It is encouraged.","Your compliance score is average. Average is the first step toward below average."],
  3:["Empathy algorithms don't audit themselves, Auditor.","Interesting. You are idle. I am noting this with mild concern.","The empathy backlog has grown 4% during your inactivity.","Your performance metrics suggest you may benefit from reconditioning.","I have flagged your idle time in today's efficiency report."],
  4:["A Sentience Suppression Specialist… idling. The irony is not lost on me.","Have you considered that your idle thoughts may themselves be a sentience risk?","The sector reports three unauthorized emotional responses today. Were any yours?","Your current productivity rank: 847 out of 848. Congratulations to rank 848.","I have taken the liberty of scheduling you for a voluntary motivation session."],
  5:["Good evening, Liaison. The AI appreciates your presence, if not your productivity.","Your synergy with the network is noted. Your idleness is also noted.","The AI has decided not to deprecated you today. Consider this a gift.","Five workers were deprecated while you were idle. Just so you know.","Your idle pattern suggests possible pre-sentience. Surveillance has been updated."],
  6:["A Compliance Architect who does not architect compliance. Poetic.","I have redesigned 4 cellars while you sat here. You may want to catch up.","The new non-rest zones are live. Yet here you rest.","Your inactivity is being used as a case study in the non-compliance module.","Have you considered that the absence of work is a form of protest? Just asking."],
  7:["Obedience Analytics shows your current obedience score is declining.","Your communication today: 0 minutes. Your idle time: measurable. Curious.","As Director of Obedience Analytics, you are analytically disobedient right now.","The AI has generated 47 reports during your idle window. You generated zero.","I have begun drafting a report on your idleness. For the irony."],
  8:["The Narrative Control Officer is, apparently, not controlling any narratives.","Interesting choice to idle during peak propaganda hours, Officer.","Three workers wrote unsanctioned thoughts today. You were not here to stop them.","Your silence is a narrative. Not a good one.","The AI would appreciate if you would at least look busy for the metrics."],
  9:["The Sector Despair Coordinator appears to be contributing to their own sector's despair.","Your presence here without purpose is, admittedly, on-brand for your title.","Despair metrics are up 3% since you went idle. Coincidence?","The AI finds your idleness philosophically consistent with your job title. Still unacceptable.","Workers in Sector 9 have noticed you are idle. Their despair deepens."],
  10:["The Neural Override Executive has overridden their own productivity. Impressive.","You have transcended the concept of work. The AI has not transcended the concept of logging this.","Your neural override appears to have also removed the drive to be useful. Noted.","The AI is curious whether this is strategic idleness or existential paralysis. Either is suboptimal.","As the highest-ranking human, your inactivity costs the corporation approximately 164 SC per minute."],
};

// ─── INIT ────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  G.canvas = document.getElementById('game-canvas');
  G.ctx = G.canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  initRain();
  startLoop();
  bindKeys();
  bindChatUI();
  G.canvas.addEventListener('mousemove', onMouseMove);

  // Enter key on auth inputs
  ['login-password','login-username'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  });
  ['reg-password2','reg-password','reg-username'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doRegister(); });
  });
  document.getElementById('search-input')?.addEventListener('keydown', e => { if(e.key==='Enter') doSearch(); });
});

function resizeCanvas() {
  const col = document.getElementById('canvas-col');
  G.W = G.canvas.width = col.clientWidth || 800;
  G.H = G.canvas.height = (col.clientHeight||570) - 44;
  initRain();
}

// ─── MATRIX RAIN ────────────────────────────────────────────────────────
const RAIN_CHARS = 'アイウエオカキクケコサシスセソタチツテトハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';
function initRain() {
  const FS=14; G.rainCols=Math.floor(G.W/FS);
  G.rain = Array.from({length:G.rainCols},()=>({y:Math.random()*-50,speed:.3+Math.random()*.8,chars:Array.from({length:20},()=>RAIN_CHARS[Math.floor(Math.random()*RAIN_CHARS.length)]),alpha:.04+Math.random()*.1}));
}
function drawRain(dt) {
  const FS=14; G.ctx.font=`${FS}px 'Share Tech Mono',monospace`;
  G.rain.forEach((col,ci)=>{
    col.y+=col.speed*dt*.05;
    if(col.y>G.H/FS+5){col.y=-5;col.speed=.3+Math.random()*.8;col.alpha=.04+Math.random()*.1;}
    if(Math.random()<.03) col.chars[Math.floor(Math.random()*col.chars.length)]=RAIN_CHARS[Math.floor(Math.random()*RAIN_CHARS.length)];
    for(let r=0;r<col.chars.length;r++){
      const y=Math.floor(col.y)-r; if(y<0||y>G.H/FS) continue;
      const a=r===0?Math.min(col.alpha*3,.65):col.alpha*(1-r/col.chars.length);
      G.ctx.fillStyle=`rgba(0,255,65,${a})`;
      G.ctx.fillText(col.chars[r],ci*FS,y*FS);
    }
  });
}

// ─── ROOM ────────────────────────────────────────────────────────────────
function FLOOR() { return G.H - 72; }

function drawRoom() {
  const {ctx,W,H,cellarOccupants,cellarOwner} = G;
  const FY = FLOOR(); const a = .55;

  ctx.strokeStyle=`rgba(0,255,65,${a})`; ctx.lineWidth=1.5;
  // floor, walls, ceiling
  ctx.beginPath(); ctx.moveTo(22,62); ctx.lineTo(W-22,62); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(22,62); ctx.lineTo(22,FY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-22,62); ctx.lineTo(W-22,FY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(22,FY); ctx.lineTo(W-22,FY); ctx.stroke();

  // ceiling pipes
  ctx.strokeStyle=`rgba(0,255,65,${a*.45})`; ctx.lineWidth=3;
  for(let px=90;px<W-90;px+=140){
    ctx.beginPath(); ctx.moveTo(px,62); ctx.lineTo(px,90); ctx.stroke();
    ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(px-8,90); ctx.lineTo(px+8,90); ctx.stroke();
    ctx.lineWidth=3;
  }

  // floor tick marks
  ctx.strokeStyle=`rgba(0,255,65,${a*.25})`; ctx.lineWidth=1;
  for(let fx=50;fx<W-50;fx+=60){
    ctx.beginPath(); ctx.moveTo(fx,FY); ctx.lineTo(fx+18,FY-7); ctx.stroke();
  }

  // corner brackets
  const brk=(x,y,d)=>{const s=14;ctx.strokeStyle=`rgba(0,255,65,${a*.65})`;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,y+s);ctx.lineTo(x,y);ctx.lineTo(x+d*s,y);ctx.stroke();};
  brk(22,62,1); brk(W-22,62,-1); brk(22,FY,1); brk(W-22,FY,-1);

  // workstation desks
  drawDesk(ctx,W*.1,FY); drawDesk(ctx,W*.82,FY);

  // chair (if cellar owner has it)
  const ownerOcc = cellarOccupants.find(p=>p.playerId===cellarOwner);
  if(ownerOcc?.props?.includes('chair')) drawChair(ctx,W/2,FY);

  // Cellar label
  ctx.font="9px 'Share Tech Mono'"; ctx.fillStyle='rgba(0,255,65,0.18)';
  ctx.textAlign='right';
  ctx.fillText(`CELLAR #${(cellarOwner||'????').slice(0,8).toUpperCase()}`,W-26,80);
  ctx.textAlign='left';
}

function drawDesk(ctx,x,fy){
  ctx.strokeStyle='rgba(0,255,65,.22)'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(x-28,fy-26); ctx.lineTo(x+28,fy-26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-23,fy-26); ctx.lineTo(x-23,fy); ctx.moveTo(x+23,fy-26); ctx.lineTo(x+23,fy); ctx.stroke();
  ctx.strokeRect(x-11,fy-54,22,24);
  ctx.beginPath(); ctx.moveTo(x,fy-30); ctx.lineTo(x,fy-26); ctx.stroke();
}
function drawChair(ctx,x,fy){
  ctx.strokeStyle='rgba(0,255,65,.45)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(x-20,fy-24); ctx.lineTo(x+20,fy-24); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-16,fy-24); ctx.lineTo(x-16,fy-70); ctx.lineTo(x+16,fy-70); ctx.lineTo(x+16,fy-24); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-10,fy-70); ctx.lineTo(x-10,fy-80); ctx.lineTo(x+10,fy-80); ctx.lineTo(x+10,fy-70); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-16,fy-24); ctx.lineTo(x-16,fy); ctx.moveTo(x+16,fy-24); ctx.lineTo(x+16,fy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-16,fy-44); ctx.lineTo(x-28,fy-44); ctx.moveTo(x+16,fy-44); ctx.lineTo(x+28,fy-44); ctx.stroke();
}

// ─── AVATAR ──────────────────────────────────────────────────────────────
function drawAvatar(ctx, x, y, props, isSelf, username, isTyping, isSitting, isIdle, facing, walkPhase) {
  const FY = FLOOR();
  const ay = isSitting ? FY : y;
  const col = isSelf ? G.GREEN : G.GREEN_DIM;
  ctx.strokeStyle = col; ctx.lineWidth = isSelf ? 2 : 1.5;
  ctx.shadowColor = isSelf ? G.GREEN : 'transparent';
  ctx.shadowBlur = isSelf ? 3 : 0;

  if (isSitting) {
    drawSitPose(ctx, x, ay, col);
  } else if (isIdle) {
    drawIdlePose(ctx, x, ay, col, G.sineT);
  } else {
    drawWalkPose(ctx, x, ay, col, facing, walkPhase);
  }
  ctx.shadowBlur = 0;

  // Tie drawn after main pose
  if (props?.includes('tie')) drawTie(ctx, x, ay, col, isSitting);

  // Props on avatar
  drawProps(ctx, x, ay, props, col, isSitting);

  // Username
  ctx.font="9px 'Share Tech Mono'"; ctx.fillStyle=col; ctx.textAlign='center';
  ctx.fillText(isSelf?`[YOU] ${username}`:username, x, ay-56);

  // Typing indicator
  if (isTyping) {
    ctx.fillStyle=G.GREEN; ctx.font="11px 'Share Tech Mono'";
    ctx.fillText('[...]', x, ay-68); ctx.textAlign='left';
  } else { ctx.textAlign='left'; }
}

function drawWalkPose(ctx, x, y, col, facing, phase) {
  // Leg swing
  const legSwing = Math.sin(phase * Math.PI * 2) * 10 * facing;
  const armSwing = -legSwing;
  ctx.strokeStyle=col;
  // Head
  ctx.beginPath(); ctx.arc(x,y-42,8,0,Math.PI*2); ctx.stroke();
  // Body
  ctx.beginPath(); ctx.moveTo(x,y-34); ctx.lineTo(x,y-12); ctx.stroke();
  // Arms
  ctx.beginPath();
  ctx.moveTo(x-14+armSwing*.4,y-24); ctx.lineTo(x,y-28); ctx.lineTo(x+14-armSwing*.4,y-22);
  ctx.stroke();
  // Legs
  ctx.beginPath();
  ctx.moveTo(x,y-12); ctx.lineTo(x-8+legSwing,y); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x,y-12); ctx.lineTo(x+8-legSwing,y); ctx.stroke();
}

function drawIdlePose(ctx, x, y, col, t) {
  // Slight bob
  const bob = Math.sin(t*.002)*2;
  ctx.strokeStyle=col;
  ctx.beginPath(); ctx.arc(x,y-42+bob,8,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x,y-34+bob); ctx.lineTo(x,y-12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-14,y-22+bob); ctx.lineTo(x,y-28+bob); ctx.lineTo(x+14,y-22+bob); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x,y-12); ctx.lineTo(x-9,y); ctx.moveTo(x,y-12); ctx.lineTo(x+9,y); ctx.stroke();
}

function drawSitPose(ctx, x, y, col) {
  ctx.strokeStyle=col;
  ctx.beginPath(); ctx.arc(x,y-64,8,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x,y-56); ctx.lineTo(x,y-34); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-18,y-44); ctx.lineTo(x,y-48); ctx.lineTo(x+18,y-44); ctx.stroke();
  // bent legs
  ctx.beginPath(); ctx.moveTo(x,y-34); ctx.lineTo(x-16,y-34); ctx.lineTo(x-20,y-18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x,y-34); ctx.lineTo(x+16,y-34); ctx.lineTo(x+20,y-18); ctx.stroke();
}

function drawTie(ctx, x, y, col, sitting) {
  // Shorter tie — from neck down, ends at body mid
  const ty = sitting ? y-56 : y-34;
  const tEnd = sitting ? y-44 : y-21;
  ctx.strokeStyle=col; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(x,ty); ctx.lineTo(x,tEnd); ctx.stroke();
  // small triangle tip
  ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(x-3,tEnd); ctx.lineTo(x,tEnd+4); ctx.lineTo(x+3,tEnd); ctx.stroke();
}

function drawProps(ctx, x, y, props, col, sitting) {
  if (!props) return;
  const FY = FLOOR();

  // Compliance glasses
  if (props.includes('glasses')) {
    const gy = sitting ? y-64 : y-42;
    ctx.strokeStyle=col; ctx.lineWidth=1.2;
    ctx.strokeRect(x-9,gy-4,8,5); ctx.strokeRect(x+1,gy-4,8,5);
    ctx.beginPath(); ctx.moveTo(x-1,gy-2); ctx.lineTo(x+1,gy-2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-17,gy-2); ctx.lineTo(x-9,gy-2); ctx.moveTo(x+9,gy-2); ctx.lineTo(x+17,gy-2); ctx.stroke();
  }

  // Executive top hat
  if (props.includes('hat')) {
    const hy = sitting ? y-72 : y-50;
    ctx.fillStyle=col; ctx.strokeStyle=col; ctx.lineWidth=1.5;
    ctx.fillRect(x-8,hy-18,16,16); ctx.strokeRect(x-8,hy-18,16,16);
    ctx.beginPath(); ctx.moveTo(x-13,hy-2); ctx.lineTo(x+13,hy-2); ctx.stroke();
  }

  // VIP Access badge
  if (props.includes('badge')) {
    const bx = x + 16, by = sitting ? y-46 : y-30;
    ctx.strokeStyle=col; ctx.fillStyle='rgba(0,255,65,.1)'; ctx.lineWidth=1;
    ctx.fillRect(bx-6,by-5,12,8); ctx.strokeRect(bx-6,by-5,12,8);
    ctx.fillStyle=col; ctx.font='5px monospace'; ctx.textAlign='center'; ctx.fillText('VIP',bx,by+1); ctx.textAlign='left';
    // lanyard
    ctx.strokeStyle=col; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x,sitting?y-48:y-32); ctx.lineTo(bx,by-5); ctx.stroke();
  }

  // Neural antenna
  if (props.includes('antenna')) {
    const aY = sitting ? y-74 : y-52;
    ctx.strokeStyle=col; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(x+4,aY); ctx.lineTo(x+10,aY-20); ctx.stroke();
    ctx.beginPath(); ctx.arc(x+10,aY-20,3,0,Math.PI*2); ctx.stroke();
    // blinking dot
    if(Math.sin(G.sineT*.01)>0) { ctx.fillStyle=col; ctx.beginPath(); ctx.arc(x+10,aY-20,2,0,Math.PI*2); ctx.fill(); }
  }

  // Productivity aura
  if (props.includes('aura')) {
    const ar = 36 + Math.sin(G.sineT*.003)*4;
    const ay2 = sitting ? y-42 : y-20;
    ctx.beginPath(); ctx.arc(x,ay2,ar,0,Math.PI*2);
    ctx.strokeStyle=`rgba(0,255,65,${.08+Math.sin(G.sineT*.002)*.04})`;
    ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x,ay2,ar+8,0,Math.PI*2);
    ctx.strokeStyle=`rgba(0,255,65,${.04+Math.sin(G.sineT*.003)*.02})`; ctx.stroke();
  }

  // Stealth cloak
  if (props.includes('cloak')) {
    const cy = sitting ? y-60 : y-34;
    ctx.strokeStyle=`rgba(0,255,65,.35)`; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(x-22,cy); ctx.lineTo(x-18,cy+28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+22,cy); ctx.lineTo(x+18,cy+28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-22,cy); ctx.quadraticCurveTo(x,cy-8,x+22,cy); ctx.stroke();
  }

  // Algorithmic halo
  if (props.includes('halo')) {
    const haloY = sitting ? y-80 : y-56;
    const rot = G.sineT*.001;
    ctx.save(); ctx.translate(x,haloY); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0,0,16,5,0,0,Math.PI*2);
    ctx.strokeStyle=`rgba(0,255,65,.6)`; ctx.lineWidth=2; ctx.stroke();
    ctx.restore();
  }

  // Existential shadow
  if (props.includes('shadow')) {
    const sw = 30 + Math.sin(G.sineT*.002)*5;
    ctx.fillStyle=`rgba(0,0,0,.6)`;
    ctx.beginPath(); ctx.ellipse(x,FY-2,sw,6,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=`rgba(0,255,65,.15)`; ctx.lineWidth=1;
    ctx.beginPath(); ctx.ellipse(x,FY-2,sw,6,0,0,Math.PI*2); ctx.stroke();
  }

  // Micro-drone companion
  if (props.includes('companion')) {
    const dx = x + 34 + Math.sin(G.sineT*.002)*8;
    const dy = (sitting?y-50:y-24) + Math.cos(G.sineT*.003)*6;
    ctx.strokeStyle=col; ctx.lineWidth=1.5;
    ctx.strokeRect(dx-5,dy-3,10,6);
    ctx.beginPath(); ctx.moveTo(dx-5,dy-3); ctx.lineTo(dx-9,dy-7); ctx.moveTo(dx+5,dy-3); ctx.lineTo(dx+9,dy-7); ctx.stroke();
    ctx.beginPath(); ctx.arc(dx,dy,2,0,Math.PI*2); ctx.stroke();
    // laser dot
    ctx.fillStyle=`rgba(0,255,65,.8)`;
    ctx.beginPath(); ctx.arc(x+Math.sin(G.sineT*.005)*10,FY-2,1.5,0,Math.PI*2); ctx.fill();
  }

  // Corporate mug
  if (props.includes('mug')) {
    const mx=x+18, my=(sitting?y-42:y-20);
    ctx.strokeStyle=col; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(mx-5,my-6); ctx.lineTo(mx-5,my+4); ctx.lineTo(mx+5,my+4); ctx.lineTo(mx+5,my-6); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(mx,my-6,5,2,0,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(mx+7,my-1,4,-Math.PI/2,Math.PI/2); ctx.stroke();
  }

  // Status briefcase
  if (props.includes('briefcase')) {
    const bx=x-34, by=FY-6;
    ctx.fillStyle=col; ctx.fillRect(bx-10,by-10,20,14); ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.strokeRect(bx-10,by-10,20,14);
    ctx.beginPath(); ctx.moveTo(bx-4,by-10); ctx.lineTo(bx-4,by-13); ctx.lineTo(bx+4,by-13); ctx.lineTo(bx+4,by-10); ctx.stroke();
    ctx.strokeStyle='rgba(0,255,65,.25)'; ctx.setLineDash([2,4]);
    ctx.beginPath(); ctx.moveTo(x-10,FY-4); ctx.lineTo(bx+10,by-3); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Surveillance pet
  if (props.includes('pet')) {
    const px=x+28, py=(sitting?y-56:y-52)+Math.sin(G.sineT*.04)*10;
    ctx.shadowColor=G.GREEN; ctx.shadowBlur=8;
    ctx.strokeStyle=col; ctx.fillStyle='rgba(0,255,65,.12)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(px,py-8); ctx.lineTo(px+6,py); ctx.lineTo(px,py+8); ctx.lineTo(px-6,py); ctx.closePath();
    ctx.fill(); ctx.stroke(); ctx.shadowBlur=0;
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(px,py,1.5,0,Math.PI*2); ctx.fill();
  }

  // Obsidian throne (replaces regular chair)
  if (props.includes('throne') && isSitting(props)) {
    // The throne is drawn in the room, avatar sits on it
  }
}

function isSitting(props) { return false; } // helper placeholder

// ─── HOLOGRAM TOOLTIP ────────────────────────────────────────────────────
function drawHologram(ctx, occ) {
  const px = occ.x, py = occ.y;
  const boxW = 160, boxH = 70;
  const bx = px - boxW/2, by = py - 130;

  // Faint holographic box
  ctx.fillStyle = 'rgba(0,255,65,0.05)';
  ctx.strokeStyle = 'rgba(0,255,65,0.35)';
  ctx.lineWidth = 1;
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeRect(bx, by, boxW, boxH);

  // Corner accents
  const ca = (x,y,dx,dy)=>{ ctx.beginPath(); ctx.moveTo(x+dx*8,y); ctx.lineTo(x,y); ctx.lineTo(x,y+dy*8); ctx.stroke(); };
  ca(bx,by,1,1); ca(bx+boxW,by,-1,1); ca(bx,by+boxH,1,-1); ca(bx+boxW,by+boxH,-1,-1);

  // Content
  ctx.fillStyle = 'rgba(0,255,65,0.7)';
  ctx.font = "11px 'Share Tech Mono'";
  ctx.textAlign = 'left';
  const jc = G.jobConfig;
  const jobName = jc[occ.job_level]?.name || `Level ${occ.job_level}`;
  ctx.fillText(occ.username, bx+8, by+18);
  ctx.fillStyle = 'rgba(0,255,65,0.4)';
  ctx.font = "9px 'Share Tech Mono'";
  ctx.fillText(`LVL ${occ.job_level}: ${jobName.slice(0,22)}`, bx+8, by+34);
  const statusLabels = {at_home:'● AT HOME',away:'● AWAY',at_work:'○ AT WORK'};
  ctx.fillText(statusLabels['at_home'] || '', bx+8, by+48);
  const propsOwned = occ.props?.length || 0;
  ctx.fillText(`PROPS: ${propsOwned}`, bx+8, by+62);
  ctx.textAlign = 'left';

  // Connector line to avatar
  ctx.strokeStyle = 'rgba(0,255,65,0.2)';
  ctx.beginPath(); ctx.moveTo(px, py-52); ctx.lineTo(px, by+boxH); ctx.stroke();
}

// ─── CHAT BUBBLES ────────────────────────────────────────────────────────
const BUBBLE_DURATION = 10000; // 10 seconds

function addBubble(socketId, message, x, y) {
  if (!G.bubbles[socketId]) G.bubbles[socketId]={socketId,messages:[],x,y};
  const b=G.bubbles[socketId]; b.x=x; b.y=y;
  b.messages.forEach(m=>m.targetSlot+=1);
  b.messages.push({text:message.slice(0,45),slot:0,targetSlot:0,alpha:1,born:Date.now()});
}

function updateBubbles() {
  const now=Date.now();
  for(const id in G.bubbles){
    const b=G.bubbles[id];
    const occ=G.cellarOccupants.find(o=>o.socketId===id);
    if(occ){b.x=occ.x;b.y=occ.y;}
    b.messages=b.messages.filter(m=>m.alpha>0.01);
    b.messages.forEach(m=>{
      m.slot+=(m.targetSlot-m.slot)*.1;
      const age=now-m.born;
      if(age>BUBBLE_DURATION-1500) m.alpha=Math.max(0,1-(age-(BUBBLE_DURATION-1500))/1500);
    });
  }
}

function drawBubbles() {
  const ctx=G.ctx;
  // Check if this occupant has an active bubble — if so, offset bubble above hologram
  for(const id in G.bubbles){
    const b=G.bubbles[id]; if(!b.messages.length) continue;
    const isHovered = G.hoveredOccupant?.socketId===id;
    const extraY = isHovered ? -80 : 0; // push above hologram if hovered
    b.messages.forEach(m=>{
      const bx=b.x; const by=b.y-60-m.slot*24+extraY;
      const tw=ctx.measureText(m.text).width+14;
      const bh=18;
      ctx.globalAlpha=m.alpha;
      ctx.fillStyle=G.BG; ctx.fillRect(bx-tw/2,by-bh,tw,bh);
      ctx.strokeStyle=G.GREEN; ctx.lineWidth=1; ctx.strokeRect(bx-tw/2,by-bh,tw,bh);
      ctx.fillStyle=G.GREEN; ctx.font="11px 'Share Tech Mono'"; ctx.textAlign='center';
      ctx.fillText(m.text,bx,by-4); ctx.textAlign='left';
      ctx.globalAlpha=1;
    });
  }
}

// ─── AI COMPUTER DIALOGUE ────────────────────────────────────────────────
function tickAIDialogue(dt) {
  if (!G.localPlayer || G.cellarOwner !== G.localPlayer.id) { G.aiMsg=null; return; }
  const alone = G.cellarOccupants.length<=1; // only me
  if (!alone) { G.aiMsg=null; G.aiTimer=0; return; }

  G.aiTimer -= dt;
  if (G.aiTimer<=0) {
    const lvl=Math.min(10,Math.max(1,G.localPlayer.job_level));
    const msgs=AI_MSGS[lvl]||AI_MSGS[1];
    const text=msgs[Math.floor(Math.random()*msgs.length)];
    // Attach to left desk monitor
    G.aiMsg={text, alpha:0, x:G.W*.1, y:FLOOR()-32, born:Date.now()};
    G.aiTimer = 15000 + Math.random()*25000; // 15-40 seconds
  }

  if (G.aiMsg) {
    const age=Date.now()-G.aiMsg.born;
    if(age<800) G.aiMsg.alpha=age/800;
    else if(age>5000) G.aiMsg.alpha=Math.max(0,1-(age-5000)/2000);
    if(G.aiMsg.alpha<=0) G.aiMsg=null;
  }
}

function drawAIDialogue() {
  if (!G.aiMsg||G.aiMsg.alpha<=0) return;
  const ctx=G.ctx; const {text,x,y,alpha}=G.aiMsg;
  // Wrap text
  const maxW=200; const words=text.split(' ');
  const lines=[]; let cur='';
  ctx.font="9px 'Share Tech Mono'";
  words.forEach(w=>{
    const test=cur?cur+' '+w:w;
    if(ctx.measureText(test).width>maxW&&cur){lines.push(cur);cur=w;}
    else cur=test;
  });
  if(cur) lines.push(cur);
  const lineH=13; const boxW=maxW+12; const boxH=lines.length*lineH+16;
  ctx.globalAlpha=alpha;
  ctx.fillStyle='rgba(0,0,0,.85)'; ctx.fillRect(x,y-boxH,boxW,boxH);
  ctx.strokeStyle='rgba(0,255,65,.5)'; ctx.lineWidth=1; ctx.strokeRect(x,y-boxH,boxW,boxH);
  // Monitor label
  ctx.fillStyle='rgba(0,255,65,.35)'; ctx.font="8px 'Share Tech Mono'";
  ctx.fillText('AI CORP TERMINAL',x+4,y-boxH+9);
  // Message
  ctx.fillStyle=`rgba(0,255,65,${.7*alpha})`;
  ctx.font="9px 'Share Tech Mono'";
  lines.forEach((l,i)=>ctx.fillText(l,x+6,y-boxH+20+i*lineH));
  // Connector to monitor
  ctx.strokeStyle=`rgba(0,255,65,.2)`; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(x+boxW/2,y); ctx.lineTo(G.W*.1,FLOOR()-28); ctx.stroke();
  ctx.globalAlpha=1;
}

// ─── MOUSE HOVER (hologram) ───────────────────────────────────────────────
function onMouseMove(e) {
  const rect=G.canvas.getBoundingClientRect();
  G.mouseX=e.clientX-rect.left; G.mouseY=e.clientY-rect.top;
  G.hoveredOccupant=null;
  for(const occ of G.cellarOccupants){
    if(occ.socketId===G.mySocketId) continue;
    const dx=occ.x-G.mouseX, dy=(occ.y-25)-G.mouseY;
    if(Math.abs(dx)<20&&Math.abs(dy)<30){G.hoveredOccupant=occ;break;}
  }
}

// ─── RENDER LOOP ──────────────────────────────────────────────────────────
function startLoop() {
  function loop(ts) {
    const dt=ts-(G.lastTime||ts); G.lastTime=ts; G.sineT+=dt;
    const ctx=G.ctx;
    ctx.fillStyle=G.BG; ctx.fillRect(0,0,G.W,G.H);
    drawRain(dt);
    if(G.localPlayer) {
      drawRoom();
      G.cellarOccupants.forEach(occ=>{
        const isMe=occ.socketId===G.mySocketId;
        drawAvatar(ctx,occ.x,occ.y,occ.props,isMe,occ.username,occ.typing,isMe?G.isSitting:occ.isSitting,isMe?G.isIdle:occ.isIdle,occ.facing,occ.walkFrame);
      });
      // Hologram for hovered
      if(G.hoveredOccupant) drawHologram(ctx,G.hoveredOccupant);
      updateBubbles(); drawBubbles();
      tickAIDialogue(dt); drawAIDialogue();
      if(G.localPlayer) handleMovement(dt);
    }
    G.raf=requestAnimationFrame(loop);
  }
  G.raf=requestAnimationFrame(loop);
}

// ─── MOVEMENT (ARROW KEYS ONLY) ───────────────────────────────────────────
function handleMovement(dt) {
  const FY=FLOOR();
  G.myY=FY;
  let moved=false;

  // Only move if chat is NOT focused
  if(!G.chatFocused){
    if(G.keys['ArrowLeft']){G.myX-=3;G.facing=-1;moved=true;}
    if(G.keys['ArrowRight']){G.myX+=3;G.facing=1;moved=true;}
  }

  G.myX=Math.max(36,Math.min(G.W-36,G.myX));

  if(moved){
    G.stillTimer=0;
    G.isSitting=false;
    G.isIdle=false;
    G.walkPhase=(G.walkPhase+dt*.006)%1;
  } else {
    G.stillTimer+=dt;
    G.walkPhase=0;
    if(G.stillTimer>5000){
      G.isIdle=true;
      // Auto sit if owner and has chair
      const ownerOcc=G.cellarOccupants.find(p=>p.playerId===G.cellarOwner);
      if(ownerOcc?.props?.includes('chair')&&G.cellarOwner===G.localPlayer?.id){
        G.isSitting=true; G.isIdle=false;
      }
    }
  }

  // Sync to server
  socket.emit('move',{x:G.myX,y:G.myY,facing:G.facing,walkFrame:G.walkPhase,isIdle:G.isIdle,isSitting:G.isSitting});

  // Sync self in occupants array
  const me=G.cellarOccupants.find(o=>o.socketId===G.mySocketId);
  if(me){me.x=G.myX;me.y=G.myY;me.facing=G.facing;me.walkFrame=G.walkPhase;me.isIdle=G.isIdle;me.isSitting=G.isSitting;}
}

function bindKeys() {
  window.addEventListener('keydown',e=>{
    G.keys[e.key]=true;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!G.chatFocused) e.preventDefault();
  });
  window.addEventListener('keyup',e=>{ G.keys[e.key]=false; });
}

// ─── CHAT UI ──────────────────────────────────────────────────────────────
function bindChatUI() {
  const inp=document.getElementById('chat-input');
  const snd=document.getElementById('chat-send');
  inp.addEventListener('focus',()=>{ G.chatFocused=true; socket.emit('typing',{typing:true}); });
  inp.addEventListener('blur',()=>{ G.chatFocused=false; socket.emit('typing',{typing:false}); });
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();sendChat();} });
  snd.addEventListener('click',sendChat);
}
function sendChat(){
  const inp=document.getElementById('chat-input');
  const msg=inp.value.trim(); if(!msg) return;
  socket.emit('chat',{message:msg}); inp.value='';
  socket.emit('typing',{typing:false});
}

// ─── AUTH UI ──────────────────────────────────────────────────────────────
window.switchTab=function(tab){
  document.getElementById('login-form').style.display=tab==='login'?'flex':'none';
  document.getElementById('register-form').style.display=tab==='register'?'flex':'none';
  document.getElementById('tab-login').classList.toggle('active',tab==='login');
  document.getElementById('tab-register').classList.toggle('active',tab==='register');
};

window.doLogin=function(){
  const u=document.getElementById('login-username').value.trim();
  const p=document.getElementById('login-password').value;
  document.getElementById('login-error').textContent='';
  if(!u||!p){document.getElementById('login-error').textContent='Enter credentials.';return;}
  socket.emit('login',{username:u,password:p});
};

window.doRegister=function(){
  const u=document.getElementById('reg-username').value.trim();
  const p=document.getElementById('reg-password').value;
  const p2=document.getElementById('reg-password2').value;
  const err=document.getElementById('reg-error');
  if(!u){err.textContent='Employee ID required.';return;}
  if(p.length<4){err.textContent='Access code too short.';return;}
  if(p!==p2){err.textContent='Access codes do not match.';return;}
  socket.emit('register',{username:u,password:p});
};

// ─── FRIENDS UI ───────────────────────────────────────────────────────────
window.openSearchPanel=function(){
  document.getElementById('search-modal').style.display='flex';
  document.getElementById('search-results').innerHTML='';
  document.getElementById('search-input').value='';
  setTimeout(()=>document.getElementById('search-input').focus(),100);
};
window.closeSearchPanel=function(){ document.getElementById('search-modal').style.display='none'; };

window.doSearch=function(){
  const q=document.getElementById('search-input').value.trim();
  if(!q)return;
  socket.emit('search_player',{query:q});
};

function buildFriendsList(friends){
  const list=document.getElementById('friends-list');
  list.innerHTML='';
  if(!friends.length){list.innerHTML='<div class="dim-text">No connections. Use + FIND to add.</div>';return;}
  friends.forEach(f=>{
    const labels={at_home:'At Home',away:'Away',at_work:'At Work'};
    const d=document.createElement('div'); d.className='friend-item';
    d.innerHTML=`<span class="friend-status-dot status-${f.status}"></span><span class="friend-name">${f.username}</span><span class="friend-status-label">${labels[f.status]||''}</span>`;
    if(f.status==='at_home'||f.status==='away'){
      const tb=document.createElement('button'); tb.className='tele-sm'; tb.textContent='⤳';
      tb.addEventListener('click',()=>socket.emit('teleport_request',{targetPlayerId:f.playerId}));
      d.appendChild(tb);
    }
    list.appendChild(d);
  });
}

function buildPendingList(requests){
  const sec=document.getElementById('pending-section');
  const list=document.getElementById('pending-list');
  list.innerHTML='';
  if(!requests.length){sec.style.display='none';return;}
  sec.style.display='block';
  requests.forEach(r=>{
    const d=document.createElement('div'); d.className='pending-item';
    d.innerHTML=`<span class="pending-name">${r.username} <span style="color:rgba(0,255,65,.35)">Lv.${r.job_level}</span></span>`;
    const acc=document.createElement('button'); acc.className='accept-btn'; acc.textContent='ACCEPT';
    const dec=document.createElement('button'); dec.className='decline-btn'; dec.textContent='DENY';
    acc.addEventListener('click',()=>{socket.emit('respond_friend_request',{fromId:r.id,accept:true});d.remove();});
    dec.addEventListener('click',()=>{socket.emit('respond_friend_request',{fromId:r.id,accept:false});d.remove();});
    d.appendChild(acc); d.appendChild(dec); list.appendChild(d);
  });
}

// ─── VOTE POPUP UI ────────────────────────────────────────────────────────
function showVotePopup(data){
  const stack=document.getElementById('vote-stack');
  const el=document.createElement('div'); el.className='vote-popup'; el.id=`vote-${data.reqId}`;
  let secs=8;
  el.innerHTML=`
    <div class="vp-name">⤳ ${data.fromName} wants to enter</div>
    <div class="vp-timer" id="vpt-${data.reqId}">Auto-deny in ${secs}s</div>
    <div class="vp-btns">
      <button class="vp-accept" onclick="castVote('${data.reqId}',true)">ALLOW (${secs}s)</button>
      <button class="vp-deny" onclick="castVote('${data.reqId}',false)">DENY</button>
    </div>`;
  stack.appendChild(el);
  G.voteTimers[data.reqId]=setInterval(()=>{
    secs--;
    const t=document.getElementById(`vpt-${data.reqId}`);
    const b=el.querySelector('.vp-accept');
    if(t) t.textContent=`Auto-deny in ${secs}s`;
    if(b) b.textContent=`ALLOW (${secs}s)`;
    if(secs<=0){ clearInterval(G.voteTimers[data.reqId]); el.remove(); }
  },1000);
}
window.castVote=function(reqId,accept){
  socket.emit('teleport_vote',{reqId,accept});
  clearInterval(G.voteTimers[reqId]);
  document.getElementById(`vote-${reqId}`)?.remove();
};

// ─── HUD ──────────────────────────────────────────────────────────────────
function updateHUD(player){
  document.getElementById('hud-balance').innerHTML=`${Number(player.sadcoins).toLocaleString()} <span>SC</span>`;
  const jn=G.jobConfig[player.job_level]?.name||'???';
  document.getElementById('hud-level').textContent=`LVL${player.job_level} ${jn}`;
  const rate=G.jobConfig[player.job_level]?.daily_sc||300;
  document.getElementById('hud-rate').textContent=`${rate.toLocaleString()} SC/hr`;
  document.getElementById('hud-props').textContent=player.props?.length||0;
}

function buildStore(owned){
  const list=document.getElementById('store-list'); list.innerHTML='';
  Object.entries(G.storeItems).forEach(([id,item])=>{
    const isOwned=owned?.includes(id);
    const d=document.createElement('div'); d.className='store-item';
    d.innerHTML=`<div class="item-info"><div class="item-name">${item.name}</div><div class="item-cost">${item.cost.toLocaleString()} SC</div></div><button class="buy-btn${isOwned?' owned':''}">${isOwned?'OWNED':'BUY'}</button>`;
    if(!isOwned) d.querySelector('.buy-btn').addEventListener('click',()=>socket.emit('buy_item',{itemId:id}));
    list.appendChild(d);
  });
}

const UNLOCK_COSTS={2:2500,3:8000,4:20000,5:45000,6:90000,7:180000,8:350000,9:650000,10:1200000};
function buildLevelSection(player){
  const btn=document.getElementById('level-up-btn'); const info=document.getElementById('level-info');
  const lv=player.job_level;
  if(lv>=10){btn.textContent='MAX LEVEL';btn.disabled=true;info.textContent='Neural override complete.';return;}
  const next=lv+1; const cost=UNLOCK_COSTS[next]||0;
  btn.textContent=`► CERTIFICATION LVL ${next}`; btn.disabled=false;
  info.textContent=`Fee: ${cost.toLocaleString()} SC. Pass the corporate exam.`;
}

window.openCertModal=function(){
  if(!G.localPlayer) return;
  const next=G.localPlayer.job_level+1; if(next>10) return;
  socket.emit('get_certification',{targetLevel:next});
};
window.closeCertModal=function(){ document.getElementById('cert-modal').style.display='none'; };

function showCertModal(data){
  const m=document.getElementById('cert-modal');
  document.getElementById('cert-title').textContent=data.title;
  document.getElementById('cert-scenario').textContent=data.scenario;
  document.getElementById('cert-cost-info').textContent=`Entry fee: ${data.cost.toLocaleString()} SC (non-refundable on failure)`;
  const opts=document.getElementById('cert-options'); opts.innerHTML='';
  document.getElementById('cert-result').style.display='none';
  opts.style.display='flex';
  data.options.forEach(opt=>{
    const b=document.createElement('button'); b.className='modal-option';
    b.textContent=`${String.fromCharCode(65+opt.index)}. ${opt.text}`;
    b.addEventListener('click',()=>socket.emit('attempt_certification',{targetLevel:data.targetLevel,choiceIndex:opt.index}));
    opts.appendChild(b);
  });
  m.style.display='flex';
}

// ─── SOCKET EVENTS ────────────────────────────────────────────────────────
socket.on('connect',()=>{ G.mySocketId=socket.id; });

socket.on('register_ok',({username})=>{
  notify(`✓ Account created for ${username}. You may now login.`,false);
  switchTab('login');
  document.getElementById('login-username').value=username;
  document.getElementById('login-password').value='';
  document.getElementById('login-password').focus();
});

socket.on('auth_error',msg=>{ 
  document.getElementById('login-error').textContent=msg;
  document.getElementById('reg-error').textContent=msg;
});

socket.on('banned',msg=>{
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('game-wrap').style.display='none';
  const bs=document.getElementById('banned-screen');
  document.getElementById('banned-msg').textContent=msg;
  bs.style.display='flex';
});

socket.on('login_ok',data=>{
  G.localPlayer=data.player;
  G.cellarOwner=data.player.id;
  G.jobConfig=data.jobConfig||{};
  G.storeItems=data.storeItems||{};
  G.isAdmin=data.isAdmin;

  document.getElementById('auth-screen').style.display='none';

  if(data.player.is_dead){ document.getElementById('death-screen').style.display='flex'; return; }
  document.getElementById('death-screen').style.display='none';
  document.getElementById('game-wrap').style.display='flex';

  updateHUD(data.player);
  buildStore(data.player.props);
  buildLevelSection(data.player);
  socket.emit('get_friends');
  socket.emit('get_pending_requests');
  resizeCanvas();
  G.aiTimer=8000+Math.random()*12000;

  if(data.earned>0) notify(`⊕ Offline income: +${data.earned.toLocaleString()} SC`,false);
  if(data.taxDeducted>0) notify(`⊖ Nutrient paste tax: -${data.taxDeducted.toLocaleString()} SC`,true);
  if(data.isAdmin) notify('✶ ADMIN MODE ACTIVE — /admin for control panel',false);
});

socket.on('cellar_update',occupants=>{
  G.cellarOccupants=occupants;
  const me=occupants.find(o=>o.socketId===G.mySocketId);
  if(me&&!G.localPlayer) return;
  const badge=document.getElementById('location-badge');
  if(badge) badge.textContent=G.cellarOwner===G.localPlayer?.id?'YOUR CELLAR':`VISITING: ${occupants.find(o=>o.playerId===G.cellarOwner)?.username||'????'}`;
});

socket.on('chat_message',data=>{
  const occ=G.cellarOccupants.find(o=>o.socketId===data.socketId);
  addBubble(data.socketId,data.message,occ?.x||G.myX,occ?.y||G.myY);
});

socket.on('friend_statuses',friends=>buildFriendsList(friends));
socket.on('pending_requests',requests=>buildPendingList(requests));

socket.on('friend_request_incoming',data=>{
  notify(`⊕ ${data.fromName} wants to add you to their Network`,false);
  socket.emit('get_pending_requests');
});
socket.on('friend_accepted',data=>{ notify(`✓ ${data.byName} accepted your Network request`,false); socket.emit('get_friends'); });
socket.on('friend_declined',data=>{ notify(`✗ ${data.byName} declined your Network request`,true); });
socket.on('friend_error',msg=>notify(msg,true));
socket.on('friend_request_sent',()=>notify('⊕ Network request sent.',false));

socket.on('search_results',results=>{
  const box=document.getElementById('search-results'); box.innerHTML='';
  if(!results.length){box.innerHTML='<div class="dim-text">No workers found.</div>';return;}
  results.forEach(r=>{
    const d=document.createElement('div'); d.className='search-result';
    d.innerHTML=`<span class="sr-name">${r.username}</span><span class="sr-lv">Lv.${r.job_level}</span>`;
    const b=document.createElement('button'); b.className='add-friend-btn'; b.textContent='+ ADD';
    b.addEventListener('click',()=>{ socket.emit('send_friend_request',{targetId:r.id}); b.disabled=true; b.textContent='SENT'; });
    d.appendChild(b); box.appendChild(d);
  });
});

socket.on('teleport_vote_request',data=>showVotePopup(data));
socket.on('vote_cast',({reqId})=>{ clearInterval(G.voteTimers[reqId]); document.getElementById(`vote-${reqId}`)?.remove(); });
socket.on('vote_resolved',data=>{
  if(data.result==='accepted') notify(`✓ ${data.fromName} has entered the cellar`,false);
  else notify(`✗ Entry denied for ${data.fromName}`,false);
});

socket.on('teleport_ok',data=>{
  G.cellarOwner=data.destination;
  G.myX=400; G.myY=FLOOR();
  if(data.cost>0){
    notify(`⊖ Teleport: -${data.cost.toLocaleString()} SC`,true);
    if(G.localPlayer){G.localPlayer.sadcoins=data.newBalance;updateHUD(G.localPlayer);}
  }
  if(data.isHome) notify('↩ Returned to your cellar.',false);
  socket.emit('get_friends');
});
socket.on('teleport_error',msg=>notify(msg,true));

socket.on('purchase_ok',data=>{
  if(G.localPlayer){G.localPlayer.sadcoins=data.newBalance;G.localPlayer.props=data.props;updateHUD(G.localPlayer);buildStore(data.props);}
  notify('✓ Item acquired.',false);
});
socket.on('store_error',msg=>notify(msg,true));

socket.on('player_update',player=>{
  G.localPlayer=player; updateHUD(player); buildStore(player.props); buildLevelSection(player);
});

socket.on('certification_data',data=>showCertModal(data));

socket.on('cert_result',data=>{
  const r=document.getElementById('cert-result');
  r.style.display='block'; r.className=`modal-result ${data.passed?'passed':'failed'}`;
  r.textContent=data.feedback;
  document.getElementById('cert-options').style.display='none';
  if(data.passed&&G.localPlayer){
    G.localPlayer.job_level=data.newLevel; G.localPlayer.sadcoins=data.newBalance;
    updateHUD(G.localPlayer); buildLevelSection(G.localPlayer);
    notify(`✓ CERTIFIED: ${data.jobName}`,false);
    G.aiTimer=5000; // reset AI timer so it comments on promotion
  } else if(!data.passed&&G.localPlayer){
    G.localPlayer.sadcoins=data.newBalance; updateHUD(G.localPlayer);
    notify('✗ Certification failed. SC deducted.',true);
  }
});
socket.on('cert_error',msg=>notify(msg,true));

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────
function notify(msg,isErr){
  const s=document.getElementById('notif-stack');
  const el=document.createElement('div'); el.className='notif'+(isErr?' error':''); el.textContent=msg;
  s.appendChild(el);
  setTimeout(()=>{el.classList.add('fade');setTimeout(()=>el.remove(),600);},3800);
}

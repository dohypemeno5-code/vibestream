/**
 * VibeStream - Salas de Live em tempo real (WebSocket)
 * - Presença de espectadores
 * - Broadcast de frames (câmera real)
 * - Chat da live em tempo real
 * - Curtidas e presentes
 * - Anti-live fake (watchdog + frame parado)
 */
const uuid = require('uuid');

const rooms = new Map();      // liveId -> room
const userSockets = new Map(); // userId -> Set<ws>
let dbFn = null;

function init(db) { dbFn = db; }
function db() { return dbFn ? dbFn() : null; }

function send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch (e) {} }

function notifyUser(userId, notification) {
  const socks = userSockets.get(userId);
  if (!socks) return;
  for (const ws of socks) send(ws, { type: 'notification', notification });
}

function registerUser(ws, userId) {
  if (!userId) return;
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(ws);
}

function unregisterUser(ws) {
  for (const [uid, set] of userSockets) {
    if (set.delete(ws) && set.size === 0) userSockets.delete(uid);
  }
}

function broadcast(liveId, msg) {
  const room = rooms.get(liveId);
  if (!room) return;
  const str = JSON.stringify(msg);
  for (const ws of room.sockets) { try { ws.send(str); } catch (e) {} }
}

function getRoom(liveId) { return rooms.get(liveId); }
function roomCount() { return rooms.size; }

function createRoom(liveId, live) {
  if (!rooms.has(liveId)) {
    rooms.set(liveId, {
      liveId,
      live,
      sockets: new Set(),
      viewers: new Set(),
      lastFrame: null,
      lastFrameHash: null,
      repeatFrames: 0,
      lastFrameAt: 0,
      lastHeartbeatAt: Date.now(),
      createdAt: Date.now()
    });
  }
  return rooms.get(liveId);
}

function syncViewerCount(liveId) {
  const d = db();
  if (!d) return;
  try {
    d.run("UPDATE lives SET viewer_count = (SELECT COUNT(DISTINCT user_id) FROM live_viewers WHERE live_id = ? AND left_at IS NULL) WHERE id = ?", [liveId, liveId]);
  } catch (e) {}
}

function joinRoom(ws, liveId, userId, live) {
  const room = createRoom(liveId, live);
  room.sockets.add(ws);
  if (userId) {
    const isStreamer = live.user_id === userId;
    if (!isStreamer) {
      const d = db();
      if (d) {
        try {
          d.run("INSERT OR IGNORE INTO live_viewers (id, live_id, user_id, joined_at) VALUES (?, ?, ?, datetime('now'))", [uuid.v4(), liveId, userId]);
          syncViewerCount(liveId);
        } catch (e) {}
      }
      room.viewers.add(userId);
    }
  }
  broadcast(liveId, { type: 'live:viewers', liveId, count: room.sockets.size });
  return room;
}

function leaveRoom(ws, liveId) {
  const room = rooms.get(liveId);
  if (!room) return;
  room.sockets.delete(ws);
  const userId = ws.userId;
  if (userId && room.viewers.has(userId)) {
    room.viewers.delete(userId);
    const d = db();
    if (d) {
      try {
        d.run("UPDATE live_viewers SET left_at = datetime('now') WHERE live_id = ? AND user_id = ? AND left_at IS NULL", [liveId, userId]);
        syncViewerCount(liveId);
      } catch (e) {}
    }
  }
  broadcast(liveId, { type: 'live:viewers', liveId, count: room.sockets.size });
  // Se o streamer saiu, encerra a live
  if (room.live && room.live.user_id === userId) {
    endLive(liveId, 'Transmissão encerrada pelo apresentador(a)', userId);
  }
}

function leaveAll(ws) {
  for (const liveId of Array.from(rooms.keys())) {
    const room = rooms.get(liveId);
    if (room && room.sockets.has(ws)) leaveRoom(ws, liveId);
  }
  unregisterUser(ws);
}

function setFrame(liveId, data, hash) {
  const room = rooms.get(liveId);
  if (!room) return 0;
  room.lastFrame = data;
  room.lastFrameAt = Date.now();
  if (hash && hash === room.lastFrameHash) {
    room.repeatFrames += 1;
  } else {
    room.lastFrameHash = hash;
    room.repeatFrames = hash ? 1 : 0;
  }
  return room.repeatFrames;
}

function heartbeat(liveId) {
  const r = rooms.get(liveId);
  if (r) r.lastHeartbeatAt = Date.now();
}

function isStale(liveId) {
  const r = rooms.get(liveId);
  if (!r) return true;
  const lastSignal = Math.max(r.lastHeartbeatAt, r.lastFrameAt);
  return (Date.now() - lastSignal) > 120000; // 2 min sem sinal
}

function endLive(liveId, reason, endedBy) {
  const room = rooms.get(liveId);
  const d = db();
  if (d) {
    try {
      const live = d.get('SELECT user_id FROM lives WHERE id = ?', [liveId]);
      if (live) {
        d.run("UPDATE lives SET status = 'ended', ended_at = datetime('now') WHERE id = ?", [liveId]);
        d.run("UPDATE users SET is_live = 0, live_title = '' WHERE id = ?", [live.user_id]);
        if (reason) {
          d.run("INSERT INTO moderation_logs (id, action_type, target_content_id, content_type, reason, moderated_by) VALUES (?, 'live_stopped', ?, 'live', ?, ?)",
            [uuid.v4(), liveId, reason, endedBy || 'sistema']);
        }
        notifyUser(live.user_id, {
          type: 'live_ended', content_id: liveId,
          text: 'Sua live foi encerrada: ' + (reason || 'Encerrada'),
          created_at: new Date().toISOString(), is_read: 0
        });
      }
    } catch (e) {}
  }
  broadcast(liveId, { type: 'live:ended', liveId, reason: reason || '' });
  if (room) {
    for (const ws of Array.from(room.sockets)) {
      if (room.live && room.live.user_id === ws.userId) continue;
      try { ws.send(JSON.stringify({ type: 'live:ended', liveId, reason: reason || '' })); } catch (e) {}
    }
  }
  rooms.delete(liveId);
}

module.exports = {
  init, registerUser, unregisterUser, notifyUser,
  broadcast, send, getRoom, createRoom, joinRoom, leaveRoom, leaveAll,
  setFrame, heartbeat, isStale, endLive, roomCount
};

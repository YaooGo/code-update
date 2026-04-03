const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { encrypt, decrypt } = require('../crypto');

const FILE = path.join(__dirname, '../../data/servers.json');

function readServers() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function writeServers(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// GET /api/servers — list all, mask password
router.get('/', (req, res) => {
  const servers = readServers().map(s => ({
    ...s,
    password: s.password ? '••••••••' : '',
    privateKey: s.privateKey ? '[key stored]' : ''
  }));
  res.json(servers);
});

// POST /api/servers — add new server
router.post('/', (req, res) => {
  const { name, host, port, username, password, privateKey } = req.body;
  if (!name || !host || !username) {
    return res.status(400).json({ error: 'name, host, username are required' });
  }
  const servers = readServers();
  const server = {
    id: uuidv4(),
    name,
    host,
    port: port || 22,
    username,
    password: password ? encrypt(password) : '',
    privateKey: privateKey ? encrypt(privateKey) : '',
    createdAt: new Date().toISOString()
  };
  servers.push(server);
  writeServers(servers);
  res.json({ ...server, password: password ? '••••••••' : '', privateKey: privateKey ? '[key stored]' : '' });
});

// PUT /api/servers/:id — update
router.put('/:id', (req, res) => {
  const servers = readServers();
  const idx = servers.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Server not found' });

  const { name, host, port, username, password, privateKey } = req.body;
  const existing = servers[idx];
  servers[idx] = {
    ...existing,
    name: name ?? existing.name,
    host: host ?? existing.host,
    port: port ?? existing.port,
    username: username ?? existing.username,
    // Only update password/key if user typed a new real value
    password: (password && password !== '••••••••') ? encrypt(password) : existing.password,
    privateKey: (privateKey && privateKey !== '[key stored]') ? encrypt(privateKey) : existing.privateKey,
    updatedAt: new Date().toISOString()
  };
  writeServers(servers);
  res.json({ ...servers[idx], password: '••••••••', privateKey: servers[idx].privateKey ? '[key stored]' : '' });
});

// DELETE /api/servers/:id
router.delete('/:id', (req, res) => {
  const servers = readServers();
  const filtered = servers.filter(s => s.id !== req.params.id);
  if (filtered.length === servers.length) return res.status(404).json({ error: 'Server not found' });
  writeServers(filtered);
  res.json({ ok: true });
});

// POST /api/servers/test — test SSH connection
router.post('/test', (req, res) => {
  try {
    const { host, port, username, password, serverId } = req.body;
    const { Client } = require('ssh2');

    let connectOpts;
    if (serverId) {
      // Use existing server credentials
      const servers = readServers();
      const s = servers.find(x => x.id === serverId);
      if (!s) return res.status(404).json({ error: 'Server not found' });
      connectOpts = {
        host: s.host,
        port: s.port || 22,
        username: s.username,
        readyTimeout: 10000,
      };
      if (s.privateKey) {
        connectOpts.privateKey = decrypt(s.privateKey);
      } else if (s.password) {
        connectOpts.password = decrypt(s.password);
      }
    } else {
      // Use provided credentials
      if (!host || !username) return res.status(400).json({ error: 'host, username required' });
      connectOpts = { host, port: port || 22, username, readyTimeout: 10000 };
      if (password) connectOpts.password = password;
    }

    const conn = new Client();
    let replied = false;

    const timeout = setTimeout(() => {
      if (!replied) { replied = true; conn.end(); res.json({ ok: false, error: 'Connection timed out (10s)' }); }
    }, 12000);

    conn.on('ready', () => {
      conn.exec('echo ok', (err, stream) => {
        clearTimeout(timeout);
        conn.end();
        if (replied) return;
        replied = true;
        if (err) return res.json({ ok: false, error: err.message });
        res.json({ ok: true, message: `SSH connection to ${connectOpts.host}:${connectOpts.port} successful` });
      });
    });

    conn.on('error', err => {
      clearTimeout(timeout);
      if (replied) return;
      replied = true;
      res.json({ ok: false, error: err.message });
    });

    conn.connect(connectOpts);
  } catch (err) {
    console.error('[TEST CONN ERROR]', err.message);
    res.status(500).json({ ok: false, error: `Server error: ${err.message}` });
  }
});

module.exports = router;


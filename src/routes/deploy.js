const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { decrypt } = require('../crypto');
const { deploy } = require('../sshDeploy');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const SERVERS_FILE = path.join(__dirname, '../../data/servers.json');
const DEPLOYMENTS_FILE = path.join(__dirname, '../../data/deployments.json');
const HISTORY_FILE = path.join(__dirname, '../../data/deploy_history.json');
const HISTORY_MAX = 200; // Keep at most 200 records

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB max

// In-memory task store: taskId -> { status, logs, startedAt }
const tasks = new Map();

function getServer(id) {
  const servers = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
  return servers.find(s => s.id === id) || null;
}

function getDeployment(id) {
  const deps = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf8'));
  return deps.find(d => d.id === id) || null;
}

function saveHistory(record) {
  try {
    let history = [];
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
    history.push(record);
    // Keep only the last HISTORY_MAX records
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) {
    console.error('[history] Failed to save deploy history:', e.message);
  }
}

// POST /api/deploy — start a deployment
router.post('/', upload.single('file'), async (req, res) => {
  const { deploymentId } = req.body;
  if (!deploymentId) return res.status(400).json({ error: 'deploymentId is required' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const config = getDeployment(deploymentId);
  if (!config) return res.status(404).json({ error: 'Deployment config not found' });

  const server = getServer(config.serverId);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const taskId = uuidv4();
  const localFile = req.file.path;
  const originalName = req.file.originalname;

  // Decrypt credentials
  const decryptedServer = {
    ...server,
    password: server.password ? decrypt(server.password) : '',
    privateKey: server.privateKey ? decrypt(server.privateKey) : ''
  };

  // Initialize task
  tasks.set(taskId, {
    status: 'running',
    logs: [],
    startedAt: new Date().toISOString(),
    deploymentName: config.name,
    serverName: server.name,
    fileName: originalName,
    cancel: null,  // set once SSH connects
  });

  // Run deployment asynchronously
  (async () => {
    const task = tasks.get(taskId);
    const log = (line) => {
      task.logs.push({ time: new Date().toISOString(), line });
    };

    try {
      await deploy({
        server: decryptedServer, config, localFile, originalName, log,
        onCancel: (fn) => { task.cancel = fn; },
      });
      if (task.status !== 'cancelled') task.status = 'success';
    } catch (err) {
      if (task.status !== 'cancelled') {
        log(`[ERROR] ${err.message}`);
        task.status = 'failed';
      }
    } finally {
      task.cancel = null;
      // Clean up uploaded file
      try { fs.unlinkSync(localFile); } catch {}

      // Persist to history
      saveHistory({
        id: taskId,
        status: task.status,
        deploymentId: config.id,
        deploymentName: config.name,
        serverId: server.id,
        serverName: server.name,
        fileName: originalName,
        startedAt: task.startedAt,
        finishedAt: new Date().toISOString(),
        logs: task.logs,
      });
    }
  })();

  res.json({ taskId });
});


// GET /api/deploy/:taskId/logs — SSE stream
router.get('/:taskId/logs', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let sent = 0;

  function flush() {
    const task = tasks.get(taskId);
    if (!task) return;

    // Send any new log lines
    while (sent < task.logs.length) {
      const entry = task.logs[sent];
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
      sent++;
    }

    // If finished, send done event and close
    if (task.status !== 'running') {
      res.write(`event: done\ndata: ${JSON.stringify({ status: task.status })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }

  const interval = setInterval(flush, 200);
  flush();

  req.on('close', () => clearInterval(interval));
});

// POST /api/deploy/:taskId/cancel
router.post('/:taskId/cancel', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'running') return res.status(400).json({ error: 'Task is not running' });
  task.status = 'cancelled';
  task.logs.push({ time: new Date().toISOString(), line: '[WARN] Deployment cancelled by user.' });
  if (task.cancel) task.cancel();  // disconnect SSH
  res.json({ ok: true });
});

// GET /api/deploy/:taskId — get task status
router.get('/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ status: task.status, logCount: task.logs.length, startedAt: task.startedAt });
});

module.exports = router;


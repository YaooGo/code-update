const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../../data/deploy_history.json');

function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

// GET /api/history?limit=50
router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const all = readHistory();
  // Return most recent first
  const result = all.slice(-limit).reverse();
  res.json(result);
});

// GET /api/history/stats
router.get('/stats', (req, res) => {
  const all = readHistory();
  const total = all.length;
  const success = all.filter(r => r.status === 'success').length;
  const failed = all.filter(r => r.status === 'failed').length;
  const running = all.filter(r => r.status === 'running').length;
  res.json({ total, success, failed, running });
});

// GET /api/history/:id/logs — return full log lines for a past deployment
router.get('/:id/logs', (req, res) => {
  const all = readHistory();
  const record = all.find(r => r.id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  res.json({ logs: record.logs || [], status: record.status });
});

// DELETE /api/history — clear all history
router.delete('/', (req, res) => {
  fs.writeFileSync(FILE, '[]');
  res.json({ ok: true });
});

module.exports = router;
module.exports.FILE = FILE;

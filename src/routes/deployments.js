const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const FILE = path.join(__dirname, '../../data/deployments.json');

function readDeployments() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function writeDeployments(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// GET /api/deployments
router.get('/', (req, res) => {
  res.json(readDeployments());
});

// POST /api/deployments
router.post('/', (req, res) => {
  const {
    name, serverId, remoteUploadDir,
    deployType,
    binaryName,
    backupEnabled, backupDir,
    innerFolder, targetDir, serviceRestart,
    preCommands, postCommands
  } = req.body;

  if (!name || !serverId || !remoteUploadDir) {
    return res.status(400).json({ error: 'name, serverId, remoteUploadDir are required' });
  }

  const dep = {
    id: uuidv4(),
    name,
    serverId,
    remoteUploadDir,
    deployType: deployType || 'frontend',  // 'frontend' | 'binary'
    binaryName: binaryName || '',
    backupEnabled: backupEnabled !== false,
    backupDir: backupDir || '',
    innerFolder: innerFolder || '',
    targetDir: targetDir || '',
    serviceRestart: serviceRestart || '',
    preCommands: preCommands || '',
    postCommands: postCommands || '',
    createdAt: new Date().toISOString()
  };

  const deps = readDeployments();
  deps.push(dep);
  writeDeployments(deps);
  res.json(dep);
});


// PUT /api/deployments/:id
router.put('/:id', (req, res) => {
  const deps = readDeployments();
  const idx = deps.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Deployment not found' });

  deps[idx] = { ...deps[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  writeDeployments(deps);
  res.json(deps[idx]);
});

// DELETE /api/deployments/:id
router.delete('/:id', (req, res) => {
  const deps = readDeployments();
  const filtered = deps.filter(d => d.id !== req.params.id);
  if (filtered.length === deps.length) return res.status(404).json({ error: 'Deployment not found' });
  writeDeployments(filtered);
  res.json({ ok: true });
});

module.exports = router;

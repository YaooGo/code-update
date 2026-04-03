const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data and uploads directories exist
['data', 'uploads'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// Ensure data files exist
const serversFile = path.join(__dirname, 'data', 'servers.json');
const deploymentsFile = path.join(__dirname, 'data', 'deployments.json');
const historyFile = path.join(__dirname, 'data', 'deploy_history.json');
if (!fs.existsSync(serversFile)) fs.writeFileSync(serversFile, '[]');
if (!fs.existsSync(deploymentsFile)) fs.writeFileSync(deploymentsFile, '[]');
if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, '[]');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/servers', require('./src/routes/servers'));
app.use('/api/deployments', require('./src/routes/deployments'));
app.use('/api/deploy', require('./src/routes/deploy'));
app.use('/api/history', require('./src/routes/history'));

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global JSON error handler — catches multer errors, route errors, etc.
// On Windows, without this middleware, errors return HTML which the frontend can't parse.
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack || err.message);
  const status = err.status || 500;
  const message = err.code === 'LIMIT_FILE_SIZE'
    ? 'File too large (max 500MB)'
    : err.message || 'Internal server error';
  res.status(status).json({ error: message });
});

// Process-level error handlers for diagnostics
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.stack || err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err.stack || err.message);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Code Update Tool running at http://localhost:${PORT}\n`);
});

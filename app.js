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

app.listen(PORT, () => {
  console.log(`\n🚀 Code Update Tool running at http://localhost:${PORT}\n`);
});

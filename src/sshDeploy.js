const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

/**
 * Deploy a file to a remote server via SSH/SCP.
 * @param {object} opts
 * @param {object} opts.server      - { host, port, username, password, privateKey }
 * @param {object} opts.config      - deployment config object
 * @param {string} opts.localFile   - absolute path to local archive file
 * @param {string} opts.originalName - original filename (e.g. dist.zip, app.tar.gz)
 * @param {function} opts.log       - log(line) callback for streaming
 */
function deploy({ server, config, localFile, originalName, log, onCancel }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    // For binary deploys: upload to a temp file first, then mv to final location.
    // This avoids the Linux restriction of overwriting a running executable via SFTP.
    const remoteArchivePath = (config.deployType === 'binary')
      ? path.posix.join(config.remoteUploadDir, `${originalName}.upload_tmp`)
      : path.posix.join(config.remoteUploadDir, originalName);

    log(`[INFO] Connecting to ${server.host}:${server.port || 22} as ${server.username}...`);

    conn.on('ready', () => {
      log(`[INFO] SSH connected.`);

      // Register cancel handler — lets caller disconnect SSH mid-deploy
      if (onCancel) onCancel(() => {
        log(`[WARN] Cancelling: closing SSH connection.`);
        conn.end();
      });


      scpUpload(conn, localFile, remoteArchivePath, log)
        .then(() => {
          const cmds = buildCommands(config, remoteArchivePath, originalName);
          return runCommands(conn, cmds, log);
        })
        .then(() => {
          log(`[SUCCESS] Deployment completed successfully!`);
          conn.end();
          resolve();
        })
        .catch(err => {
          log(`[ERROR] ${err.message}`);
          conn.end();
          reject(err);
        });
    });

    conn.on('error', err => {
      log(`[ERROR] SSH connection failed: ${err.message}`);
      reject(err);
    });

    const connectOpts = {
      host: server.host,
      port: server.port || 22,
      username: server.username,
      readyTimeout: 20000,          // 20s 连接超时
      keepaliveInterval: 10000,     // 每 10s 发送 keepalive
      keepaliveCountMax: 6,         // 最多 6 次无响应后断开
    };

    if (server.privateKey) {
      connectOpts.privateKey = server.privateKey;
    } else {
      connectOpts.password = server.password;
    }

    conn.connect(connectOpts);
  });
}

/**
 * SCP upload via SSH2 SFTP subsystem.
 * Ensures remote directory exists, shows ls output, then uploads via fastPut.
 */
function scpUpload(conn, localFile, remotePath, log) {
  const remoteDir = path.posix.dirname(remotePath);

  return new Promise((resolve, reject) => {
    // Step 1: mkdir -p + ls -la in one exec (single SSH channel)
    log(`[INFO] Ensuring remote directory: ${remoteDir}`);
    const setupCmd = `mkdir -p "${remoteDir}" && echo "--- ls ---" && ls -la "${remoteDir}"`;

    conn.exec(setupCmd, (err, stream) => {
      if (err) return reject(new Error(`Setup failed: ${err.message}`));

      let out = '';
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { out += d.toString(); });

      stream.on('close', code => {
        // Log directory listing
        out.trimEnd().split('\n').forEach(line => {
          if (line.startsWith('--- ls ---')) {
            log(`[INFO] Remote directory listing (${remoteDir}):`);
          } else if (line) {
            log(`[OUT] ${line}`);
          }
        });

        if (code !== 0) {
          return reject(new Error(`mkdir -p failed (exit ${code}): ${out.trim()}`));
        }

        log(`[INFO] Directory confirmed. Starting upload...`);

        // Step 2: open SFTP and upload — defer with setImmediate so we're
        // not inside the exec close callback (avoids ssh2 channel ordering issues)
        setImmediate(() => doSftpUpload(conn, localFile, remotePath, log, resolve, reject));
      });
    });
  });
}

function doSftpUpload(conn, localFile, remotePath, log, resolve, reject) {
  log(`[INFO] Uploading ${path.basename(localFile)} → ${remotePath}`);

  conn.sftp((err, sftp) => {
    if (err) return reject(new Error(`SFTP error: ${err.message}`));

    let lastPct = -1;

    sftp.fastPut(localFile, remotePath, {
      concurrency: 1,
      chunkSize: 32768,
      step: (transferred, _chunk, total) => {
        const pct = Math.floor((transferred / total) * 100);
        if (pct % 10 === 0 && pct !== lastPct) {
          log(`[UPLOAD] ${pct}% (${formatBytes(transferred)} / ${formatBytes(total)})`);
          lastPct = pct;
        }
      },
    }, (err2) => {
      sftp.end();
      if (err2) {
        reject(new Error(`Upload failed: ${err2.message}`));
      } else {
        log(`[INFO] Upload complete.`);
        resolve();
      }
    });
  });
}





/**
 * Run an array of shell commands sequentially over SSH
 */
function runCommands(conn, commands, log) {
  return commands.reduce((p, cmd) => {
    return p.then(() => execCommand(conn, cmd, log));
  }, Promise.resolve());
}

function execCommand(conn, cmd, log) {
  return new Promise((resolve, reject) => {
    log(`[CMD] ${cmd}`);
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(new Error(`exec error: ${err.message}`));
      let output = '';
      stream.on('data', d => {
        const line = d.toString();
        output += line;
        line.split('\n').filter(Boolean).forEach(l => log(`[OUT] ${l}`));
      });
      stream.stderr.on('data', d => {
        const line = d.toString();
        line.split('\n').filter(Boolean).forEach(l => log(`[ERR] ${l}`));
      });
      stream.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`Command exited with code ${code}: ${cmd}`));
        } else {
          resolve(output);
        }
      });
    });
  });
}

/**
 * Detect archive type from filename
 */
function detectArchiveType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'targz';
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return 'tarbz2';
  if (lower.endsWith('.tar.xz')) return 'tarxz';
  if (lower.endsWith('.tar')) return 'tar';
  return 'zip'; // default
}

/**
 * Build the unzip command based on detected archive type
 */
function buildExtractCommand(archivePath, destDir, filename) {
  const type = detectArchiveType(filename);
  switch (type) {
    case 'targz':  return `tar xzf "${archivePath}" -C "${destDir}"`;
    case 'tarbz2': return `tar xjf "${archivePath}" -C "${destDir}"`;
    case 'tarxz':  return `tar xJf "${archivePath}" -C "${destDir}"`;
    case 'tar':    return `tar xf "${archivePath}" -C "${destDir}"`;
    default:       return `unzip -o "${archivePath}" -d "${destDir}"`;
  }
}

/**
 * Build the list of remote commands based on deployment config.
 * Dispatches to frontend (zip/tar extract) or binary (replace+chmod) mode.
 */
function buildCommands(config, remoteArchivePath, originalName) {
  const uploadDir = config.remoteUploadDir;
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

  const cmds = [];

  // ── Pre-deploy custom hooks ──────────────────────────────────────────────
  if (config.preCommands && config.preCommands.trim()) {
    config.preCommands.split('\n').map(s => s.trim()).filter(Boolean).forEach(cmd => cmds.push(cmd));
  }

  if (config.deployType === 'binary') {
    buildBinaryCommands(cmds, config, remoteArchivePath, uploadDir, stamp);
  } else {
    buildFrontendCommands(cmds, config, remoteArchivePath, originalName, uploadDir, stamp);
  }

  // ── Post-deploy custom hooks ─────────────────────────────────────────────
  if (config.postCommands && config.postCommands.trim()) {
    config.postCommands.split('\n').map(s => s.trim()).filter(Boolean).forEach(cmd => cmds.push(cmd));
  }

  return cmds;
}

/**
 * Binary deploy: replace existing binary, chmod 755, restart.
 * remoteArchivePath is actually the uploaded binary sitting in uploadDir.
 */
function buildBinaryCommands(cmds, config, remoteBinaryPath, uploadDir, stamp) {
  const binaryName = config.binaryName || 'app';
  const finalPath  = path.posix.join(uploadDir, binaryName);

  // Step 1: Backup existing binary (if exists)
  if (config.backupEnabled) {
    const backupPath = `${finalPath}_backup_${stamp}`;
    cmds.push(`[ -f "${finalPath}" ] && mv "${finalPath}" "${backupPath}" || echo "No existing binary to backup"`);
  }

  // Step 2: Move uploaded binary to final location
  cmds.push(`mv "${remoteBinaryPath}" "${finalPath}"`);

  // Step 3: chmod 755
  cmds.push(`chmod 755 "${finalPath}"`);

  // Step 4: Optional service restart
  if (config.serviceRestart && config.serviceRestart.trim()) {
    cmds.push(config.serviceRestart.trim());
  }
}

/**
 * Frontend deploy: extract zip/tar archive, move inner folder to target, restart.
 */
function buildFrontendCommands(cmds, config, remoteArchivePath, originalName, uploadDir, stamp) {
  // Step 1: Backup existing target directory
  if (config.backupEnabled && config.backupDir) {
    const backupName = `${config.backupDir}_backup_${stamp}`;
    cmds.push(`cd ${uploadDir} && [ -d "${config.backupDir}" ] && mv "${config.backupDir}" "${backupName}" || echo "No existing dir to backup"`);
  }

  // Step 2: Extract archive (auto-detect format)
  const extractDest = path.posix.join(uploadDir, '_deploy_tmp_' + stamp);
  cmds.push(`mkdir -p "${extractDest}"`);
  cmds.push(buildExtractCommand(remoteArchivePath, extractDest, originalName));

  // Step 3: Move inner folder to target
  if (config.innerFolder && config.targetDir) {
    cmds.push(`mv "${path.posix.join(extractDest, config.innerFolder)}" "${path.posix.join(uploadDir, config.targetDir)}"`);
    cmds.push(`rm -rf "${extractDest}"`);
  } else if (config.targetDir) {
    cmds.push(`mv "${extractDest}" "${path.posix.join(uploadDir, config.targetDir)}"`);
  }

  // Step 4: Clean up archive
  cmds.push(`rm -f "${remoteArchivePath}"`);

  // Step 5: Optional service restart
  if (config.serviceRestart && config.serviceRestart.trim()) {
    cmds.push(config.serviceRestart.trim());
  }
}


function pad(n) { return String(n).padStart(2, '0'); }
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

module.exports = { deploy };

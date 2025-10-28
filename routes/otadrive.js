
// routes/otadrive.js (enhanced)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const uploadDir = path.join(__dirname, '../uploads');
const firmwarePath = path.join(uploadDir, 'firmware.bin');
const versionFile = path.join(uploadDir, 'version.txt');

function getFirmwareMD5(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function requireApiKey(req, res, next){
  const appConfig = req.app.get('config') || {};
  const allowAnon = appConfig.allow_anonymous_check;
  const serverKey = appConfig.api_key;
  if (allowAnon) return next();
  const provided = req.header('x-api-key') || req.query.api_key;
  if (!serverKey) {
    // no server key configured - allow
    return next();
  }
  if (!provided || provided !== serverKey) {
    return res.status(401).json({ message: 'Missing or invalid API key' });
  }
  next();
}

// Device check endpoint: returns version and manifest
router.get('/check', (req, res) => {
  const deviceId = req.query.device_id || req.header('x-device-id');
  if (!deviceId) {
    return res.status(400).json({ message: 'Device ID required' });
  }

  // Get the API key the device provided
  const providedKey = req.header('x-api-key') || req.query.api_key;

  // Load device and group data
  const devices = JSON.parse(fs.readFileSync(path.join(__dirname, '../devices.json'), 'utf8') || '[]');
  const groups = JSON.parse(fs.readFileSync(path.join(__dirname, '../groups.json'), 'utf8') || '[]');

  let device = devices.find(d => d.id === deviceId);

  // If device doesn't exist, create pending entry
  if (!device) {
    device = {
      id: deviceId,
      groupId: null,
      approved: false,
      blacklisted: false,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      connectionCount: 1,
      providedApiKey: providedKey // Store the API key the device provided
    };
    devices.push(device);
    fs.writeFileSync(path.join(__dirname, '../devices.json'), JSON.stringify(devices, null, 2));

    // Log connection attempt
    const logs = JSON.parse(fs.readFileSync(path.join(__dirname, '../device_logs.json'), 'utf8') || '[]');
    logs.push({
      deviceId,
      action: 'connection_attempt',
      timestamp: new Date().toISOString(),
      details: `First connection attempt with API key: ${providedKey || 'none'}`
    });
    fs.writeFileSync(path.join(__dirname, '../device_logs.json'), JSON.stringify(logs, null, 2));

    return res.status(403).json({ message: 'Device not approved. Waiting for manual approval.' });
  }

  // Update last seen
  device.lastSeen = new Date().toISOString();
  device.connectionCount = (device.connectionCount || 0) + 1;
  fs.writeFileSync(path.join(__dirname, '../devices.json'), JSON.stringify(devices, null, 2));

  // Check if blacklisted
  if (device.blacklisted) {
    if (device.blacklistUntil && new Date(device.blacklistUntil) < new Date()) {
      // Blacklist expired
      device.blacklisted = false;
      device.blacklistReason = null;
      device.blacklistUntil = null;
      fs.writeFileSync(path.join(__dirname, '../devices.json'), JSON.stringify(devices, null, 2));
    } else {
      return res.status(403).json({ message: 'Device Blacklisted' });
    }
  }

  // Check if approved
  if (!device.approved) {
    return res.status(403).json({ message: 'Device not approved. Waiting for manual approval.' });
  }

  // Find device group
  const group = groups.find(g => g.id === device.groupId);
  if (!group) {
    return res.status(404).json({ message: 'Device group not found' });
  }

  // Check API key (reuse the providedKey from earlier)
  if (!providedKey || providedKey !== group.apiKey) {
    return res.status(401).json({ message: 'Invalid API key for device group' });
  }

  // Check if group has firmware
  const groupFirmwarePath = path.join(__dirname, '../uploads', `firmware_${group.id}.bin`);
  const groupVersionFile = path.join(__dirname, '../uploads', `version_${group.id}.txt`);

  if (!fs.existsSync(groupVersionFile)) {
    return res.status(404).json({ message: 'No firmware available for this group.' });
  }

  const latestVersion = fs.readFileSync(groupVersionFile,'utf8').trim();
  const md5 = getFirmwareMD5(groupFirmwarePath);
  const stat = fs.existsSync(groupFirmwarePath) ? fs.statSync(groupFirmwarePath) : null;

  // Calculate MD5 if not cached
  let finalMd5 = md5;
  if (!finalMd5 && fs.existsSync(groupFirmwarePath)) {
    finalMd5 = getFirmwareMD5(groupFirmwarePath);
  }

  // Log successful check
  const logs = JSON.parse(fs.readFileSync(path.join(__dirname, '../device_logs.json'), 'utf8') || '[]');
  logs.push({
    deviceId,
    action: 'firmware_check',
    timestamp: new Date().toISOString(),
    details: `Checked firmware version ${latestVersion}`
  });
  fs.writeFileSync(path.join(__dirname, '../device_logs.json'), JSON.stringify(logs, null, 2));

  res.json({
    version: latestVersion,
    md5: finalMd5,
    size: stat ? stat.size : 0,
    url: `/deviceapi/firmware.bin?group_id=${group.id}`
  });
});

// manifest endpoint (machine friendly)
router.get('/manifest.json', requireApiKey, (req, res) => {
  if (!fs.existsSync(versionFile)) return res.status(404).json({ message: 'No firmware' });
  const latestVersion = fs.readFileSync(versionFile,'utf8').trim();
  const md5 = getFirmwareMD5();
  res.json({ version: latestVersion, md5, url: '/deviceapi/firmware.bin' });
});

// Serve firmware with proper headers and support range requests
router.get('/firmware.bin', (req, res) => {
  const groupId = req.query.group_id;
  const isAdminDownload = req.query.admin_download === 'true';

  if (!groupId) {
    return res.status(400).end('Group ID required');
  }

  // For admin downloads, skip device validation
  if (!isAdminDownload) {
    const deviceId = req.query.device_id || req.header('x-device-id');
    if (!deviceId) {
      return res.status(400).end('Device ID required');
    }

    // Validate device and group
    const devices = JSON.parse(fs.readFileSync(path.join(__dirname, '../devices.json'), 'utf8') || '[]');
    const groups = JSON.parse(fs.readFileSync(path.join(__dirname, '../groups.json'), 'utf8') || '[]');

    const device = devices.find(d => d.id === deviceId);
    const group = groups.find(g => g.id === groupId);

    if (!device || !group || device.groupId !== groupId || !device.approved || device.blacklisted) {
      return res.status(403).end('Access denied');
    }

    // Check API key
    const providedKey = req.header('x-api-key') || req.query.api_key;
    if (!providedKey || providedKey !== group.apiKey) {
      return res.status(401).end('Invalid API key');
    }

    // Make deviceId available for logging
    var deviceIdForLogging = deviceId;
  }

  const groupFirmwarePath = path.join(__dirname, '../uploads', `firmware_${groupId}.bin`);
  if (!fs.existsSync(groupFirmwarePath)) return res.status(404).end('No firmware');

  const stat = fs.statSync(groupFirmwarePath);
  const total = stat.size;
  const range = req.headers.range;

  // Log download start (only for device downloads, not admin downloads)
  if (!isAdminDownload) {
    const logs = JSON.parse(fs.readFileSync(path.join(__dirname, '../device_logs.json'), 'utf8') || '[]');
    logs.push({
      deviceId: deviceIdForLogging,
      action: 'download_start',
      timestamp: new Date().toISOString(),
      details: `Started downloading ${total} bytes`
    });
    fs.writeFileSync(path.join(__dirname, '../device_logs.json'), JSON.stringify(logs, null, 2));
  }

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (start >= total || end >= total) {
      res.status(416).set('Content-Range', `bytes */${total}`).end();
      return;
    }
    const chunkSize = (end - start) + 1;
    const file = fs.createReadStream(groupFirmwarePath, { start, end });

    // Track partial download progress
    let downloaded = 0;
    file.on('data', (chunk) => {
      downloaded += chunk.length;
    });

    file.on('end', () => {
      if (!isAdminDownload) {
        const logs = JSON.parse(fs.readFileSync(path.join(__dirname, '../device_logs.json'), 'utf8') || '[]');
        logs.push({
          deviceId: deviceIdForLogging,
          action: 'download_progress',
          timestamp: new Date().toISOString(),
          details: `Downloaded ${downloaded} bytes (${Math.round((downloaded / chunkSize) * 100)}% of chunk)`
        });
        fs.writeFileSync(path.join(__dirname, '../device_logs.json'), JSON.stringify(logs, null, 2));
      }
    });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    file.pipe(res);
  } else {
    const file = fs.createReadStream(groupFirmwarePath);

    // Track full download progress
    let downloaded = 0;
    file.on('data', (chunk) => {
      downloaded += chunk.length;
    });

    file.on('end', () => {
      if (!isAdminDownload) {
        const logs = JSON.parse(fs.readFileSync(path.join(__dirname, '../device_logs.json'), 'utf8') || '[]');
        logs.push({
          deviceId: deviceIdForLogging,
          action: 'download_complete',
          timestamp: new Date().toISOString(),
          details: `Successfully downloaded ${downloaded} bytes (100%)`
        });
        fs.writeFileSync(path.join(__dirname, '../device_logs.json'), JSON.stringify(logs, null, 2));
      }
    });

    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    file.pipe(res);
  }
});

module.exports = router;

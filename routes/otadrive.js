
// routes/otadrive.js (enhanced)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const uploadDir = path.join(__dirname, '../uploads');
const firmwarePath = path.join(uploadDir, 'firmware.bin');
const versionFile = path.join(uploadDir, 'version.txt');

function getFirmwareMD5() {
  if (!fs.existsSync(firmwarePath)) return null;
  const buffer = fs.readFileSync(firmwarePath);
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
router.get('/check', requireApiKey, (req, res) => {
  if (!fs.existsSync(versionFile)) {
    return res.status(404).json({ message: 'No firmware uploaded yet.' });
  }
  const latestVersion = fs.readFileSync(versionFile,'utf8').trim();
  const md5 = getFirmwareMD5();
  const stat = fs.existsSync(firmwarePath) ? fs.statSync(firmwarePath) : null;
  res.json({
    version: latestVersion,
    md5,
    size: stat ? stat.size : 0,
    url: '/deviceapi/firmware.bin'
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
router.get('/firmware.bin', requireApiKey, (req, res) => {
  if (!fs.existsSync(firmwarePath)) return res.status(404).end('No firmware');

  const stat = fs.statSync(firmwarePath);
  const total = stat.size;
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (start >= total || end >= total) {
      res.status(416).set('Content-Range', `bytes */${total}`).end();
      return;
    }
    const chunkSize = (end - start) + 1;
    const file = fs.createReadStream(firmwarePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    file.pipe(res);
    return;
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(firmwarePath).pipe(res);
  }
});

module.exports = router;

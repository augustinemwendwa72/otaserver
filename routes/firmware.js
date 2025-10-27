const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

const firmwarePath = path.join(__dirname, '../uploads/firmware.bin');
const versionFile = path.join(__dirname, '../uploads/version.txt');

function getFirmwareMD5() {
  if (!fs.existsSync(firmwarePath)) return null;
  const buffer = fs.readFileSync(firmwarePath);
  return crypto.createHash('md5').update(buffer).digest('hex');
}

// Endpoint for Arduino to check for updates
router.get('/check', (req, res) => {
  if (!fs.existsSync(versionFile)) {
    return res.status(404).json({ message: 'No firmware uploaded yet.' });
  }

  const latestVersion = fs.readFileSync(versionFile, 'utf8').trim();
  const md5 = getFirmwareMD5();
  const stat = fs.existsSync(firmwarePath) ? fs.statSync(firmwarePath) : null;
  res.json({
    version: latestVersion,
    md5,
    size: stat ? stat.size : 0,
    url: '/deviceapi/firmware.bin'
  });
});

// Endpoint for Arduino to download firmware
router.get('/download', (req, res) => {
  if (!fs.existsSync(firmwarePath)) {
    return res.status(404).json({ message: 'No firmware available.' });
  }

  res.download(firmwarePath, 'firmware.bin');
});

module.exports = router;

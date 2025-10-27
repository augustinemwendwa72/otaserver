const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const firmwarePath = path.join(__dirname, '../uploads/firmware.bin');
const versionFile = path.join(__dirname, '../uploads/version.txt');

// Endpoint for Arduino to check for updates
router.get('/check', (req, res) => {
  if (!fs.existsSync(versionFile)) {
    return res.status(404).json({ message: 'No firmware uploaded yet.' });
  }

  const latestVersion = fs.readFileSync(versionFile, 'utf8').trim();
  res.json({ version: latestVersion });
});

// Endpoint for Arduino to download firmware
router.get('/download', (req, res) => {
  if (!fs.existsSync(firmwarePath)) {
    return res.status(404).json({ message: 'No firmware available.' });
  }

  res.download(firmwarePath, 'firmware.bin');
});

module.exports = router;

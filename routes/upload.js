const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, 'firmware.bin')
});

const upload = multer({ storage });

// Upload firmware via browser form
router.post('/', upload.single('firmware'), (req, res) => {
  const { version, api_key } = req.body;
  if (!version) return res.status(400).json({ message: 'Version required' });

  fs.writeFileSync(path.join(uploadDir, 'version.txt'), version.trim());

  // if API key provided, persist to config
  if (api_key) {
    const configPath = path.join(__dirname, '../config.json');
    try {
      let cfg = {};
      if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath,'utf8'));
      cfg.api_key = api_key;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      console.log('Saved API key to config.json');
    } catch (e) {
      console.error('Failed to save API key:', e);
    }
  }

  res.json({ message: 'Firmware uploaded successfully', version });
});

router.get('/check', (req, res) => {
  const configPath = path.join(__dirname, '../config.json');
  let config = { api_key: null, allow_anonymous_check: false };
  if (fs.existsSync(configPath)) {
    try {
      config = Object.assign(config, JSON.parse(fs.readFileSync(configPath, 'utf8')));
    } catch (e) {
      console.error('Failed to parse config.json', e);
    }
  }
  res.json(config);
});

router.post('/config', (req, res) => {
  const { api_key, allow_anonymous_check } = req.body;
  const configPath = path.join(__dirname, '../config.json');

  try {
    let cfg = {};
    if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    if (api_key !== undefined) cfg.api_key = api_key;
    if (allow_anonymous_check !== undefined) cfg.allow_anonymous_check = allow_anonymous_check;

    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    console.log('Configuration updated');
    res.json({ message: 'Configuration updated successfully' });
  } catch (e) {
    console.error('Failed to update config:', e);
    res.status(500).json({ message: 'Failed to update configuration' });
  }
});

module.exports = router;

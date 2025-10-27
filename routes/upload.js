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

module.exports = router;

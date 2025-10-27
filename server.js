// server.js (modified to add config and API-key protection)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const firmwareRoutes = require('./routes/firmware');
const uploadRoutes = require('./routes/upload');
const otadriveRoutes = require('./routes/otadrive');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// load config
const configPath = path.join(__dirname,'config.json');
let CONFIG = { api_key: null, port: process.env.PORT || 3000, allow_anonymous_check: false };
if (fs.existsSync(configPath)){
  try{
    CONFIG = Object.assign(CONFIG, JSON.parse(fs.readFileSync(configPath,'utf8')));
  }catch(e){
    console.error('Failed to parse config.json', e);
  }
}
app.set('config', CONFIG);

// simple logger
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  res.on('finish', () => {
    console.log(`→ Response Status: ${res.statusCode}`);
    console.log('==============================\n');
  });
  next();
});

// Mount API routes
app.use('/api/firmware', firmwareRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/config', uploadRoutes); // Configuration endpoints
app.use('/deviceapi', otadriveRoutes); // OTAdrive-style endpoint

const PORT = CONFIG.port || process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ OTA Server running on port ${PORT}`));

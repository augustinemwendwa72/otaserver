// server.js (modified to add config and API-key protection)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

const firmwareRoutes = require('./routes/firmware');
const uploadRoutes = require('./routes/upload');
const otadriveRoutes = require('./routes/otadrive');
const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: 'ota-server-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Authentication middleware
app.use('/api', (req, res, next) => {
  // Skip auth for login and device endpoints
  if (req.path.startsWith('/auth') || req.path.startsWith('/deviceapi')) {
    return next();
  }
  if (!req.session.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  next();
});

// Serve static files
app.use(express.static('public'));

// Protect admin routes
app.use('/admin.html', (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
});

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
app.use('/api/auth', authRoutes);
app.use('/api/firmware', firmwareRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/config', uploadRoutes); // Configuration endpoints
app.use('/api/devices', deviceRoutes);
app.use('/deviceapi', otadriveRoutes); // OTAdrive-style endpoint

// Always redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

const PORT = CONFIG.port || process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ OTA Server running on port ${PORT}`));

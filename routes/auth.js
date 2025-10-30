const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const router = express.Router();

const usersFile = path.join(__dirname, '../users.json');
const authKeysFile = path.join(__dirname, '../auth_keys.json');

// Authentication key for sign up
const AUTH_KEY = 'GiG6Uy8DAhtkJ0of2PXoKFE0nplMiMZf';

// Initialize data files
function initializeData() {
  if (!fs.existsSync(usersFile)) {
    fs.writeFileSync(usersFile, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(authKeysFile)) {
    fs.writeFileSync(authKeysFile, JSON.stringify({}, null, 2));
  }
}

initializeData();

// Sign up endpoint
router.post('/signup', async (req, res) => {
  const { email, password, authKey } = req.body;

  if (!email || !password || !authKey) {
    return res.status(400).json({ message: 'Email, password, and auth key are required' });
  }

  if (authKey !== AUTH_KEY) {
    return res.status(401).json({ message: 'Invalid authentication key' });
  }

  try {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const existingUser = users.find(u => u.email === email);

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: crypto.randomUUID(),
      email,
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    // Send auth key to email (simulated)
    console.log(`Auth key sent to ${email}: ${AUTH_KEY}`);

    res.json({ message: 'Account created successfully. Please sign in.' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Signup failed' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const user = users.find(u => u.email === email);

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    res.json({ message: 'Login successful', user: req.session.user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.json({ message: 'Logout successful' });
  });
});

// Check authentication status
router.get('/status', (req, res) => {
  if (req.session.user) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

// Change password
router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const userIndex = users.findIndex(u => u.email === req.session.user.email);

    if (userIndex === -1 || !await bcrypt.compare(currentPassword, users[userIndex].password)) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    users[userIndex].password = await bcrypt.hash(newPassword, 10);
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Password change failed' });
  }
});

// Verify password for sensitive operations
router.post('/verify-password', async (req, res) => {
  const { password } = req.body;

  if (!req.session.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  if (!password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  try {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const user = users.find(u => u.email === req.session.user.email);

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ message: 'Password verification failed' });
  }
});

module.exports = router;
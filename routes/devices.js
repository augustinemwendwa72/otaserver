const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

const groupsFile = path.join(__dirname, '../groups.json');
const devicesFile = path.join(__dirname, '../devices.json');
const logsFile = path.join(__dirname, '../device_logs.json');

// Initialize data files
function initializeData() {
  if (!fs.existsSync(groupsFile)) {
    fs.writeFileSync(groupsFile, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(devicesFile)) {
    fs.writeFileSync(devicesFile, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(logsFile)) {
    fs.writeFileSync(logsFile, JSON.stringify([], null, 2));
  }
}

initializeData();

// Helper functions
function loadGroups() {
  return JSON.parse(fs.readFileSync(groupsFile, 'utf8'));
}

function saveGroups(groups) {
  fs.writeFileSync(groupsFile, JSON.stringify(groups, null, 2));
}

function loadDevices() {
  return JSON.parse(fs.readFileSync(devicesFile, 'utf8'));
}

function saveDevices(devices) {
  fs.writeFileSync(devicesFile, JSON.stringify(devices, null, 2));
}

function loadLogs() {
  return JSON.parse(fs.readFileSync(logsFile, 'utf8'));
}

function saveLogs(logs) {
  fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2));
}

function logDeviceActivity(deviceId, action, details = {}) {
  const logs = loadLogs();
  logs.push({
    deviceId,
    action,
    timestamp: new Date().toISOString(),
    ...details
  });
  // Keep only last 1000 logs
  if (logs.length > 1000) {
    logs.splice(0, logs.length - 1000);
  }
  saveLogs(logs);
}

// Group management
router.get('/groups', (req, res) => {
  try {
    const groups = loadGroups();
    res.json(groups);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load groups' });
  }
});

router.post('/groups', (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Group name is required' });
  }

  try {
    const groups = loadGroups();

    // Check if group already exists
    if (groups.find(g => g.name === name)) {
      return res.status(400).json({ message: 'Group already exists' });
    }

    const newGroup = {
      id: crypto.randomUUID(),
      name,
      description: description || '',
      apiKey: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
      firmware: null // Will store firmware info
    };

    groups.push(newGroup);
    saveGroups(groups);

    res.json({ message: 'Group created successfully', group: newGroup });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create group' });
  }
});

router.delete('/groups/:id', (req, res) => {
  const { id } = req.params;

  try {
    const groups = loadGroups();
    const devices = loadDevices();

    const groupIndex = groups.findIndex(g => g.id === id);
    if (groupIndex === -1) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Remove group
    groups.splice(groupIndex, 1);
    saveGroups(groups);

    // Remove devices from this group
    const updatedDevices = devices.filter(d => d.groupId !== id);
    saveDevices(updatedDevices);

    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete group' });
  }
});

// Device management
router.get('/devices', (req, res) => {
  try {
    const devices = loadDevices();
    const groups = loadGroups();

    // Add group names to devices
    const devicesWithGroups = devices.map(device => ({
      ...device,
      groupName: groups.find(g => g.id === device.groupId)?.name || 'Unknown'
    }));

    res.json(devicesWithGroups);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load devices' });
  }
});

router.post('/devices/:deviceId/approve', (req, res) => {
  const { deviceId } = req.params;
  const { groupId } = req.body;

  if (!groupId) {
    return res.status(400).json({ message: 'Group ID required for approval' });
  }

  try {
    const devices = loadDevices();
    const groups = loadGroups();
    const device = devices.find(d => d.id === deviceId);
    const group = groups.find(g => g.id === groupId);

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    device.approved = true;
    device.approvedAt = new Date().toISOString();
    device.groupId = groupId;
    saveDevices(devices);

    logDeviceActivity(deviceId, 'approved', {
      approvedBy: req.session.user.username,
      groupId,
      groupName: group.name
    });

    res.json({ message: 'Device approved successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to approve device' });
  }
});

router.post('/devices/:deviceId/blacklist', (req, res) => {
  const { deviceId } = req.params;
  const { reason, duration } = req.body; // duration in hours

  try {
    const devices = loadDevices();
    const device = devices.find(d => d.id === deviceId);

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    device.blacklisted = true;
    device.blacklistReason = reason || 'Manual blacklist';
    device.blacklistUntil = duration ? new Date(Date.now() + duration * 60 * 60 * 1000).toISOString() : null;
    saveDevices(devices);

    logDeviceActivity(deviceId, 'blacklisted', {
      reason: device.blacklistReason,
      duration,
      blacklistedBy: req.session.user.username
    });

    res.json({ message: 'Device blacklisted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to blacklist device' });
  }
});

router.post('/devices/:deviceId/unblacklist', (req, res) => {
  const { deviceId } = req.params;

  try {
    const devices = loadDevices();
    const device = devices.find(d => d.id === deviceId);

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    device.blacklisted = false;
    device.blacklistReason = null;
    device.blacklistUntil = null;
    saveDevices(devices);

    logDeviceActivity(deviceId, 'unblacklisted', { unblacklistedBy: req.session.user.username });

    res.json({ message: 'Device unblacklisted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to unblacklist device' });
  }
});

// Device logs
router.get('/logs', (req, res) => {
  try {
    const logs = loadLogs();
    const { deviceId, limit = 100 } = req.query;

    let filteredLogs = logs;
    if (deviceId) {
      filteredLogs = logs.filter(log => log.deviceId === deviceId);
    }

    // Return most recent logs first
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    filteredLogs = filteredLogs.slice(0, parseInt(limit));

    res.json(filteredLogs);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load logs' });
  }
});

// Recent connection requests
router.get('/connection-requests', (req, res) => {
  try {
    const devices = loadDevices();
    const pendingDevices = devices.filter(d => !d.approved && !d.blacklisted);

    // Get recent logs for these devices
    const logs = loadLogs();
    const recentLogs = logs.filter(log =>
      pendingDevices.some(d => d.id === log.deviceId) &&
      log.action === 'connection_attempt'
    ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(recentLogs.slice(0, 50)); // Last 50 connection attempts
  } catch (error) {
    res.status(500).json({ message: 'Failed to load connection requests' });
  }
});

module.exports = router;
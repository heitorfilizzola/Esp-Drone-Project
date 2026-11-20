const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const multer = require('multer');
const mqtt = require('mqtt');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
let MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://172.20.10.2:1883';
let MQTT_USERNAME = process.env.MQTT_USERNAME || 'esp32s3_tof90';
let MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'Heitor2006#';

// Diretórios e Arquivos de Firmware
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const UPLOADED_FIRMWARE_PATH = path.join(UPLOADS_DIR, 'firmware.bin');
const PIO_FIRMWARE_PATH = path.resolve(__dirname, '../esp32s3-ToF90-test/.pio/build/esp32-s3-devkitc-1/firmware.bin');

// Função para detectar o IP local da máquina na rede ativa
function detectLocalIp() {
  const interfaces = os.networkInterfaces();
  let fallback = '127.0.0.1';

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (iface.address.startsWith('172.') || iface.address.startsWith('192.168.')) {
          return iface.address;
        }
        fallback = iface.address;
      }
    }
  }
  return fallback;
}

let SERVER_HOST = process.env.SERVER_IP || detectLocalIp();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado em Memória
const devices = new Map();
let mqttConnected = false;
let mqttClient = null;
const sseClients = new Set();
const systemLogs = [];

function addLog(source, message, type = 'info') {
  const logEntry = {
    timestamp: new Date().toLocaleTimeString(),
    source,
    message,
    type,
  };
  systemLogs.push(logEntry);
  if (systemLogs.length > 200) systemLogs.shift();
  broadcastSSE({ type: 'log', log: logEntry });
}

function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Obter arquivo ativo de firmware (.bin)
function getActiveFirmwareInfo() {
  if (fs.existsSync(UPLOADED_FIRMWARE_PATH)) {
    const stat = fs.statSync(UPLOADED_FIRMWARE_PATH);
    return {
      source: 'uploaded',
      path: UPLOADED_FIRMWARE_PATH,
      filename: 'firmware.bin (Upload Manual)',
      sizeBytes: stat.size,
      sizeKb: (stat.size / 1024).toFixed(1),
      modified: stat.mtime.toLocaleString(),
      exists: true,
    };
  }

  if (fs.existsSync(PIO_FIRMWARE_PATH)) {
    const stat = fs.statSync(PIO_FIRMWARE_PATH);
    return {
      source: 'platformio',
      path: PIO_FIRMWARE_PATH,
      filename: 'firmware.bin (Compilado PlatformIO)',
      sizeBytes: stat.size,
      sizeKb: (stat.size / 1024).toFixed(1),
      modified: stat.mtime.toLocaleString(),
      exists: true,
    };
  }

  return {
    source: 'none',
    filename: 'Nenhum firmware disponível',
    sizeBytes: 0,
    sizeKb: '0',
    modified: '-',
    exists: false,
  };
}

// Configuração do Multer para upload de binário
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, 'firmware.bin'),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máx
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.bin')) {
      return cb(new Error('Apenas arquivos de extensão .bin são aceitos!'));
    }
    cb(null, true);
  },
});

// ==========================================================
// CONEXÃO COM O BROKER MQTT (EMQX)
// ==========================================================
function initMQTT() {
  if (mqttClient) {
    try {
      mqttClient.end(true);
    } catch {}
  }

  addLog('MQTT', `Iniciando conexao com broker: ${MQTT_BROKER_URL}...`);

  const options = {
    clientId: `ota_server_${Math.random().toString(16).substring(2, 8)}`,
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clean: true,
    reconnectPeriod: 4000,
  };

  mqttClient = mqtt.connect(MQTT_BROKER_URL, options);

  mqttClient.on('connect', () => {
    mqttConnected = true;
    addLog('MQTT', `Conectado com sucesso ao broker ${MQTT_BROKER_URL}!`, 'success');

    mqttClient.subscribe('drone/#', (err) => {
      if (!err) {
        addLog('MQTT', 'Subscrito com sucesso ao topico coringa: drone/#');
      }
    });

    broadcastSSE({ type: 'mqtt_status', connected: true });
  });

  mqttClient.on('error', (err) => {
    mqttConnected = false;
    addLog('MQTT', `Erro no broker: ${err.message}`, 'error');
    broadcastSSE({ type: 'mqtt_status', connected: false });
  });

  mqttClient.on('close', () => {
    if (mqttConnected) {
      mqttConnected = false;
      addLog('MQTT', 'Conexao com broker perdida. Tentando reconectar...', 'warning');
      broadcastSSE({ type: 'mqtt_status', connected: false });
    }
  });

  mqttClient.on('message', (topic, messageBuffer) => {
    try {
      const payloadStr = messageBuffer.toString();
      const data = JSON.parse(payloadStr);

      if (topic === 'drone/sensor/tof90' || topic === 'drone/devices/status') {
        const id = data.device_id || 'esp32_default';
        const existing = devices.get(id) || {
          id,
          otaStatus: 'idle',
          otaProgress: 0,
          otaMessage: 'Pronto',
        };

        const updatedDevice = {
          ...existing,
          id,
          ip: data.ip || existing.ip || 'Detectando...',
          version: data.firmware_version || existing.version || '1.0.0',
          sensor: data.sensor || existing.sensor || 'ToF-90',
          distance_mm: data.distance_mm !== undefined ? data.distance_mm : existing.distance_mm,
          valid: data.valid !== undefined ? data.valid : existing.valid,
          lastSeen: Date.now(),
          status: 'online',
        };

        devices.set(id, updatedDevice);
        broadcastSSE({ type: 'device_update', device: updatedDevice });
      } else if (topic === 'drone/ota/status') {
        const id = data.device_id || 'esp32_default';
        const dev = devices.get(id) || { id, status: 'online' };

        dev.otaStatus = data.status || dev.otaStatus;
        if (data.progress !== undefined) {
          dev.otaProgress = data.progress;
        }
        dev.otaMessage = data.message || (data.status === 'downloading' ? `Gravando ${data.progress}%` : dev.otaStatus);
        dev.lastSeen = Date.now();

        devices.set(id, dev);
        addLog('OTA', `[${id}] Status: ${dev.otaStatus} (${dev.otaProgress}%) - ${dev.otaMessage}`, dev.otaStatus === 'error' ? 'error' : dev.otaStatus === 'success' ? 'success' : 'info');
        broadcastSSE({ type: 'ota_progress', device: dev });
      }
    } catch {
      // Mensagens não-JSON ignoradas
    }
  });
}

// Checagem periódica de status offline de dispositivos
setInterval(() => {
  const now = Date.now();
  for (const [id, dev] of devices.entries()) {
    if (dev.status === 'online' && now - dev.lastSeen > 8000 && dev.otaStatus !== 'success') {
      dev.status = 'offline';
      broadcastSSE({ type: 'device_update', device: dev });
    }
  }
}, 3000);

// ==========================================================
// ROTAS DA API REST
// ==========================================================

// Endpoint do binário para download do ESP32 (streaming direto com suporte a .pio/build)
app.get('/firmware.bin', (req, res) => {
  const fw = getActiveFirmwareInfo();
  if (!fw.exists) {
    return res.status(404).send('Nenhum firmware .bin encontrado no servidor.');
  }

  addLog('HTTP', `Dispositivo (${req.ip}) requisitou download do firmware: ${fw.filename}`);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="firmware.bin"');
  res.setHeader('Content-Length', fw.sizeBytes);

  const fileStream = fs.createReadStream(fw.path);
  fileStream.on('error', (err) => {
    addLog('HTTP', `Erro ao transmitir firmware: ${err.message}`, 'error');
    if (!res.headersSent) {
      res.status(500).send('Erro interno ao ler arquivo de firmware.');
    }
  });
  fileStream.pipe(res);
});

// Status geral do servidor
app.get('/api/status', (req, res) => {
  res.json({
    serverIp: SERVER_HOST,
    port: PORT,
    mqttConnected,
    mqttBroker: MQTT_BROKER_URL,
    devices: Array.from(devices.values()),
    firmware: getActiveFirmwareInfo(),
    logs: systemLogs.slice(-50),
  });
});

// Informações sobre o firmware ativo
app.get('/api/firmware/info', (req, res) => {
  res.json(getActiveFirmwareInfo());
});

// Upload de novo arquivo .bin
app.post('/api/firmware/upload', upload.single('firmware'), (req, res) => {
  const fw = getActiveFirmwareInfo();
  addLog('FIRMWARE', `Novo binário enviado com sucesso: ${fw.sizeKb} KB`, 'success');
  broadcastSSE({ type: 'firmware_update', firmware: fw });
  res.json({ success: true, message: 'Firmware carregado com sucesso!', firmware: fw });
});

// Restaurar firmware padrão compilado pelo PlatformIO
app.post('/api/firmware/reset-default', (req, res) => {
  if (fs.existsSync(UPLOADED_FIRMWARE_PATH)) {
    fs.unlinkSync(UPLOADED_FIRMWARE_PATH);
  }
  const fw = getActiveFirmwareInfo();
  addLog('FIRMWARE', 'Firmware redefinido para a compilação padrão do PlatformIO');
  broadcastSSE({ type: 'firmware_update', firmware: fw });
  res.json({ success: true, message: 'Firmware restaurado para o padrão do PlatformIO.', firmware: fw });
});

// Configurações dinâmicas (IP do Servidor e Broker MQTT)
app.post('/api/config', (req, res) => {
  const { serverIp, mqttBroker } = req.body;
  if (serverIp && serverIp.trim()) {
    SERVER_HOST = serverIp.trim();
    addLog('CONFIG', `IP do servidor atualizado para: ${SERVER_HOST}`, 'system');
  }
  if (mqttBroker && mqttBroker.trim() && mqttBroker !== MQTT_BROKER_URL) {
    MQTT_BROKER_URL = mqttBroker.trim();
    addLog('CONFIG', `Broker MQTT alterado para: ${MQTT_BROKER_URL}. Reconectando...`, 'system');
    initMQTT();
  }
  res.json({
    success: true,
    serverIp: SERVER_HOST,
    mqttBroker: MQTT_BROKER_URL,
    mqttConnected,
  });
});

// DISPARO DE OTA PARA A FROTA OU DISPOSITIVO ESPECÍFICO
app.post('/api/ota/start', (req, res) => {
  const target = req.body.target || 'all';
  const customHost = req.body.serverIp || SERVER_HOST;
  const firmwareUrl = `http://${customHost}:${PORT}/firmware.bin`;

  const fw = getActiveFirmwareInfo();
  if (!fw.exists) {
    return res.status(400).json({
      success: false,
      message: 'Impossível iniciar OTA: Nenhum arquivo firmware.bin disponível para download.',
    });
  }

  if (!mqttConnected || !mqttClient) {
    return res.status(503).json({
      success: false,
      message: 'Impossível disparar OTA: Servidor desconectado do Broker MQTT.',
    });
  }

  const otaCmd = {
    action: 'update',
    target,
    url: firmwareUrl,
    size: fw.sizeBytes,
    timestamp: Date.now(),
  };

  mqttClient.publish('drone/cmd/ota', JSON.stringify(otaCmd), { qos: 1 }, (err) => {
    if (err) {
      addLog('OTA', `Erro ao publicar comando de OTA: ${err.message}`, 'error');
      return res.status(500).json({ success: false, message: 'Erro ao enviar comando via MQTT.' });
    }

    addLog('OTA', `🚀 COMANDO DE ATUALIZAÇÃO DISPARADO! Alvo: ${target} | URL: ${firmwareUrl}`, 'success');

    for (const [id, dev] of devices.entries()) {
      if (target === 'all' || target === id) {
        dev.otaStatus = 'starting';
        dev.otaProgress = 0;
        dev.otaMessage = 'Aguardando ESP32 iniciar download...';
        broadcastSSE({ type: 'ota_progress', device: dev });
      }
    }

    res.json({
      success: true,
      message: `Comando OTA disparado para '${target}'! Os dispositivos iniciarão o download.`,
      url: firmwareUrl,
      target,
    });
  });
});

// Server-Sent Events (SSE) para atualização em tempo real do frontend
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  sseClients.add(res);

  const initPayload = {
    type: 'init',
    serverIp: SERVER_HOST,
    port: PORT,
    mqttConnected,
    mqttBroker: MQTT_BROKER_URL,
    devices: Array.from(devices.values()),
    firmware: getActiveFirmwareInfo(),
    logs: systemLogs.slice(-30),
  };
  res.write(`data: ${JSON.stringify(initPayload)}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Inicia servidor
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 ESP-Drone OTA Management Server`);
  console.log(`🌐 Painel Web: http://${SERVER_HOST}:${PORT}`);
  console.log(`📡 URL OTA ESP32: http://${SERVER_HOST}:${PORT}/firmware.bin`);
  console.log(`📡 Broker MQTT: ${MQTT_BROKER_URL}`);
  console.log(`======================================================\n`);
  initMQTT();
});

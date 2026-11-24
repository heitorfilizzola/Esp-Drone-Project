// Estado Global do Cliente
let serverIp = window.location.hostname;
let serverPort = window.location.port || 5000;
let devicesMap = new Map();
let currentFirmware = null;
let isUpdating = false;

// Elementos do DOM
const mqttStatusBadge = document.getElementById('mqttStatusBadge');
const mqttStatusText = document.getElementById('mqttStatusText');
const btnStartOta = document.getElementById('btnStartOta');
const otaGlobalStatus = document.getElementById('otaGlobalStatus');
const deviceCount = document.getElementById('deviceCount');
const deviceList = document.getElementById('deviceList');
const fwFilename = document.getElementById('fwFilename');
const fwSize = document.getElementById('fwSize');
const fwModified = document.getElementById('fwModified');
const fwDownloadUrl = document.getElementById('fwDownloadUrl');
const fwSourceTag = document.getElementById('fwSourceTag');
const firmwareFileInput = document.getElementById('firmwareFileInput');
const btnResetDefaultFw = document.getElementById('btnResetDefaultFw');
const serverIpInput = document.getElementById('serverIpInput');
const btnSaveIp = document.getElementById('btnSaveIp');
const mqttBrokerInput = document.getElementById('mqttBrokerInput');
const btnSaveBroker = document.getElementById('btnSaveBroker');
const logsConsole = document.getElementById('logsConsole');
const btnClearLogs = document.getElementById('btnClearLogs');

// Adicionar linha ao console de logs
function appendLog(source, message, type = 'info') {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] [${source}] ${message}`;
  logsConsole.appendChild(line);
  logsConsole.scrollTop = logsConsole.scrollHeight;
}

// Atualiza o card de Firmware
function updateFirmwareUI(fw) {
  currentFirmware = fw;
  if (!fw || !fw.exists) {
    fwFilename.textContent = 'Nenhum firmware disponível';
    fwSize.textContent = '0 KB';
    fwModified.textContent = '-';
    fwSourceTag.textContent = 'Inexistente';
    fwSourceTag.style.color = '#EF4444';
    fwDownloadUrl.textContent = 'Indisponível';
    btnStartOta.disabled = true;
    return;
  }

  fwFilename.textContent = fw.filename;
  fwSize.textContent = `${fw.sizeKb} KB (${fw.sizeBytes} bytes)`;
  fwModified.textContent = fw.modified;
  fwSourceTag.textContent = fw.source === 'uploaded' ? 'Upload Manual' : 'PlatformIO Build';
  fwDownloadUrl.textContent = `http://${serverIp}:${serverPort}/firmware.bin`;
  btnStartOta.disabled = false;
}

// Renderiza a lista de dispositivos conectados
function renderDevices() {
  deviceCount.textContent = devicesMap.size;

  if (devicesMap.size === 0) {
    deviceList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <p>Aguardando comunicação com drones ESP32 no broker MQTT...</p>
      </div>
    `;
    return;
  }

  deviceList.innerHTML = '';
  for (const [id, dev] of devicesMap.entries()) {
    const card = document.createElement('div');
    const isUpdatingDev = dev.otaStatus === 'downloading' || dev.otaStatus === 'starting';
    card.className = `device-card ${isUpdatingDev ? 'updating' : ''}`;

    const isOnline = dev.status === 'online';
    const badgeClass = isUpdatingDev ? 'updating' : isOnline ? 'online' : 'offline';
    const badgeLabel = isUpdatingDev ? 'Atualizando OTA' : isOnline ? 'Online' : 'Offline';

    const progress = dev.otaProgress || 0;
    const distanceText = dev.distance_mm !== undefined && dev.distance_mm >= 0
      ? `${dev.distance_mm} mm (${(dev.distance_mm / 10).toFixed(1)} cm)`
      : (dev.distance_mm === -1 ? 'Fora de alcance' : '--');

    card.innerHTML = `
      <div class="device-header">
        <span class="device-name">🚁 ${id}</span>
        <span class="device-badge ${badgeClass}">${badgeLabel}</span>
      </div>

      <div class="device-meta-row">
        <span>IP: <strong>${dev.ip || '--'}</strong></span>
        <span>Versão: <strong>${dev.version || '1.0.0'}</strong></span>
        <span>Sensor: <strong>${dev.sensor || 'ToF-90'}</strong></span>
        <span>Altitude: <strong>${distanceText}</strong></span>
      </div>

      <div class="ota-progress-box">
        <div class="ota-progress-bar-bg">
          <div class="ota-progress-bar-fill" style="width: ${progress}%;"></div>
        </div>
        <div class="ota-progress-label">
          <span>Status: ${dev.otaMessage || dev.otaStatus || 'Pronto'}</span>
          <span>${progress}%</span>
        </div>
      </div>

      <button class="btn-single-update" onclick="triggerOtaForDevice('${id}')" ${!isOnline || isUpdatingDev ? 'disabled' : ''}>
        Atualizar Apenas Este
      </button>
    `;

    deviceList.appendChild(card);
  }
}

// Disparar OTA para todos os dispositivos ou um específico
async function triggerOta(target = 'all') {
  if (devicesMap.size === 0 && target === 'all') {
    if (!confirm('Nenhum dispositivo detectado como online no momento. Deseja disparar a ordem de OTA via MQTT mesmo assim?')) {
      return;
    }
  }

  const targetDesc = target === 'all' ? 'TODOS os dispositivos' : `o dispositivo '${target}'`;
  if (!confirm(`Confirmar atualização OTA para ${targetDesc}?\n\nOs dispositivos farão o download do firmware e reiniciarão automaticamente.`)) {
    return;
  }

  try {
    btnStartOta.disabled = true;
    otaGlobalStatus.textContent = `Disparando comando de atualização para ${targetDesc}...`;
    appendLog('OTA', `Disparando requisição POST /api/ota/start para ${targetDesc}...`, 'system');

    const res = await fetch('/api/ota/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, serverIp }),
    });

    const data = await res.json();
    if (data.success) {
      otaGlobalStatus.textContent = `🚀 ${data.message}`;
      appendLog('OTA', data.message, 'success');
    } else {
      otaGlobalStatus.textContent = `❌ ${data.message}`;
      appendLog('OTA', `Falha: ${data.message}`, 'error');
      btnStartOta.disabled = false;
    }
  } catch (err) {
    otaGlobalStatus.textContent = `Erro ao comunicar com o servidor: ${err.message}`;
    appendLog('OTA', `Erro de rede: ${err.message}`, 'error');
    btnStartOta.disabled = false;
  }
}

window.triggerOtaForDevice = function(id) {
  triggerOta(id);
};

// Event Listeners
btnStartOta.addEventListener('click', () => triggerOta('all'));

btnClearLogs.addEventListener('click', () => {
  logsConsole.innerHTML = '<div class="terminal-line system">[Sistema] Console limpo.</div>';
});

// Upload de firmware via Input File
firmwareFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.bin')) {
    alert('Erro: Apenas arquivos de firmware .bin são permitidos.');
    return;
  }

  const formData = new FormData();
  formData.append('firmware', file);

  appendLog('UPLOAD', `Enviando arquivo ${file.name} (${(file.size / 1024).toFixed(1)} KB)...`, 'system');

  try {
    const res = await fetch('/api/firmware/upload', {
      method: 'POST',
      body: formData,
    });
    const result = await res.json();
    if (result.success) {
      updateFirmwareUI(result.firmware);
      appendLog('UPLOAD', `Firmware ${file.name} carregado com sucesso no servidor!`, 'success');
      alert('Firmware carregado com sucesso!');
    } else {
      alert(`Falha: ${result.message}`);
    }
  } catch (err) {
    appendLog('UPLOAD', `Erro ao enviar arquivo: ${err.message}`, 'error');
    alert(`Erro ao fazer upload: ${err.message}`);
  }
  firmwareFileInput.value = '';
});

// Restaurar firmware padrão do PlatformIO
btnResetDefaultFw.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/firmware/reset-default', { method: 'POST' });
    const data = await res.json();
    updateFirmwareUI(data.firmware);
    appendLog('FIRMWARE', data.message, 'system');
    alert(data.message);
  } catch (err) {
    alert(`Erro: ${err.message}`);
  }
});

// Salvar IP customizado do Servidor
btnSaveIp.addEventListener('click', async () => {
  const customIp = serverIpInput.value.trim();
  if (customIp) {
    serverIp = customIp;
    fwDownloadUrl.textContent = `http://${serverIp}:${serverPort}/firmware.bin`;
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverIp }),
    });
    appendLog('CONFIG', `IP do servidor atualizado para: ${serverIp}`, 'system');
    alert(`IP do Servidor ajustado para: ${serverIp}`);
  }
});

// Salvar e Reconectar Broker MQTT
btnSaveBroker.addEventListener('click', async () => {
  const customBroker = mqttBrokerInput.value.trim();
  if (customBroker) {
    appendLog('CONFIG', `Alterando broker MQTT para: ${customBroker}...`, 'system');
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mqttBroker: customBroker }),
    });
    const data = await res.json();
    alert(`Comando de reconexão enviado para broker: ${data.mqttBroker}`);
  }
});

// ==========================================================
// CONEXÃO COM SERVER-SENT EVENTS (SSE)
// ==========================================================
function setupSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'init':
          serverIp = data.serverIp || serverIp;
          serverPort = data.port || serverPort;
          serverIpInput.value = serverIp;
          if (mqttBrokerInput) {
            mqttBrokerInput.value = data.mqttBroker || '';
          }

          updateMqttStatus(data.mqttConnected);
          updateFirmwareUI(data.firmware);

          devicesMap.clear();
          if (data.devices) {
            for (const d of data.devices) devicesMap.set(d.id, d);
          }
          renderDevices();

          if (data.aiMetrics && data.aiMetrics.length > 0) {
            updateAiUI(data.aiMetrics[0]);
            renderAnomaliesList(data.aiMetrics[0].recentAnomalies);
          }

          if (data.logs) {
            logsConsole.innerHTML = '';
            for (const l of data.logs) {
              appendLog(l.source, l.message, l.type);
            }
          }
          break;

        case 'ai_update':
          updateAiUI(data.ai);
          break;

        case 'mqtt_status':
          updateMqttStatus(data.connected);
          break;

        case 'firmware_update':
          updateFirmwareUI(data.firmware);
          break;

        case 'device_update':
          devicesMap.set(data.device.id, data.device);
          renderDevices();
          break;

        case 'ota_progress':
          devicesMap.set(data.device.id, data.device);
          renderDevices();
          if (data.device.otaStatus === 'downloading') {
            otaGlobalStatus.textContent = `🔄 Atualizando [${data.device.id}]: ${data.device.otaProgress}% concluído`;
          } else if (data.device.otaStatus === 'success') {
            otaGlobalStatus.textContent = `✅ [${data.device.id}] Atualizado com sucesso! ESP32 reiniciando.`;
            btnStartOta.disabled = false;
          } else if (data.device.otaStatus === 'error') {
            otaGlobalStatus.textContent = `❌ [${data.device.id}] Falha na atualização: ${data.device.otaMessage}`;
            btnStartOta.disabled = false;
          }
          break;

        case 'log':
          appendLog(data.log.source, data.log.message, data.log.type);
          break;
      }
    } catch (e) {
      console.error('Erro ao processar evento SSE:', e);
    }
  };

  eventSource.onerror = () => {
    updateMqttStatus(false);
  };
}

function updateMqttStatus(connected) {
  if (connected) {
    mqttStatusBadge.className = 'status-indicator online';
    mqttStatusText.textContent = 'Broker EMQX Online';
  } else {
    mqttStatusBadge.className = 'status-indicator offline';
    mqttStatusText.textContent = 'Broker Desconectado';
  }
}

// ==========================================================
// INTELIGÊNCIA ARTIFICIAL REAL (ISOLATION FOREST & ML UI)
// ==========================================================
const aiHealthScore = document.getElementById('aiHealthScore');
const aiHealthFill = document.getElementById('aiHealthFill');
const aiAnomalyScore = document.getElementById('aiAnomalyScore');
const aiAnomalyStatus = document.getElementById('aiAnomalyStatus');
const aiRegimeName = document.getElementById('aiRegimeName');
const aiModelDetails = document.getElementById('aiModelDetails');
const aiDynamicVelocity = document.getElementById('aiDynamicVelocity');
const aiDynamicJitter = document.getElementById('aiDynamicJitter');
const aiAnomaliesList = document.getElementById('aiAnomaliesList');
const btnRunAiAudit = document.getElementById('btnRunAiAudit');
const aiAuditModal = document.getElementById('aiAuditModal');
const btnCloseAiModal = document.getElementById('btnCloseAiModal');
const aiAuditContent = document.getElementById('aiAuditContent');

function updateAiUI(ai) {
  if (!ai) return;

  if (aiHealthScore && aiHealthFill) {
    aiHealthScore.textContent = `${ai.healthScore}%`;
    aiHealthFill.style.width = `${ai.healthScore}%`;
    if (ai.healthScore >= 80) {
      aiHealthFill.style.background = 'linear-gradient(90deg, #10B981, #00E5FF)';
    } else if (ai.healthScore >= 60) {
      aiHealthFill.style.background = 'linear-gradient(90deg, #F59E0B, #EF4444)';
    } else {
      aiHealthFill.style.background = '#EF4444';
    }
  }

  if (aiAnomalyScore && aiAnomalyStatus) {
    aiAnomalyScore.textContent = (ai.anomalyScore !== undefined) ? ai.anomalyScore.toFixed(3) : '0.000';
    if (ai.isAnomaly) {
      aiAnomalyStatus.textContent = '⚠️ Anomalia Isolada pelo Modelo!';
      aiAnomalyStatus.style.color = '#F87171';
    } else {
      aiAnomalyStatus.textContent = 'Nominal (Sem anomalias)';
      aiAnomalyStatus.style.color = '#94A3B8';
    }
  }

  if (aiRegimeName) {
    aiRegimeName.textContent = ai.regime || 'Nominal';
    aiRegimeName.style.color = ai.regimeColor || '#00E5FF';
  }

  if (aiModelDetails) {
    aiModelDetails.textContent = `Amostras: ${ai.totalSamples || 0} | Anomalias: ${ai.anomalyRate || '0%'}`;
  }

  if (aiDynamicVelocity) {
    aiDynamicVelocity.textContent = `${ai.velocityMmS || 0} mm/s`;
  }
  if (aiDynamicJitter) {
    aiDynamicJitter.textContent = `Jitter: ~${ai.jitterMs || 200} ms`;
  }
}

function renderAnomaliesList(anomalies) {
  if (!aiAnomaliesList) return;
  if (!anomalies || anomalies.length === 0) {
    aiAnomaliesList.innerHTML = '<div class="ai-empty-notice">Nenhuma anomalia crítica isolada no buffer de telemetria atual.</div>';
    return;
  }

  aiAnomaliesList.innerHTML = '';
  for (const item of anomalies) {
    const el = document.createElement('div');
    el.className = 'ai-anomaly-item';
    el.innerHTML = `
      <div>
        <span class="ai-anomaly-time">[${item.timestamp}]</span>
        <span class="ai-anomaly-reason">${item.reason}</span>
      </div>
      <span class="ai-anomaly-score">Score: ${item.score}</span>
    `;
    aiAnomaliesList.appendChild(el);
  }
}

// Listener para Auditoria de IA
if (btnRunAiAudit) {
  btnRunAiAudit.addEventListener('click', async () => {
    aiAuditModal.style.display = 'flex';
    aiAuditContent.innerHTML = '<p>Calculando inferência nos modelos Isolation Forest e K-Means...</p>';

    try {
      const res = await fetch('/api/ai/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'esp32s3_tof90' })
      });
      const data = await res.json();
      if (!data.success || !data.report) {
        aiAuditContent.innerHTML = '<p class="error">Falha ao gerar relatório.</p>';
        return;
      }

      const r = data.report;
      const verdictClass = r.healthScore >= 80 ? 'success' : r.healthScore >= 60 ? 'warning' : 'danger';
      const verdictIcon = r.healthScore >= 80 ? '✅' : r.healthScore >= 60 ? '⚠️' : '🚨';

      aiAuditContent.innerHTML = `
        <div class="audit-verdict-banner ${verdictClass}">
          <span>${verdictIcon}</span>
          <div>
            <div>${r.verdict}</div>
            <div style="font-size: 12px; font-weight: normal; opacity: 0.9;">Score de Saúde Geral: ${r.healthScore}% | Taxa de Anomalias: ${r.anomalyRate}</div>
          </div>
        </div>

        <div class="audit-grid">
          <div class="audit-stat-card">
            <div class="audit-stat-label">REGIME DE VOO INFERIDO</div>
            <div class="audit-stat-val" style="color: var(--accent-cyan);">${r.currentRegime}</div>
          </div>
          <div class="audit-stat-card">
            <div class="audit-stat-label">SCORE ATUAL ISOLATION FOREST</div>
            <div class="audit-stat-val">${r.anomalyScore}</div>
          </div>
          <div class="audit-stat-card">
            <div class="audit-stat-label">ALTITUDE MÉDIA / VELOCIDADE</div>
            <div class="audit-stat-val">${r.telemetryStats.avgAltitudeMm} mm / ${r.telemetryStats.avgVerticalVelocityMmS} mm/s</div>
          </div>
          <div class="audit-stat-card">
            <div class="audit-stat-label">ÁRVORES NA FLORESTA (iTrees)</div>
            <div class="audit-stat-val">${r.modelDiagnostics.trees} árvores de isolamento</div>
          </div>
        </div>

        <div class="audit-recs-title">💡 Parecer Técnico e Recomendações:</div>
        <ul class="audit-recs-list">
          ${r.recommendations.map(rec => `<li>${rec}</li>`).join('')}
        </ul>
      `;
    } catch (err) {
      aiAuditContent.innerHTML = `<p class="error">Erro ao comunicar com a API de IA: ${err.message}</p>`;
    }
  });
}

if (btnCloseAiModal) {
  btnCloseAiModal.addEventListener('click', () => {
    aiAuditModal.style.display = 'none';
  });
}
if (aiAuditModal) {
  aiAuditModal.addEventListener('click', (e) => {
    if (e.target === aiAuditModal) aiAuditModal.style.display = 'none';
  });
}

// Inicialização
setupSSE();

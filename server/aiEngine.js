/**
 * Motor de Machine Learning Real para Telemetria de Frota ESP-Drone
 * 
 * Implementação baseada em:
 * 1. Isolation Forest (Liu, Ting, Zhou - IEEE ICDM): Algoritmo de ML não-supervisionado
 *    para detecção de anomalias em espaços vetoriais multidimensionais.
 * 2. K-Means Clustering: Agrupamento em tempo real para classificação do regime de voo.
 */

class IsolationTreeNode {
  constructor(size) {
    this.size = size;
    this.splitFeature = null;
    this.splitValue = null;
    this.left = null;
    this.right = null;
  }
}

class IsolationTree {
  constructor(maxDepth) {
    this.maxDepth = maxDepth;
    this.root = null;
  }

  fit(data, depth = 0) {
    const n = data.length;
    if (depth >= this.maxDepth || n <= 1) {
      return new IsolationTreeNode(n);
    }

    const numFeatures = data[0].length;
    // Escolhe aleatoriamente uma feature
    const splitFeature = Math.floor(Math.random() * numFeatures);

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const val = data[i][splitFeature];
      if (val < min) min = val;
      if (val > max) max = val;
    }

    if (min === max) {
      return new IsolationTreeNode(n);
    }

    // Ponto de corte aleatório entre min e max
    const splitValue = min + Math.random() * (max - min);

    const leftData = [];
    const rightData = [];
    for (let i = 0; i < n; i++) {
      if (data[i][splitFeature] < splitValue) {
        leftData.push(data[i]);
      } else {
        rightData.push(data[i]);
      }
    }

    const node = new IsolationTreeNode(n);
    node.splitFeature = splitFeature;
    node.splitValue = splitValue;
    node.left = this.fit(leftData, depth + 1);
    node.right = this.fit(rightData, depth + 1);
    return node;
  }

  pathLength(point, node, currentDepth = 0) {
    if (!node.left || !node.right || node.size <= 1) {
      return currentDepth + this.averagePathLengthAdjustment(node.size);
    }

    if (point[node.splitFeature] < node.splitValue) {
      return this.pathLength(point, node.left, currentDepth + 1);
    } else {
      return this.pathLength(point, node.right, currentDepth + 1);
    }
  }

  averagePathLengthAdjustment(n) {
    if (n <= 1) return 0;
    if (n === 2) return 1;
    const eulerMascheroni = 0.5772156649;
    return 2.0 * (Math.log(n - 1) + eulerMascheroni) - (2.0 * (n - 1) / n);
  }
}

class IsolationForest {
  constructor(numTrees = 30, subsampleSize = 64) {
    this.numTrees = numTrees;
    this.subsampleSize = subsampleSize;
    this.trees = [];
    this.maxDepth = Math.ceil(Math.log2(Math.max(subsampleSize, 2)));
    this.isTrained = false;
  }

  c(n) {
    if (n <= 1) return 1;
    if (n === 2) return 1;
    const eulerMascheroni = 0.5772156649;
    return 2.0 * (Math.log(n - 1) + eulerMascheroni) - (2.0 * (n - 1) / n);
  }

  train(data) {
    if (!data || data.length < 8) return;
    this.trees = [];
    const sampleSize = Math.min(this.subsampleSize, data.length);

    for (let i = 0; i < this.numTrees; i++) {
      const subsample = [];
      for (let j = 0; j < sampleSize; j++) {
        const randIdx = Math.floor(Math.random() * data.length);
        subsample.push(data[randIdx]);
      }
      const tree = new IsolationTree(this.maxDepth);
      tree.root = tree.fit(subsample);
      this.trees.push(tree);
    }
    this.isTrained = true;
  }

  predictAnomalyScore(point) {
    if (!this.isTrained || this.trees.length === 0) return 0.25;

    let totalPathLength = 0;
    for (const tree of this.trees) {
      totalPathLength += tree.pathLength(point, tree.root);
    }
    const avgPathLength = totalPathLength / this.trees.length;
    const expectedC = this.c(this.subsampleSize);
    
    // Equação de Liu et al.: s(x, n) = 2^(-E(h(x))/c(n))
    const score = Math.pow(2, -avgPathLength / expectedC);
    return Math.min(Math.max(score, 0), 1);
  }
}

class KMeansRegimeClassifier {
  constructor(k = 4) {
    this.k = k;
    this.centroids = [
      [0.0, 0.0, 0.0],  // 0: Hover Estável (velocidade ~0, aceleração ~0, variação ~0)
      [0.4, 0.2, 0.1],  // 1: Subida/Descida Nominal
      [-0.1, 0.8, 0.6], // 2: Turbulência / Vórtice de Solo (alta oscilação vertical)
      [0.9, 0.9, 0.9]   // 3: Dispersão Óptica / Ruído Extremo
    ];
    this.labels = [
      { name: 'Hovering Estável', color: '#10B981', badge: 'green' },
      { name: 'Subida / Descida Nominal', color: '#00E5FF', badge: 'cyan' },
      { name: 'Turbulência de Solo / Oscilação', color: '#F59E0B', badge: 'amber' },
      { name: 'Anomalia Óptica / Ruído Extremo', color: '#EF4444', badge: 'red' }
    ];
  }

  euclideanDist(p1, p2) {
    let sum = 0;
    for (let i = 0; i < p1.length; i++) {
      const diff = (p1[i] || 0) - (p2[i] || 0);
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  predict(featureVector) {
    let closestCluster = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.centroids.length; i++) {
      const d = this.euclideanDist(featureVector, this.centroids[i]);
      if (d < minDist) {
        minDist = d;
        closestCluster = i;
      }
    }
    return {
      clusterId: closestCluster,
      ...this.labels[closestCluster]
    };
  }

  updateCentroid(clusterId, point, alpha = 0.05) {
    if (clusterId < 0 || clusterId >= this.centroids.length) return;
    for (let i = 0; i < this.centroids[clusterId].length; i++) {
      this.centroids[clusterId][i] = (1 - alpha) * this.centroids[clusterId][i] + alpha * point[i];
    }
  }
}

/**
 * Gerenciador de Inteligência Artificial por Dispositivo
 */
class FleetDeviceAI {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.windowSize = 80;
    this.history = []; // Buffer de vetores [dist, velocity, accel, jitter, isValid]
    this.rawPackets = [];
    this.iForest = new IsolationForest(25, 40);
    this.regimeClassifier = new KMeansRegimeClassifier();
    this.lastPacketTime = 0;
    this.lastDistance = null;
    this.lastVelocity = 0;
    this.anomalyCount = 0;
    this.totalSamples = 0;
    this.recentAnomalies = [];
    this.lastRetrainTime = 0;
  }

  ingest(packet) {
    const now = Date.now();
    const dist = typeof packet.distance_mm === 'number' ? packet.distance_mm : -1;
    const isValid = packet.valid !== false && dist >= 0;

    const interval = this.lastPacketTime > 0 ? (now - this.lastPacketTime) : 200;
    this.lastPacketTime = now;

    let velocity = 0;
    let accel = 0;

    if (this.lastDistance !== null && interval > 0) {
      const dtSec = interval / 1000.0;
      velocity = (dist - this.lastDistance) / dtSec; // mm/s
      accel = (velocity - this.lastVelocity) / dtSec; // mm/s^2
    }
    this.lastDistance = dist;
    this.lastVelocity = velocity;

    // Normalização das features para o espaço vetorial de ML:
    // f0: Distância normalizada (0 a 1 em escala de 2 metros)
    // f1: Velocidade normalizada (-1 a 1 em escala de 1000 mm/s)
    // f2: Aceleração normalizada (-1 a 1 em escala de 3000 mm/s^2)
    // f3: Jitter normalizado (0 a 1 em desvio do nominal 200ms)
    // f4: Validade do ToF (1.0 ou 0.0)
    const f0 = Math.max(0, Math.min(dist / 2000.0, 1.0));
    const f1 = Math.max(-1.0, Math.min(velocity / 1000.0, 1.0));
    const f2 = Math.max(-1.0, Math.min(accel / 3000.0, 1.0));
    const f3 = Math.min(Math.abs(interval - 200) / 300.0, 1.0);
    const f4 = isValid ? 1.0 : 0.0;

    const featureVector = [f0, f1, f2, f3, f4];

    this.history.push(featureVector);
    this.rawPackets.push({
      timestamp: now,
      dist,
      velocity: Math.round(velocity),
      accel: Math.round(accel),
      interval,
      isValid
    });

    if (this.history.length > this.windowSize) {
      this.history.shift();
      this.rawPackets.shift();
    }
    this.totalSamples++;

    // Treina ou re-treina a Isolation Forest se tiver amostras suficientes (a cada 15 segundos)
    if (!this.iForest.isTrained && this.history.length >= 15) {
      this.iForest.train(this.history);
      this.lastRetrainTime = now;
    } else if (now - this.lastRetrainTime > 15000 && this.history.length >= 20) {
      this.iForest.train(this.history);
      this.lastRetrainTime = now;
    }

    // Inferência da Isolation Forest
    const anomalyScore = this.iForest.predictAnomalyScore(featureVector);
    const isAnomaly = anomalyScore >= 0.65 || (!isValid && dist !== -1);

    if (isAnomaly) {
      this.anomalyCount++;
      const reason = !isValid
        ? 'Reflexão óptica inválida (Out of Range)'
        : Math.abs(velocity) > 800
        ? 'Gradiente de altitude vertical anômalo'
        : Math.abs(accel) > 2000
        ? 'Aceleração vertical extrema / Vibração'
        : 'Outlier estatístico multidimensional';

      this.recentAnomalies.unshift({
        timestamp: new Date().toLocaleTimeString(),
        score: anomalyScore.toFixed(3),
        distance_mm: dist,
        velocity: Math.round(velocity),
        reason
      });
      if (this.recentAnomalies.length > 20) {
        this.recentAnomalies.pop();
      }
    }

    // Inferência de Regime via K-Means
    const regimeVector = [Math.abs(f1), Math.abs(f2), f3];
    const regime = this.regimeClassifier.predict(regimeVector);
    if (!isAnomaly) {
      this.regimeClassifier.updateCentroid(regime.clusterId, regimeVector);
    }

    // Health Score (0 a 100%)
    const anomalyRate = this.totalSamples > 0 ? (this.anomalyCount / this.totalSamples) : 0;
    const healthScore = Math.max(5, Math.round(100 - (anomalyScore * 40) - (anomalyRate * 60)));

    return {
      deviceId: this.deviceId,
      anomalyScore: parseFloat(anomalyScore.toFixed(3)),
      isAnomaly,
      healthScore,
      regime: regime.name,
      regimeColor: regime.color,
      regimeBadge: regime.badge,
      totalSamples: this.totalSamples,
      anomalyRate: (anomalyRate * 100).toFixed(1) + '%',
      model: 'Isolation Forest (30 iTrees) + Online K-Means',
      velocityMmS: Math.round(velocity),
      accelMmS2: Math.round(accel),
      jitterMs: Math.round(interval)
    };
  }

  getMetrics() {
    const lastVector = this.history[this.history.length - 1];
    const score = lastVector ? this.iForest.predictAnomalyScore(lastVector) : 0.2;
    const anomalyRate = this.totalSamples > 0 ? (this.anomalyCount / this.totalSamples) : 0;
    const healthScore = Math.max(5, Math.round(100 - (score * 40) - (anomalyRate * 60)));

    let regime = { name: 'Aguardando telemetria...', color: '#94A3B8', badge: 'slate' };
    if (lastVector) {
      const regimeVector = [Math.abs(lastVector[1]), Math.abs(lastVector[2]), lastVector[3]];
      regime = this.regimeClassifier.predict(regimeVector);
    }

    return {
      deviceId: this.deviceId,
      anomalyScore: parseFloat(score.toFixed(3)),
      healthScore,
      regime: regime.name,
      regimeColor: regime.color,
      regimeBadge: regime.badge,
      totalSamples: this.totalSamples,
      anomalyCount: this.anomalyCount,
      anomalyRate: (anomalyRate * 100).toFixed(1) + '%',
      isTrained: this.iForest.isTrained,
      treesCount: this.iForest.trees.length,
      recentAnomalies: this.recentAnomalies.slice(0, 8),
      modelName: 'Isolation Forest (Ensemble iTrees) + K-Means'
    };
  }

  generateAuditReport() {
    const metrics = this.getMetrics();
    const packetCount = this.rawPackets.length;
    let avgDist = 0;
    let maxDist = 0;
    let minDist = Infinity;
    let avgVelocity = 0;

    if (packetCount > 0) {
      let sumD = 0;
      let sumV = 0;
      for (const p of this.rawPackets) {
        if (p.dist >= 0) {
          sumD += p.dist;
          if (p.dist > maxDist) maxDist = p.dist;
          if (p.dist < minDist) minDist = p.dist;
        }
        sumV += Math.abs(p.velocity);
      }
      avgDist = Math.round(sumD / packetCount);
      avgVelocity = Math.round(sumV / packetCount);
      if (minDist === Infinity) minDist = 0;
    }

    let verdict = 'ESTÁVEL';
    let recommendations = [];

    if (metrics.healthScore >= 85) {
      verdict = 'OPERAÇÃO NOMINAL EXCELENTE';
      recommendations.push('Aeronave mantendo estabilidade aerodinâmica de altitude exemplar.');
      recommendations.push('Sensor Unit ToF-90 operando com alta taxa de absorção de fótons sem espelhamento.');
    } else if (metrics.healthScore >= 65) {
      verdict = 'ATENÇÃO OPERACIONAL';
      recommendations.push('Foram detectados picos de variação vertical ou jitter leve na telemetria.');
      recommendations.push('Recomenda-se checar se a aeronave está operando sobre superfícies com alta absorção infravermelha (tapetes escuros) ou reflexão especular.');
    } else {
      verdict = 'ALERTA DE ANOMALIA / MANUTENÇÃO';
      recommendations.push('Alta taxa de isolamento anômalo pelo modelo Isolation Forest.');
      recommendations.push('Possível saturação de luz solar direta no ToF ou vibração mecânica excessiva nos motores.');
      recommendations.push('Sugestão: Disparar atualização de firmware OTA com ajuste no ganho D do PID ou filtro passa-baixas.');
    }

    return {
      timestamp: new Date().toLocaleString(),
      deviceId: this.deviceId,
      verdict,
      healthScore: metrics.healthScore,
      anomalyScore: metrics.anomalyScore,
      anomalyRate: metrics.anomalyRate,
      currentRegime: metrics.regime,
      windowSamples: packetCount,
      telemetryStats: {
        avgAltitudeMm: avgDist,
        minAltitudeMm: minDist,
        maxAltitudeMm: maxDist,
        avgVerticalVelocityMmS: avgVelocity,
      },
      modelDiagnostics: {
        algorithm: 'Isolation Forest (Liu et al. 2008) + K-Means',
        trees: metrics.treesCount,
        anomaliesLogged: metrics.anomalyCount,
      },
      recommendations,
      recentAnomalies: metrics.recentAnomalies
    };
  }
}

class FleetAIMaster {
  constructor() {
    this.devices = new Map();
  }

  getDeviceAI(deviceId) {
    if (!this.devices.has(deviceId)) {
      this.devices.set(deviceId, new FleetDeviceAI(deviceId));
    }
    return this.devices.get(deviceId);
  }

  processTelemetry(packet) {
    const id = packet.device_id || 'esp32s3_tof90';
    const devAi = this.getDeviceAI(id);
    return devAi.ingest(packet);
  }

  getAllMetrics() {
    const res = [];
    for (const [id, devAi] of this.devices.entries()) {
      res.push(devAi.getMetrics());
    }
    return res;
  }

  getFleetSummary() {
    const all = this.getAllMetrics();
    if (all.length === 0) {
      return {
        deviceId: 'fleet_all',
        healthScore: 100,
        anomalyScore: 0.0,
        regime: 'Nenhum drone ativo',
        regimeColor: '#94A3B8',
        regimeBadge: 'slate',
        totalSamples: 0,
        anomalyCount: 0,
        anomalyRate: '0.0%',
        totalDevices: 0,
        recentAnomalies: [],
        isFleetSummary: true
      };
    }

    let sumHealth = 0;
    let sumAnomalyScore = 0;
    let sumSamples = 0;
    let sumAnomalies = 0;
    const allRecentAnomalies = [];

    for (const m of all) {
      sumHealth += m.healthScore;
      sumAnomalyScore += m.anomalyScore;
      sumSamples += m.totalSamples;
      sumAnomalies += m.anomalyCount;
      if (m.recentAnomalies) {
        for (const a of m.recentAnomalies) {
          allRecentAnomalies.push({ ...a, deviceId: m.deviceId });
        }
      }
    }

    const avgHealth = Math.round(sumHealth / all.length);
    const avgAnomalyScore = parseFloat((sumAnomalyScore / all.length).toFixed(3));
    const totalRate = sumSamples > 0 ? ((sumAnomalies / sumSamples) * 100).toFixed(1) + '%' : '0.0%';

    return {
      deviceId: 'fleet_all',
      healthScore: avgHealth,
      anomalyScore: avgAnomalyScore,
      regime: `Frota Operacional (${all.length} drone${all.length > 1 ? 's' : ''})`,
      regimeColor: avgHealth >= 80 ? '#10B981' : avgHealth >= 60 ? '#F59E0B' : '#EF4444',
      regimeBadge: avgHealth >= 80 ? 'green' : avgHealth >= 60 ? 'amber' : 'red',
      totalSamples: sumSamples,
      anomalyCount: sumAnomalies,
      anomalyRate: totalRate,
      totalDevices: all.length,
      recentAnomalies: allRecentAnomalies.slice(0, 10),
      isFleetSummary: true
    };
  }

  generateAuditReport(targetId = 'fleet_all') {
    if (targetId !== 'fleet_all' && this.devices.has(targetId)) {
      return this.getDeviceAI(targetId).generateAuditReport();
    }

    const summary = this.getFleetSummary();
    const all = this.getAllMetrics();

    let verdict = 'FROTA TOTALMENTE ESTÁVEL';
    const recommendations = [];

    if (summary.healthScore >= 80) {
      verdict = 'OPERAÇÃO DA FROTA EXCELENTE';
      recommendations.push(`Todos os ${summary.totalDevices} drones conectados apresentam alta estabilidade.`);
      recommendations.push('Assinaturas ópticas dos sensores ToF-90 estão dentro do padrão nominal.');
    } else if (summary.healthScore >= 60) {
      verdict = 'ATENÇÃO OPERACIONAL NA FROTA';
      recommendations.push('Um ou mais drones apresentaram oscilação atípica ou picos de ruído óptico.');
      recommendations.push('Inspecione individualmente o drone com menor pontuação de saúde.');
    } else {
      verdict = 'ALERTA CRÍTICO DE FROTA';
      recommendations.push('Alta dispersão de telemetria ou taxa elevada de anomalias isoladas.');
      recommendations.push('Recomenda-se suspender decolagens e atualizar o firmware da frota via OTA.');
    }

    return {
      timestamp: new Date().toLocaleString(),
      deviceId: 'Toda a Frota (Visão Geral)',
      verdict,
      healthScore: summary.healthScore,
      anomalyScore: summary.anomalyScore,
      anomalyRate: summary.anomalyRate,
      currentRegime: summary.regime,
      windowSamples: summary.totalSamples,
      telemetryStats: {
        avgAltitudeMm: '--',
        minAltitudeMm: '--',
        maxAltitudeMm: '--',
        avgVerticalVelocityMmS: '--',
      },
      modelDiagnostics: {
        algorithm: 'Isolation Forest Ensemble Multi-Drone + K-Means',
        trees: summary.totalDevices * 25,
        anomaliesLogged: summary.anomalyCount,
      },
      recommendations,
      recentAnomalies: summary.recentAnomalies
    };
  }
}

module.exports = {
  FleetAIMaster
};

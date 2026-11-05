/**
 * Serviço de Inteligência Artificial e Análise Inteligente de Telemetria
 * 
 * Executa análise heurística / Edge AI em tempo real nos dados de voo e
 * gera relatórios diagnósticos de estabilidade e recomendações para o piloto.
 */

export interface TelemetryAnomaly {
  type: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  description: string;
  timestamp: number;
}

export interface FlightDiagnosticReport {
  stabilityScore: number; // 0 a 100
  flightStatus: 'POUSADO' | 'SUBINDO' | 'DESCENDO' | 'ESTAVEL' | 'TURBULENTO';
  avgAltitudeMm: number;
  maxAltitudeMm: number;
  minAltitudeMm: number;
  variabilityMm: number;
  aiRecommendations: string[];
}

export class AiTelemetryEngine {
  private history: { altitude: number; timestamp: number }[] = [];
  private readonly maxSamples = 30;

  /**
   * Adiciona uma amostra de telemetria ao modelo de análise
   */
  public addSample(altitudeMm: number, timestamp = Date.now()): TelemetryAnomaly | null {
    if (altitudeMm < 0) return null;

    this.history.push({ altitude: altitudeMm, timestamp });
    if (this.history.length > this.maxSamples) {
      this.history.shift();
    }

    return this.detectInstantAnomaly(altitudeMm);
  }

  /**
   * Detecta anomalias instantâneas baseadas nas últimas amostras
   */
  private detectInstantAnomaly(currentAlt: number): TelemetryAnomaly | null {
    if (this.history.length < 3) return null;

    const n = this.history.length;
    const prev = this.history[n - 2].altitude;
    const deltaAlt = currentAlt - prev;

    // Alerta de proximidade crítica do solo
    if (currentAlt > 0 && currentAlt < 80) {
      return {
        type: 'WARNING',
        title: 'Proximidade Crítica do Solo',
        description: `Altitude muito baixa (${currentAlt} mm). Risco iminente de colisão ou efeito solo.`,
        timestamp: Date.now(),
      };
    }

    // Alerta de queda / descida abrupta (> 300 mm de diferença entre amostras consecutivas)
    if (deltaAlt < -350) {
      return {
        type: 'CRITICAL',
        title: 'Queda Abrupta Detectada',
        description: `Variação descendente de ${Math.abs(deltaAlt)} mm detectada. Verifique empuxo dos motores!`,
        timestamp: Date.now(),
      };
    }

    // Alerta de subida excessivamente rápida
    if (deltaAlt > 400) {
      return {
        type: 'INFO',
        title: 'Taxa de Subida Elevada',
        description: `Subida acelerada (+${deltaAlt} mm). Atenção aos limites do teto de voo.`,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Gera um relatório completo de diagnóstico com IA Copilot
   */
  public generateFlightReport(maxAlt: number, minAlt: number): FlightDiagnosticReport {
    if (this.history.length === 0) {
      return {
        stabilityScore: 100,
        flightStatus: 'POUSADO',
        avgAltitudeMm: 0,
        maxAltitudeMm: maxAlt,
        minAltitudeMm: minAlt,
        variabilityMm: 0,
        aiRecommendations: ['Aguardando dados de voo para diagnóstico.'],
      };
    }

    const altitudes = this.history.map((h) => h.altitude);
    const sum = altitudes.reduce((acc, v) => acc + v, 0);
    const avg = sum / altitudes.length;

    // Cálculo do Desvio Padrão (Variabilidade/Oscilação)
    const variance =
      altitudes.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / altitudes.length;
    const stdDev = Math.sqrt(variance);

    // Score de estabilidade baseado na variabilidade do ToF
    let score = Math.max(0, Math.min(100, Math.round(100 - stdDev * 0.4)));

    let status: FlightDiagnosticReport['flightStatus'] = 'ESTAVEL';
    if (avg < 50) {
      status = 'POUSADO';
    } else if (stdDev > 120) {
      status = 'TURBULENTO';
    } else {
      const recentTrend = altitudes[altitudes.length - 1] - altitudes[0];
      if (recentTrend > 150) status = 'SUBINDO';
      else if (recentTrend < -150) status = 'DESCENDO';
    }

    const recommendations: string[] = [];

    if (status === 'TURBULENTO') {
      recommendations.push(
        'Alta oscilação de altitude (±' + Math.round(stdDev) + 'mm). Sugere-se calibrar os ganhos derivativos (Kd) da malha de altitude no firmware.'
      );
      recommendations.push(
        'Verifique se a superfície refletora do solo possui desníveis ou textura irregular para o sensor ToF 90°.'
      );
    } else if (status === 'ESTAVEL') {
      recommendations.push('Malha de altitude perfeitamente estabilizada dentro do envelope de voo ideal.');
    }

    if (minAlt > 0 && minAlt < 60) {
      recommendations.push('Detecção de voo rasante em efeito solo. Recomenda-se manter pelo menos 15cm do piso.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Parâmetros de voo em conformidade operacional normal.');
    }

    return {
      stabilityScore: score,
      flightStatus: status,
      avgAltitudeMm: Math.round(avg),
      maxAltitudeMm: maxAlt,
      minAltitudeMm: minAlt,
      variabilityMm: Math.round(stdDev),
      aiRecommendations: recommendations,
    };
  }

  public reset() {
    this.history = [];
  }
}

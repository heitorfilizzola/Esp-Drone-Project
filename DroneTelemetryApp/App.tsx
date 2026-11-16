import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  Dimensions,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { connectToDroneMQTT, TelemetryPayload } from './src/services/mqttService';
import {
  AiTelemetryEngine,
  TelemetryAnomaly,
  FlightDiagnosticReport,
} from './src/services/aiTelemetryService';
import * as DocumentPicker from 'expo-document-picker';
import {
  uploadFirmwareToESP,
  checkEspOtaStatus,
  OtaProgress,
  EspStatusResult,
} from './src/services/otaService';

interface SelectedFirmware {
  name: string;
  size?: number;
  uri: string;
  blob?: Blob;
}

const MAX_HISTORY_POINTS = 12;
const screenWidth = Dimensions.get('window').width;

export default function App() {
  const [activeTab, setActiveTab] = useState<'TELEMETRIA' | 'OTA' | 'IA'>('TELEMETRIA');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<TelemetryPayload>({
    distance_mm: 0,
    distance_cm: 0,
    valid: true,
    battery: 100,
  });
  const [altitudeHistory, setAltitudeHistory] = useState<number[]>([0]);

  // --- REQUISITO 2: Altitude Máxima e Mínima ---
  const [maxAltitude, setMaxAltitude] = useState<number | null>(null);
  const [minAltitude, setMinAltitude] = useState<number | null>(null);

  const [espIp, setEspIp] = useState<string>(
    process.env.EXPO_PUBLIC_ESP_IP || '192.168.1.6'
  );
  const [otaProgress, setOtaProgress] = useState<OtaProgress>({
    percentage: 0,
    loadedBytes: 0,
    totalBytes: 0,
    status: 'idle',
  });
  const [otaLog, setOtaLog] = useState<string>('Pronto para envio de firmware.');
  const [selectedFirmware, setSelectedFirmware] = useState<SelectedFirmware | null>(null);
  const [isCheckingEsp, setIsCheckingEsp] = useState<boolean>(false);
  const [espCheckResult, setEspCheckResult] = useState<EspStatusResult | null>(null);

  // --- REQUISITO 4: Inteligência Artificial (Edge AI & Copilot) ---
  const aiEngine = useRef(new AiTelemetryEngine()).current;
  const [latestAnomaly, setLatestAnomaly] = useState<TelemetryAnomaly | null>(null);
  const [aiReport, setAiReport] = useState<FlightDiagnosticReport | null>(null);

  useEffect(() => {
    const client = connectToDroneMQTT(
      (data) => {
        const currentAlt =
          data.distance_mm ??
          data.altitude ??
          (data.distance_cm != null ? data.distance_cm * 10 : 0);

        setTelemetry((prev) => ({ ...prev, ...data }));

        if (data.valid !== false && currentAlt >= 0) {
          // Atualiza Altitude Máxima e Mínima
          setMaxAltitude((prevMax) =>
            prevMax === null ? currentAlt : Math.max(prevMax, currentAlt)
          );
          setMinAltitude((prevMin) =>
            prevMin === null ? currentAlt : Math.min(prevMin, currentAlt)
          );

          // Atualiza histórico do gráfico
          setAltitudeHistory((prevHistory) => {
            const updated = [...prevHistory, currentAlt];
            return updated.slice(-MAX_HISTORY_POINTS);
          });

          // Analisador de IA em tempo real para anomalias
          const anomaly = aiEngine.addSample(currentAlt);
          if (anomaly) {
            setLatestAnomaly(anomaly);
          }
        }
      },
      (status) => setIsConnected(status)
    );

    return () => {
      if (client) client.end();
    };
  }, []);

  const distanceMm = telemetry.distance_mm ?? telemetry.altitude ?? 0;
  const distanceCm = telemetry.distance_cm ?? distanceMm / 10;
  const isValid = telemetry.valid !== false;

  // Função para resetar estatísticas de altitude (Max/Min)
  const handleResetMetrics = () => {
    setMaxAltitude(isValid && distanceMm > 0 ? distanceMm : null);
    setMinAltitude(isValid && distanceMm > 0 ? distanceMm : null);
    aiEngine.reset();
    setLatestAnomaly(null);
    setAiReport(null);
  };

  // Função para selecionar arquivo de firmware (.bin)
  const handlePickFirmware = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const isBin = asset.name.toLowerCase().endsWith('.bin');
        setSelectedFirmware({
          name: asset.name,
          size: asset.size,
          uri: asset.uri,
          blob: asset.file,
        });
        const sizeStr = asset.size ? ` (${(asset.size / 1024).toFixed(1)} KB)` : '';
        if (!isBin) {
          setOtaLog(`Aviso: '${asset.name}' pode não ser um binário válido. Esperado arquivo .bin.`);
        } else if (asset.size && asset.size < 100000) {
          setOtaLog(
            `⚠️ Atenção: '${asset.name}' tem apenas ${(asset.size / 1024).toFixed(
              1
            )} KB. Um binário do ESP32 deve ter ~800 KB. Verifique se o arquivo não foi corrompido.`
          );
        } else {
          setOtaLog(`Arquivo selecionado: ${asset.name}${sizeStr}. Pronto para upload.`);
        }
      }
    } catch (error: any) {
      setOtaLog(`Erro ao selecionar arquivo: ${error?.message || error}`);
    }
  };

  // Função para testar a conectividade HTTP com o ESP32 (Ping / Status)
  const handleTestEspConnection = async () => {
    if (!espIp.trim()) {
      setOtaLog('Informe o endereço IP do ESP32 para testar a conexão.');
      return;
    }
    setIsCheckingEsp(true);
    setOtaLog(`Testando conexão com ESP32 em http://${espIp}/status...`);
    const res = await checkEspOtaStatus(espIp);
    setIsCheckingEsp(false);
    setEspCheckResult(res);
    setOtaLog(res.message);
  };

  // Função para acionar o upload OTA
  const handleStartOta = async () => {
    if (!selectedFirmware) {
      setOtaLog('Erro: Selecione um arquivo de firmware (.bin) antes de iniciar a gravação.');
      return;
    }
    if (!espIp.trim()) {
      setOtaLog('Erro: Informe o endereço IP do ESP32 na rede Wi-Fi.');
      return;
    }

    setOtaLog(`Iniciando transmissão de ${selectedFirmware.name} para http://${espIp}/update...`);
    const result = await uploadFirmwareToESP({
      espIp,
      firmwareUri: selectedFirmware.uri,
      firmwareBlob: selectedFirmware.blob,
      firmwareName: selectedFirmware.name,
      onProgress: (p) => setOtaProgress(p),
    });
    setOtaLog(result.message);
  };

  // Função para acionar diagnóstico com IA Copilot
  const handleGenerateAiReport = () => {
    const report = aiEngine.generateFlightReport(maxAltitude ?? 0, minAltitude ?? 0);
    setAiReport(report);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.header}>ESP-Drone Mission Control</Text>

        {/* Barra de Navegação entre Seções */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'TELEMETRIA' && styles.tabButtonActive]}
            onPress={() => setActiveTab('TELEMETRIA')}
          >
            <Text style={[styles.tabText, activeTab === 'TELEMETRIA' && styles.tabTextActive]}>
              Telemetria
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'OTA' && styles.tabButtonActive]}
            onPress={() => setActiveTab('OTA')}
          >
            <Text style={[styles.tabText, activeTab === 'OTA' && styles.tabTextActive]}>
              OTA Firmware
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'IA' && styles.tabButtonActive]}
            onPress={() => setActiveTab('IA')}
          >
            <Text style={[styles.tabText, activeTab === 'IA' && styles.tabTextActive]}>
              IA Copilot
            </Text>
          </TouchableOpacity>
        </View>

        {/* Card de Conexão com o Broker EMQX */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status de Conexão IoT (EMQX)</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#00E676' : '#FF1744' },
              ]}
            />
            <Text style={styles.statusText}>
              {isConnected ? 'Broker EMQX Conectado' : 'Desconectado do Broker'}
            </Text>
          </View>
          {telemetry.device_id && (
            <Text style={styles.deviceInfo}>
              Dispositivo: {telemetry.device_id} | Sensor: {telemetry.sensor ?? 'ToF-90'} | Bateria:{' '}
              {telemetry.battery ?? 100}%
            </Text>
          )}
        </View>

        {/* ============================================================== */}
        {/* ABA 1: TELEMETRIA EM TEMPO REAL & ALTITUDE MAX / MIN           */}
        {/* ============================================================== */}
        {activeTab === 'TELEMETRIA' && (
          <>
            {/* Banner de Anomalia em Tempo Real da IA */}
            {latestAnomaly && (
              <View
                style={[
                  styles.alertBanner,
                  latestAnomaly.type === 'CRITICAL'
                    ? styles.alertCritical
                    : latestAnomaly.type === 'WARNING'
                    ? styles.alertWarning
                    : styles.alertInfo,
                ]}
              >
                <Text style={styles.alertTitle}>⚠️ IA Alerta: {latestAnomaly.title}</Text>
                <Text style={styles.alertText}>{latestAnomaly.description}</Text>
              </View>
            )}

            {/* Altitude Atual e Status */}
            <View style={styles.metricsRow}>
              <View style={[styles.card, styles.metricCard]}>
                <Text style={styles.cardTitle}>Altitude Atual</Text>
                <Text style={styles.metricValue}>
                  {isValid ? distanceMm : '--'} <Text style={styles.unit}>mm</Text>
                </Text>
                <Text style={styles.secondaryValue}>
                  {isValid ? `${distanceCm.toFixed(1)} cm` : 'Fora de alcance'}
                </Text>
              </View>

              <View style={[styles.card, styles.metricCard]}>
                <Text style={styles.cardTitle}>Status do ToF-90</Text>
                <Text
                  style={[
                    styles.metricValue,
                    { fontSize: 20, color: isValid ? '#00E676' : '#FFA726', marginTop: 4 },
                  ]}
                >
                  {isValid ? 'ONLINE' : 'SEM SINAL'}
                </Text>
                <Text style={styles.secondaryValue}>Campo de Visão: 90° FOV</Text>
              </View>
            </View>

            {/* ITEM 2: ALTITUDE MÁXIMA E MÍNIMA REGISTRADAS */}
            <View style={styles.metricsRow}>
              <View style={[styles.card, styles.metricCard, styles.statHighlightCard]}>
                <Text style={styles.cardTitle}>▲ Altitude Máxima</Text>
                <Text style={[styles.metricValue, { color: '#00E5FF' }]}>
                  {maxAltitude !== null ? maxAltitude : '--'} <Text style={styles.unit}>mm</Text>
                </Text>
                <Text style={styles.secondaryValue}>
                  {maxAltitude !== null ? `${(maxAltitude / 10).toFixed(1)} cm` : '--'}
                </Text>
              </View>

              <View style={[styles.card, styles.metricCard, styles.statHighlightCard]}>
                <Text style={styles.cardTitle}>▼ Altitude Mínima</Text>
                <Text style={[styles.metricValue, { color: '#FFD600' }]}>
                  {minAltitude !== null ? minAltitude : '--'} <Text style={styles.unit}>mm</Text>
                </Text>
                <Text style={styles.secondaryValue}>
                  {minAltitude !== null ? `${(minAltitude / 10).toFixed(1)} cm` : '--'}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.resetButton} onPress={handleResetMetrics}>
              <Text style={styles.resetButtonText}>🔄 Resetar Altitude Min / Max</Text>
            </TouchableOpacity>

            {/* Gráfico de Altitude em Tempo Real */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Variação da Altitude em Tempo Real (mm)</Text>
              <LineChart
                data={{
                  labels: [],
                  datasets: [{ data: altitudeHistory.length > 0 ? altitudeHistory : [0] }],
                }}
                width={screenWidth - 64}
                height={200}
                chartConfig={{
                  backgroundColor: '#1E1E1E',
                  backgroundGradientFrom: '#1E1E1E',
                  backgroundGradientTo: '#1E1E1E',
                  decimalPlaces: 0,
                  color: (opacity = 1) => `rgba(0, 229, 255, ${opacity})`,
                  labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
                  propsForDots: { r: '4', strokeWidth: '2', stroke: '#00E5FF' },
                }}
                bezier
                style={styles.chart}
              />
            </View>
          </>
        )}

        {/* ============================================================== */}
        {/* ABA 2: GERENCIAMENTO DE ATUALIZAÇÃO OTA (OVER-THE-AIR)         */}
        {/* ============================================================== */}
        {activeTab === 'OTA' && (
          <View style={styles.card}>
            <Text style={styles.sectionHeading}>Atualização de Firmware (OTA)</Text>
            <Text style={styles.descriptionText}>
              Transfira o binário compilado (.bin) do firmware diretamente para o ESP32 via
              Wi-Fi sem necessidade de conectar cabo USB.
            </Text>

            {/* Configuração de IP do ESP32 */}
            <Text style={styles.inputLabel}>Endereço IP do ESP32 na Rede Wi-Fi:</Text>
            <View style={styles.ipInputRow}>
              <TextInput
                style={[styles.textInput, styles.ipInputFlex]}
                value={espIp}
                onChangeText={(val) => {
                  setEspIp(val);
                  setEspCheckResult(null);
                }}
                placeholder="ex: 192.168.0.22"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
              <TouchableOpacity
                style={[styles.pingButton, isCheckingEsp && styles.buttonDisabled]}
                onPress={handleTestEspConnection}
                disabled={isCheckingEsp || otaProgress.status === 'uploading'}
              >
                {isCheckingEsp ? (
                  <ActivityIndicator size="small" color="#00E5FF" />
                ) : (
                  <Text style={styles.pingButtonText}>Testar Ping</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Feedback do Teste de Conexão */}
            {espCheckResult && (
              <View
                style={[
                  styles.statusBadge,
                  espCheckResult.online ? styles.statusBadgeOnline : styles.statusBadgeOffline,
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    espCheckResult.online ? styles.statusTextOnline : styles.statusTextOffline,
                  ]}
                >
                  {espCheckResult.online ? '🟢 ' : '🔴 '}
                  {espCheckResult.message}
                </Text>
              </View>
            )}

            {/* Seletor de Arquivo de Firmware */}
            <Text style={styles.inputLabel}>Arquivo de Firmware (.bin):</Text>
            <TouchableOpacity
              style={[
                styles.filePickerButton,
                otaProgress.status === 'uploading' && styles.buttonDisabled,
              ]}
              onPress={handlePickFirmware}
              disabled={otaProgress.status === 'uploading'}
            >
              <Text style={styles.filePickerButtonText}>
                {selectedFirmware ? '🔄 Trocar Arquivo .bin' : '📁 Selecionar Arquivo de Firmware (.bin)'}
              </Text>
            </TouchableOpacity>

            {selectedFirmware ? (
              <View style={styles.selectedFileBox}>
                <View style={styles.fileIconBox}>
                  <Text style={styles.fileIcon}>📄</Text>
                </View>
                <View style={styles.fileDetails}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {selectedFirmware.name}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {selectedFirmware.size
                      ? `${(selectedFirmware.size / 1024).toFixed(1)} KB`
                      : 'Tamanho não determinado'}{' '}
                    • Binário pronto
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedFirmware(null)}
                  disabled={otaProgress.status === 'uploading'}
                  style={styles.fileRemoveButton}
                >
                  <Text style={styles.fileRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.filePlaceholderBox}>
                <Text style={styles.filePlaceholderText}>
                  Nenhum arquivo selecionado. Selecione o firmware gerado pelo PlatformIO (.pio/build/.../firmware.bin).
                </Text>
              </View>
            )}

            {/* Painel de Status do Envio OTA */}
            <View style={styles.otaStatusBox}>
              <Text style={styles.otaStatusLabel}>Status da Gravação OTA:</Text>
              <Text style={styles.otaStatusValue}>
                {otaProgress.status === 'uploading'
                  ? `Transmitindo: ${otaProgress.percentage}% (${(otaProgress.loadedBytes / 1024).toFixed(0)} / ${(otaProgress.totalBytes / 1024).toFixed(0)} KB)`
                  : otaProgress.status === 'verifying'
                  ? 'Verificando Hash e Gravando na Flash...'
                  : otaProgress.status === 'success'
                  ? 'Concluído com Sucesso! ESP32 Reiniciando.'
                  : otaProgress.status === 'error'
                  ? 'Erro na Atualização'
                  : 'Aguardando Início'}
              </Text>

              {/* Barra de Progresso Customizada */}
              <View style={styles.progressBarBackground}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${otaProgress.percentage}%`,
                      backgroundColor:
                        otaProgress.status === 'error'
                          ? '#FF1744'
                          : otaProgress.status === 'success'
                          ? '#00E676'
                          : '#00E5FF',
                    },
                  ]}
                />
              </View>
              <Text style={styles.logText}>{otaLog}</Text>
            </View>

            {/* Botão de Envio */}
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (otaProgress.status === 'uploading' || !selectedFirmware) && styles.buttonDisabled,
              ]}
              onPress={handleStartOta}
              disabled={otaProgress.status === 'uploading' || !selectedFirmware}
            >
              {otaProgress.status === 'uploading' ? (
                <View style={styles.uploadingButtonContent}>
                  <ActivityIndicator color="#000" size="small" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryButtonText}>Gravando na Flash...</Text>
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>
                  {selectedFirmware ? '🚀 Iniciar Gravação OTA no ESP32' : '⚠️ Selecione o Arquivo .bin Primeiro'}
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>⚠️ Trava de Segurança Crítica:</Text>
              <Text style={styles.warningText}>
                O OTA reinicia o ESP32 imediatamente após a gravação. NUNCA realize atualização OTA
                com os motores armados ou drone em voo.
              </Text>
            </View>
          </View>
        )}

        {/* ============================================================== */}
        {/* ABA 3: INTELIGÊNCIA ARTIFICIAL (DIAGNÓSTICO E COPILOT)         */}
        {/* ============================================================== */}
        {activeTab === 'IA' && (
          <View style={styles.card}>
            <Text style={styles.sectionHeading}>IA Copilot & Telemetria Inteligente</Text>
            <Text style={styles.descriptionText}>
              Analisa em tempo real a variabilidade do sensor ToF-90, estabilidade vertical e
              identifica automaticamente anomalias aerodinâmicas ou de superfície.
            </Text>

            <TouchableOpacity style={styles.primaryButton} onPress={handleGenerateAiReport}>
              <Text style={styles.primaryButtonText}>🧠 Gerar Diagnóstico com IA</Text>
            </TouchableOpacity>

            {aiReport ? (
              <View style={styles.reportContainer}>
                <View style={styles.reportScoreRow}>
                  <View style={styles.scoreCircle}>
                    <Text style={styles.scoreNumber}>{aiReport.stabilityScore}%</Text>
                    <Text style={styles.scoreLabel}>Estabilidade</Text>
                  </View>
                  <View style={styles.reportSummary}>
                    <Text style={styles.reportItem}>
                      Estado do Voo:{' '}
                      <Text style={{ color: '#00E5FF', fontWeight: 'bold' }}>
                        {aiReport.flightStatus}
                      </Text>
                    </Text>
                    <Text style={styles.reportItem}>
                      Altitude Média: <Text style={{ color: '#FFF' }}>{aiReport.avgAltitudeMm} mm</Text>
                    </Text>
                    <Text style={styles.reportItem}>
                      Oscilação (Desvio): <Text style={{ color: '#FFF' }}>±{aiReport.variabilityMm} mm</Text>
                    </Text>
                  </View>
                </View>

                <Text style={styles.subheading}>Recomendações da IA:</Text>
                {aiReport.aiRecommendations.map((rec, idx) => (
                  <View key={idx} style={styles.recommendationItem}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.recommendationText}>{rec}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  Pressione o botão acima para analisar a estabilidade das leituras atuais de altitude.
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 16,
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  /* Abas */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#00E5FF',
  },
  tabText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#000',
    fontWeight: 'bold',
  },

  /* Cards */
  card: { backgroundColor: '#1E1E1E', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { color: '#888', fontSize: 12, textTransform: 'uppercase', marginBottom: 8 },
  sectionHeading: { fontSize: 18, fontWeight: 'bold', color: '#00E5FF', marginBottom: 8 },
  subheading: { fontSize: 14, fontWeight: 'bold', color: '#FFF', marginTop: 14, marginBottom: 6 },
  descriptionText: { color: '#BBB', fontSize: 13, lineHeight: 18, marginBottom: 16 },

  /* Status Conexão */
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  deviceInfo: { color: '#888', fontSize: 12, marginTop: 6 },

  /* Métricas */
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metricCard: { width: '48%', alignItems: 'center', paddingVertical: 14 },
  statHighlightCard: { borderColor: '#2A2A2A', borderWidth: 1 },
  metricValue: { color: '#00E5FF', fontSize: 26, fontWeight: 'bold' },
  secondaryValue: { color: '#BBB', fontSize: 12, marginTop: 4 },
  unit: { fontSize: 13, color: '#FFF' },
  chart: { marginTop: 8, borderRadius: 8 },

  /* Botão de Reset */
  resetButton: {
    backgroundColor: '#262626',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  resetButtonText: { color: '#FFF', fontSize: 13, fontWeight: '600' },

  /* Alertas da IA */
  alertBanner: { padding: 12, borderRadius: 8, marginBottom: 16 },
  alertCritical: { backgroundColor: '#B71C1C' },
  alertWarning: { backgroundColor: '#E65100' },
  alertInfo: { backgroundColor: '#01579B' },
  alertTitle: { color: '#FFF', fontWeight: 'bold', fontSize: 14, marginBottom: 2 },
  alertText: { color: '#FFF', fontSize: 12 },

  /* Formulários e OTA */
  inputLabel: { color: '#DDD', fontSize: 13, marginBottom: 6 },
  ipInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  ipInputFlex: { flex: 1, marginBottom: 0, marginRight: 8 },
  pingButton: {
    backgroundColor: '#1E1E1E',
    borderColor: '#00E5FF',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pingButtonText: { color: '#00E5FF', fontSize: 13, fontWeight: 'bold' },
  statusBadge: { padding: 10, borderRadius: 8, marginBottom: 14 },
  statusBadgeOnline: {
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    borderColor: '#00E676',
    borderWidth: 1,
  },
  statusBadgeOffline: {
    backgroundColor: 'rgba(255, 23, 68, 0.12)',
    borderColor: '#FF1744',
    borderWidth: 1,
  },
  statusBadgeText: { fontSize: 12, fontWeight: '600' },
  statusTextOnline: { color: '#00E676' },
  statusTextOffline: { color: '#FF5252' },
  filePickerButton: {
    backgroundColor: '#262626',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  filePickerButtonText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  selectedFileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181818',
    borderColor: '#00E5FF',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  fileIconBox: { marginRight: 10 },
  fileIcon: { fontSize: 22 },
  fileDetails: { flex: 1 },
  fileName: { color: '#FFF', fontSize: 13, fontWeight: 'bold' },
  fileMeta: { color: '#888', fontSize: 11, marginTop: 2 },
  fileRemoveButton: { padding: 6 },
  fileRemoveText: { color: '#FF5252', fontSize: 16, fontWeight: 'bold' },
  filePlaceholderBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 16,
  },
  filePlaceholderText: { color: '#666', fontSize: 11, fontStyle: 'italic', textAlign: 'center' },
  uploadingButtonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  textInput: {
    backgroundColor: '#121212',
    color: '#FFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  otaStatusBox: {
    backgroundColor: '#141414',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    marginBottom: 16,
  },
  otaStatusLabel: { color: '#888', fontSize: 12 },
  otaStatusValue: { color: '#FFF', fontSize: 15, fontWeight: 'bold', marginVertical: 4 },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    marginVertical: 8,
    overflow: 'hidden',
  },
  progressBarFill: { height: '100%', borderRadius: 4 },
  logText: { color: '#888', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  primaryButton: {
    backgroundColor: '#00E5FF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#000', fontSize: 14, fontWeight: 'bold' },
  warningBox: {
    backgroundColor: '#2D1B00',
    borderColor: '#FFA726',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  warningTitle: { color: '#FFA726', fontWeight: 'bold', fontSize: 13, marginBottom: 4 },
  warningText: { color: '#FFD54F', fontSize: 12, lineHeight: 16 },

  /* IA Relatório */
  reportContainer: {
    backgroundColor: '#151515',
    borderRadius: 8,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#262626',
  },
  reportScoreRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  scoreCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: '#00E5FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  scoreNumber: { color: '#00E5FF', fontSize: 18, fontWeight: 'bold' },
  scoreLabel: { color: '#888', fontSize: 9, textTransform: 'uppercase' },
  reportSummary: { flex: 1 },
  reportItem: { color: '#888', fontSize: 13, marginBottom: 4 },
  recommendationItem: { flexDirection: 'row', marginBottom: 6, paddingRight: 10 },
  bullet: { color: '#00E5FF', fontSize: 16, marginRight: 6 },
  recommendationText: { color: '#DDD', fontSize: 12, flex: 1, lineHeight: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 20 },
  emptyStateText: { color: '#666', fontSize: 13, textAlign: 'center' },
});

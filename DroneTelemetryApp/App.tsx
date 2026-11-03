import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView, Dimensions, ScrollView } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { connectToDroneMQTT, TelemetryPayload } from './src/services/mqttService';

const MAX_HISTORY_POINTS = 10;
const screenWidth = Dimensions.get('window').width;

export default function App() {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<TelemetryPayload>({
    distance_mm: 0,
    distance_cm: 0,
    valid: true,
    battery: 100,
  });
  const [altitudeHistory, setAltitudeHistory] = useState<number[]>([0]);

  useEffect(() => {
    const client = connectToDroneMQTT(
      (data) => {
        const currentAltitude = data.distance_mm ?? data.altitude ?? (data.distance_cm != null ? data.distance_cm * 10 : 0);
        setTelemetry((prev) => ({ ...prev, ...data }));

        // Atualiza o histórico de pontos para o gráfico em tempo real
        setAltitudeHistory((prevHistory) => {
          const updated = [...prevHistory, currentAltitude];
          return updated.slice(-MAX_HISTORY_POINTS);
        });
      },
      (status) => setIsConnected(status)
    );

    return () => {
      if (client) client.end();
    };
  }, []);

  const distanceMm = telemetry.distance_mm ?? telemetry.altitude ?? 0;
  const distanceCm = telemetry.distance_cm ?? (distanceMm / 10);
  const isValid = telemetry.valid !== false;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.header}>ESP-Drone Dashboard</Text>

        {/* Card de Conexão com o Broker EMQX */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Broker EMQX Status</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: isConnected ? '#4CAF50' : '#F44336' }]} />
            <Text style={styles.statusText}>{isConnected ? 'Conectado (ws://192.168.0.22:8083)' : 'Desconectado'}</Text>
          </View>
          {telemetry.device_id && (
            <Text style={styles.deviceInfo}>Dispositivo: {telemetry.device_id} | {telemetry.sensor ?? 'ToF-90'}</Text>
          )}
        </View>

        {/* Cards de Métricas */}
        <View style={styles.metricsRow}>
          <View style={[styles.card, styles.metricCard]}>
            <Text style={styles.cardTitle}>Distância / Altitude</Text>
            <Text style={styles.metricValue}>
              {isValid ? distanceMm : '--'} <Text style={styles.unit}>mm</Text>
            </Text>
            <Text style={styles.secondaryValue}>
              {isValid ? `${distanceCm.toFixed(1)} cm` : 'Fora de alcance'}
            </Text>
          </View>

          <View style={[styles.card, styles.metricCard]}>
            <Text style={styles.cardTitle}>Status do Sensor</Text>
            <Text style={[styles.metricValue, { fontSize: 20, color: isValid ? '#4CAF50' : '#FFA726', marginTop: 4 }]}>
              {isValid ? 'ONLINE' : 'ALCANCE'}
            </Text>
            <Text style={styles.secondaryValue}>
              Bateria: {telemetry.battery ?? 100}%
            </Text>
          </View>
        </View>

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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  scrollContent: { padding: 16 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#FFF', marginBottom: 16, textAlign: 'center' },
  card: { backgroundColor: '#1E1E1E', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { color: '#888', fontSize: 13, textTransform: 'uppercase', marginBottom: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  deviceInfo: { color: '#888', fontSize: 12, marginTop: 6 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metricCard: { width: '48%', alignItems: 'center' },
  metricValue: { color: '#00E5FF', fontSize: 28, fontWeight: 'bold' },
  secondaryValue: { color: '#BBB', fontSize: 13, marginTop: 4 },
  unit: { fontSize: 14, color: '#FFF' },
  chart: { marginTop: 8, borderRadius: 8 },
});
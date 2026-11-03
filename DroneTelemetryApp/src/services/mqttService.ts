import mqtt, { MqttClient } from 'mqtt';

export const DEFAULT_BROKER_URL = process.env.EXPO_PUBLIC_MQTT_BROKER_URL || 'ws://192.168.0.22:8083/mqtt';
export const DEFAULT_TOPIC = process.env.EXPO_PUBLIC_MQTT_TOPIC || 'drone/#';
export const DEFAULT_USERNAME = process.env.EXPO_PUBLIC_MQTT_USERNAME || 'esp32s3_tof90';
export const DEFAULT_PASSWORD = process.env.EXPO_PUBLIC_MQTT_PASSWORD || '';

export interface TelemetryPayload {
  device_id?: string;
  sensor?: string;
  distance_mm?: number;
  distance_cm?: number;
  valid?: boolean;
  distance?: number;
  altitude?: number;
  battery?: number;
  timestamp?: number;
}

export interface ConnectOptions {
  brokerUrl?: string;
  topic?: string;
  username?: string;
  password?: string;
}

export const connectToDroneMQTT = (
  onMessageReceived: (data: TelemetryPayload) => void,
  onStatusChange: (connected: boolean) => void,
  options?: ConnectOptions
): MqttClient => {
  const brokerUrl = options?.brokerUrl || DEFAULT_BROKER_URL;
  const topic = options?.topic || DEFAULT_TOPIC;
  const username = options?.username ?? DEFAULT_USERNAME;
  const password = options?.password ?? DEFAULT_PASSWORD;

  const clientId = `esp_drone_mobile_${Math.random().toString(16).substring(2, 8)}`;

  const client = mqtt.connect(brokerUrl, {
    clientId,
    username,
    password,
    keepalive: 60,
    reconnectPeriod: 3000,
  });

  client.on('connect', () => {
    console.log('[MQTT App] Conectado ao broker:', brokerUrl);
    onStatusChange(true);
    client.subscribe(topic, (err) => {
      if (err) console.error('[MQTT App] Erro na subscrição:', err);
      else console.log('[MQTT App] Subscrito ao tópico:', topic);
    });
  });

  client.on('message', (receivedTopic, message) => {
    try {
      const payload: TelemetryPayload = JSON.parse(message.toString());
      onMessageReceived(payload);
    } catch (e) {
      console.warn('[MQTT App] Mensagem não-JSON recebida:', message.toString());
    }
  });

  client.on('close', () => onStatusChange(false));
  client.on('offline', () => onStatusChange(false));
  client.on('error', (err) => console.error('[MQTT App] Erro MQTT:', err));

  return client;
};
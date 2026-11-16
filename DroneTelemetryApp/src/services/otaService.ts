/**
 * OTA (Over-The-Air) Service para Drone ESP32
 * 
 * Permite enviar arquivos de firmware compilados (.bin) diretamente para o ESP32
 * via requisição HTTP multipart/form-data.
 */

import { Platform } from 'react-native';

export interface OtaProgress {
  percentage: number;
  loadedBytes: number;
  totalBytes: number;
  status: 'idle' | 'uploading' | 'verifying' | 'success' | 'error';
  errorMessage?: string;
}

export interface OtaUploadOptions {
  espIp: string;
  firmwareUri?: string;
  firmwareBlob?: Blob;
  firmwareName?: string;
  onProgress?: (progress: OtaProgress) => void;
}

export interface EspStatusResult {
  online: boolean;
  deviceId?: string;
  freeHeap?: number;
  uptimeMs?: number;
  otaReady?: boolean;
  message: string;
}

/**
 * Testa a conexão com o ESP32 na rede local consultando o endpoint /status
 */
export async function checkEspOtaStatus(espIp: string): Promise<EspStatusResult> {
  const cleanIp = espIp.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!cleanIp) {
    return { online: false, message: 'Endereço IP não informado.' };
  }

  const targetUrl = `http://${cleanIp}/status`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(targetUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      return {
        online: true,
        deviceId: data.device_id,
        freeHeap: data.free_heap,
        uptimeMs: data.uptime_ms,
        otaReady: data.ota_ready ?? true,
        message: `ESP32 Online! (ID: ${data.device_id || 'N/A'}, Heap: ${
          data.free_heap ? (data.free_heap / 1024).toFixed(1) + ' KB' : 'N/A'
        })`,
      };
    } else {
      return {
        online: false,
        message: `ESP32 respondeu com código HTTP ${res.status}.`,
      };
    }
  } catch (err: any) {
    const errorMsg =
      err.name === 'AbortError'
        ? `Tempo limite excedido ao conectar com ${cleanIp}.`
        : `Não foi possível conectar ao ESP32 no IP ${cleanIp}. Verifique se ambos estão na mesma rede Wi-Fi.`;
    return {
      online: false,
      message: errorMsg,
    };
  }
}

/**
 * Envia o arquivo .bin de firmware para o endpoint de atualização OTA do ESP32 (ex: http://192.168.0.22/update)
 * 
 * Utiliza XMLHttpRequest nativo com FormData padrão do React Native.
 * O React Native transmite streams nativos diretamente para URIs content:// e file:// via ContentResolver
 * no Android e iOS, sem sofrer com as restrições de sandbox do ExponentFileSystem.
 */
export async function uploadFirmwareToESP({
  espIp,
  firmwareUri,
  firmwareBlob,
  firmwareName = 'firmware.bin',
  onProgress,
}: OtaUploadOptions): Promise<{ success: boolean; message: string }> {
  const cleanIp = espIp.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!cleanIp) {
    return { success: false, message: 'Endereço IP do ESP32 inválido.' };
  }

  const targetUrl = `http://${cleanIp}/update`;

  onProgress?.({
    percentage: 0,
    loadedBytes: 0,
    totalBytes: 100,
    status: 'uploading',
  });

  return new Promise(async (resolve) => {
    try {
      const formData = new FormData();

      if (Platform.OS === 'web') {
        let blobToSend = firmwareBlob;

        if (!blobToSend && firmwareUri) {
          try {
            const fetched = await fetch(firmwareUri);
            blobToSend = await fetched.blob();
          } catch {
            // fallback
          }
        }

        if (!blobToSend) {
          const err = 'Nenhum arquivo binário fornecido para o upload.';
          onProgress?.({
            percentage: 0,
            loadedBytes: 0,
            totalBytes: 0,
            status: 'error',
            errorMessage: err,
          });
          return resolve({ success: false, message: err });
        }

        formData.append('update', blobToSend, firmwareName);
      } else {
        // Ambiente Nativo (Android e iOS):
        // Usa a estrutura de arquivo do FormData nativo do React Native.
        if (!firmwareUri) {
          const err = 'URI do arquivo de firmware não encontrada.';
          onProgress?.({
            percentage: 0,
            loadedBytes: 0,
            totalBytes: 0,
            status: 'error',
            errorMessage: err,
          });
          return resolve({ success: false, message: err });
        }

        formData.append('update', {
          uri: firmwareUri,
          name: firmwareName,
          type: 'application/octet-stream',
        } as any);
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', targetUrl, true);
      // Timeout ampliado (120s) para garantir tempo suficiente de escrita na Flash do ESP32
      xhr.timeout = 120000;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percentage = Math.round((event.loaded / event.total) * 100);
          onProgress({
            percentage: Math.min(percentage, 100),
            loadedBytes: event.loaded,
            totalBytes: event.total,
            status: percentage >= 100 ? 'verifying' : 'uploading',
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.({
            percentage: 100,
            loadedBytes: 100,
            totalBytes: 100,
            status: 'success',
          });
          resolve({
            success: true,
            message: 'Firmware gravado com sucesso! O ESP32 está reiniciando.',
          });
        } else {
          const err = `Falha na gravação OTA (HTTP ${xhr.status}): ${xhr.responseText || 'Erro retornado pelo ESP32'}`;
          onProgress?.({
            percentage: 0,
            loadedBytes: 0,
            totalBytes: 0,
            status: 'error',
            errorMessage: err,
          });
          resolve({ success: false, message: err });
        }
      };

      xhr.onerror = () => {
        const err = `Não foi possível conectar ao ESP32 no IP: ${cleanIp}. Verifique se o celular está no mesmo Wi-Fi do drone.`;
        onProgress?.({
          percentage: 0,
          loadedBytes: 0,
          totalBytes: 0,
          status: 'error',
          errorMessage: err,
        });
        resolve({ success: false, message: err });
      };

      xhr.ontimeout = () => {
        const err = 'Tempo limite excedido ao gravar o firmware no ESP32.';
        onProgress?.({
          percentage: 0,
          loadedBytes: 0,
          totalBytes: 0,
          status: 'error',
          errorMessage: err,
        });
        resolve({ success: false, message: err });
      };

      xhr.send(formData);
    } catch (error: any) {
      const err = error?.message || 'Erro inesperado durante a transmissão OTA';
      onProgress?.({
        percentage: 0,
        loadedBytes: 0,
        totalBytes: 0,
        status: 'error',
        errorMessage: err,
      });
      resolve({ success: false, message: err });
    }
  });
}

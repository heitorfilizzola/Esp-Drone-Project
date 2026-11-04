/**
 * OTA (Over-The-Air) Service para Drone ESP32
 * 
 * Permite enviar arquivos de firmware compilados (.bin) diretamente para o ESP32
 * via requisição HTTP multipart/form-data.
 */

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

/**
 * Envia o arquivo .bin de firmware para o endpoint de atualização OTA do ESP32 (ex: http://192.168.0.22/update)
 */
export async function uploadFirmwareToESP({
  espIp,
  firmwareBlob,
  firmwareName = 'firmware.bin',
  onProgress,
}: OtaUploadOptions): Promise<{ success: boolean; message: string }> {
  const cleanIp = espIp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const targetUrl = `http://${cleanIp}/update`;

  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', targetUrl, true);
      xhr.timeout = 60000; // 60 segundos de timeout

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percentage = Math.round((event.loaded / event.total) * 100);
          onProgress({
            percentage,
            loadedBytes: event.loaded,
            totalBytes: event.total,
            status: percentage >= 100 ? 'verifying' : 'uploading',
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) {
            onProgress({
              percentage: 100,
              loadedBytes: 100,
              totalBytes: 100,
              status: 'success',
            });
          }
          resolve({
            success: true,
            message: 'Firmware gravado com sucesso! O ESP32 está reiniciando.',
          });
        } else {
          const err = `Falha na gravação OTA (HTTP ${xhr.status}): ${xhr.responseText || 'Erro desconhecido'}`;
          if (onProgress) {
            onProgress({
              percentage: 0,
              loadedBytes: 0,
              totalBytes: 0,
              status: 'error',
              errorMessage: err,
            });
          }
          resolve({ success: false, message: err });
        }
      };

      xhr.onerror = () => {
        const err = `Não foi possível conectar ao ESP32 no IP: ${cleanIp}. Verifique se está na mesma rede Wi-Fi.`;
        if (onProgress) {
          onProgress({
            percentage: 0,
            loadedBytes: 0,
            totalBytes: 0,
            status: 'error',
            errorMessage: err,
          });
        }
        resolve({ success: false, message: err });
      };

      xhr.ontimeout = () => {
        const err = 'Tempo limite excedido ao gravar o firmware no ESP32.';
        if (onProgress) {
          onProgress({
            percentage: 0,
            loadedBytes: 0,
            totalBytes: 0,
            status: 'error',
            errorMessage: err,
          });
        }
        resolve({ success: false, message: err });
      };

      const formData = new FormData();
      if (firmwareBlob) {
        formData.append('update', firmwareBlob, firmwareName);
      } else {
        // Mock payload para teste quando nenhum arquivo real for carregado
        const dummyBlob = new Blob(['TEST_FIRMWARE_PAYLOAD'], { type: 'application/octet-stream' });
        formData.append('update', dummyBlob, firmwareName);
      }

      onProgress?.({
        percentage: 0,
        loadedBytes: 0,
        totalBytes: 1,
        status: 'uploading',
      });

      xhr.send(formData);
    } catch (error: any) {
      const err = error?.message || 'Erro inesperado durante OTA';
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

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ollo.companion',
  appName: 'OllO',
  webDir: 'dist',
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: 'Looking for OllO glasses…',
        cancel: 'Cancel',
        availableDevices: 'Available OllO devices',
        noDeviceFound: 'No OllO glasses found'
      }
    }
  }
};

export default config;

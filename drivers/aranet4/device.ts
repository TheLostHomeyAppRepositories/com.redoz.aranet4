import Homey, { BleAdvertisement, BlePeripheral } from 'homey';

const BLE_FIND_TIMEOUT = 15000; // 15 seconds
const REFRESH_DELAY = 10; // give the device 10 seconds extra before requesting data
const CONNECTION_RETRY_BACK_OFF_MULTIPLIER = 5;
const CONNECTION_RETRY_BACK_OFF_MAX = 300;
const SET_UNAVAILABLE_AFTER = 120;
const DEVICE_INFORMATION_UPDATE_INTERVAL = 24 * 60 * 60 * 1000;  // 24 hours * 60 minutes * 60 seconds * 1000 milliseconds

const DATA_SERVICE_UUID_LIST = [
  "f0cd140095da4f4b9ac8aa55d312af0c",
  "0000fce000001000800000805f9b34fb"
];

const DATA_CHARACTERISTIC_UUID = "f0cd300195da4f4b9ac8aa55d312af0c";

const MANUFACTURER_NAME = { name: 'org.bluetooth.characteristic.manufacturer_name_string', id: '00002a2900001000800000805f9b34fb' };
const MODEL_NUMBER = { name: 'org.bluetooth.characteristic.model_number_string', id: '00002a2400001000800000805f9b34fb' };
const SERIAL_NUMBER = { name: 'org.bluetooth.characteristic.serial_number_string', id: '00002a2500001000800000805f9b34fb' };
const HARDWARE_REVISION = { name: 'org.bluetooth.characteristic.hardware_revision_string', id: '00002a2700001000800000805f9b34fb' };
const FIRMWARE_REVISION = { name: 'org.bluetooth.characteristic.firmware_revision_string', id: '00002a2600001000800000805f9b34fb' };
const SOFTWARE_REVISION = { name: 'org.bluetooth.characteristic.software_revision_string', id: '00002a2800001000800000805f9b34fb' };


const BLUETOOTH_DEVICEINFO_SERVICE = '0000180a00001000800000805f9b34fb';
const BLUETOOTH_CHARACTERISTICS = [
  MANUFACTURER_NAME,
  MODEL_NUMBER,
  SERIAL_NUMBER,
  HARDWARE_REVISION,
  FIRMWARE_REVISION,
  SOFTWARE_REVISION,
].map(c => c.id);

interface Aranet4Data {
  battery: number;
  humidity: number;
  pressure: number;
  temperature: number;
  co2: number;
  measurementInterval: number;
  measurementsAge: number;
}

interface DeviceSettings {
  measurement_interval: string;
  // device information
  name: string;
  manufacturer: string;
  serial_number: string;
  model: string;
  hardware_revision: string;
  firmware_version: string;
  software_version: string;
}

class Aranet4Device extends Homey.Device {
  
  private _interval: NodeJS.Timeout | undefined;
  private _lastDeviceInformationCheck = new Date(1970,1,1,0,0,0,0)
  private _successiveErrors : number = 0;


  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    await this.refresh();    
    this.log('Aranet4 has been initialized');
  }

  async getBackOffDelay() : Promise<number> {
    var ret = (this._successiveErrors+1) * CONNECTION_RETRY_BACK_OFF_MULTIPLIER;
    if (ret > CONNECTION_RETRY_BACK_OFF_MAX)
      ret =  CONNECTION_RETRY_BACK_OFF_MAX;
    else 
      this._successiveErrors++;

    if (ret > SET_UNAVAILABLE_AFTER)
      await this.setUnavailable(this.homey.__('errors.device_unavailable'));

    return ret * 1000;
  }

  async resetBackOff() {
    await this.setAvailable();
    this._successiveErrors = 0;
  }

  async refresh() {
    try {
      var sensorReadings = await this.readDataFromDevice();
      
      if (sensorReadings) {
        await this.resetBackOff();

        this.log("Updating device values")
        await this.setCapabilityValue('measure_co2', sensorReadings.co2)
        await this.setCapabilityValue('measure_temperature', sensorReadings.temperature)
        await this.setCapabilityValue('measure_pressure', sensorReadings.pressure)
        await this.setCapabilityValue('measure_humidity', sensorReadings.humidity)
        await this.setCapabilityValue('measure_battery', sensorReadings.battery)

        var refreshDelay = sensorReadings.measurementInterval - sensorReadings.measurementsAge + REFRESH_DELAY;
        var settings : Partial<DeviceSettings> = {
          measurement_interval: (sensorReadings.measurementInterval / 60) + " minutes" // yeah, all english, all the way
        };
        await this.setSettings(settings);
        this.log(`Refresh rate is ${sensorReadings.measurementInterval}s, sensor reading age is ${sensorReadings.measurementsAge}s, refreshing in ${refreshDelay}s`);
        
        this._interval = this.homey.setTimeout(() => this.refresh(), refreshDelay * 1000);
        
        return;
      } 
    } catch (err) {
      this.error("An unhandled error occured", err);
    }

    this._interval = this.homey.setTimeout(() => this.refresh(), await this.getBackOffDelay());
  }

  async readDataFromDevice() : Promise<Aranet4Data | undefined>  {
    var peripheral : BlePeripheral | undefined;
    try {
      this.log("Attempting to find Aranet with id: " + this.getStore().peripheralUuid + " (timeout: " + BLE_FIND_TIMEOUT + "ms)");      
      var advertisement = await this.homey.ble.find(this.getStore().peripheralUuid, BLE_FIND_TIMEOUT);

      var settings : Partial<DeviceSettings> = {
        name: advertisement.localName
      };
      await this.setSettings(settings);

      this.log(`Aranet4 device found (${advertisement.localName}), attempting to connect...`);
      peripheral = await advertisement.connect();

      this.log(`Successfully connected to Aranet4 device (${advertisement.localName})`);

      var deviceInfoAge = Date.now() - this._lastDeviceInformationCheck.valueOf();
      if (deviceInfoAge > DEVICE_INFORMATION_UPDATE_INTERVAL) {
        this.log("Attempting to update device info");
        try {
          await this.updateDeviceInfo(peripheral);
          this._lastDeviceInformationCheck = new Date();
        } catch (ex) {
          this.error("Failed to update device info", ex);
        }
      } else {
        this.log("Device info update scheduled in " + Math.round((DEVICE_INFORMATION_UPDATE_INTERVAL - deviceInfoAge) / (60 * 1000)) + " minutes");
      }

      this.log("Attempting to find peripheral service");
      let services = await peripheral.discoverServices();
      
      let service = services.find(service => DATA_SERVICE_UUID_LIST.includes(service.uuid));

      if (!service) {
        this.error("Failed to find peripheral service");
        // early exit to avoid nesting
        return;
      }
      
      this.log("Attempting to find service characteristics");
      let characteristics = await service.discoverCharacteristics([DATA_CHARACTERISTIC_UUID]);
      
      if (characteristics.length != 1) {
        this.error("Failed to find service characteristics");
        // early exit to avoid nesting
        return;
      }

      this.log("Attempting to read sensor data")
      let sensorData = await characteristics[0].read();

      const PAYLOAD_LENGTH = 13;

      if (sensorData.byteLength != PAYLOAD_LENGTH ) {
        this.error(`Expected ${PAYLOAD_LENGTH} bytes but received ${sensorData.byteLength} bytes of sensor data`);
        // early exit to avoid nesting
        return;
      }

      return {
        co2: sensorData.readUInt16LE(0),
        temperature: Math.round((sensorData.readUInt16LE(2) / 20) * 10) / 10,
        pressure: sensorData.readUInt16LE(4) / 10,
        humidity: sensorData.readUInt8(6),
        battery: sensorData.readUInt8(7),
        measurementInterval: sensorData.readUInt16LE(9),
        measurementsAge: sensorData.readUInt16LE(11)
      };

    } catch (err) {
      if (peripheral && !peripheral.isConnected)
      {
        this.log("Device disconnected while attempting to read data");
      } else {
        this.error(`An unexpected error occured`, err);
      }
    } finally {
      if (peripheral && peripheral.isConnected) {
        this.log(`Attempting to disconnect Aranet4 device`);
        try {
          await peripheral.disconnect();
          this.log(`Aranet4 device successfully disconnected`);
        } catch (disconnectErr) {
          this.error(`Error while disconnecting from device`, disconnectErr);
        }
      }
    }
  }
  
  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Aranet4 has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log("Aranet4 settings where changed");
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('Aranet4 was renamed');
  }

  async onUninit() {
    this.cleanup();
    this.log('Aranet4 has been uninitizalied');
  }

  getSetting(arg: any) {
    this.log('Settings were requested!!!!!!!!!!!!!!!!!!!!!!!!!!');
    return super.getSetting(arg);
  }

  getSettings() {
    this.log('Settings were requested!!!!!!!!!!!!!!!!!!!!!!!!!!');
    return super.getSettings();
  }
  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.cleanup();
    this.log('Aranet4 has been deleted');
  }

  cleanup() {
    if (this._interval) {
      this.homey.clearTimeout(this._interval);
      this._interval = undefined;
    }
  }

  async updateDeviceInfo(peripheral: BlePeripheral) {
    try {
      const service = await peripheral.getService(BLUETOOTH_DEVICEINFO_SERVICE);
        
      var characteristics = await service.discoverCharacteristics(BLUETOOTH_CHARACTERISTICS);
      
      if (characteristics.length === 0) {
        return;
      }
      const decoder = new TextDecoder('utf8');
      let settings : Partial<DeviceSettings> = {};
      for (let index = 0; index < characteristics.length; index++) {
        const c = characteristics[index];
        const data = await c.read();
        const value = decoder.decode(data);
        
        switch (c.uuid) {
          case MANUFACTURER_NAME.id:
            this.log(`Manufacturer: ${value}`);
            settings.manufacturer = value;
            break;
          case MODEL_NUMBER.id:
            this.log(`Model number: ${value}`);
            settings.model = value;
            break;
          case SERIAL_NUMBER.id:
            this.log(`Serial number: ${value}`);
            settings.serial_number = value;
            break;
          case HARDWARE_REVISION.id:
            this.log(`Hardware revision: ${value}`);
            settings.hardware_revision = value;
            break;
          case FIRMWARE_REVISION.id:
            this.log(`Firmware revision: ${value}`);
            settings.firmware_version = value;
            break;
          case SOFTWARE_REVISION.id:
            this.log(`Software revision: ${value}`);
            settings.software_version = value;
            break;
        }
      }
      await this.setSettings(settings);
    } catch(err) {
      this.error("An error occured while fetching device info", err);
    }
  }

}

module.exports = Aranet4Device;

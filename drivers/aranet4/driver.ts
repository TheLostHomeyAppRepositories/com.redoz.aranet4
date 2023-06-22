import Homey from 'homey';


// "aranet4homey_data": {
//   "data_service_uuid": [
//     "f0cd140095da4f4b9ac8aa55d312af0c",
//     "0000fce000001000800000805f9b34fb"
//   ],
//   "data_characteristic_uuid": "f0cd300195da4f4b9ac8aa55d312af0c",
//   "max_retries": "10",
//   "battery_alarm_trigger": "15",
//   "timeout": {
//     "regular": 10000,
//     "long": 600000
//   }
// },

const DATA_SERVICE_UUID_LIST = [
  "f0cd140095da4f4b9ac8aa55d312af0c",
  "0000fce000001000800000805f9b34fb"
];

const DATA_CHARACTERISTIC_UUID = "f0cd300195da4f4b9ac8aa55d312af0c";

class Aranet4Driver extends Homey.Driver {

  

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Aranet4Driver is initializing');

    this.log('Aranet4Driver has been initialized');
  }



  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    this.log('Discovering BLE devices...');
    const advertisements = await this.homey.ble.discover();

    this.log("advertisments", advertisements);

    return advertisements
      .filter(advertisement => advertisement.localName !== undefined && advertisement.serviceUuids.some(uuid => DATA_SERVICE_UUID_LIST.includes(uuid)))
      .map(advertisement => {
        this.log("gotcha", advertisement);
        return {
          name: advertisement.localName,
          data: {
            id: advertisement.uuid,
          },
          store: {
            peripheralUuid: advertisement.uuid,
          }
        };
      });
    }
}

module.exports = Aranet4Driver;

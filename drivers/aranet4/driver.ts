import Homey from 'homey';

const DATA_SERVICE_UUID_LIST = [
  "f0cd140095da4f4b9ac8aa55d312af0c",
  "0000fce000001000800000805f9b34fb"
];

const DATA_CHARACTERISTIC_UUID = "f0cd300195da4f4b9ac8aa55d312af0c";

export class Aranet4Driver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Aranet4Driver is initializing');

    this.log('Aranet4Driver has been initialized');
  }

  async discoverAranetDevices() : Promise<Homey.BleAdvertisement[]> {
    this.log('Discovering BLE devices...');
    const advertisements = await this.homey.ble.discover(undefined);

    var aranetAdvertisements = advertisements
      .filter(advertisement => advertisement.localName !== undefined && advertisement.serviceUuids.some(uuid => DATA_SERVICE_UUID_LIST.includes(uuid)));

    this.log("aranetAdvertisements", aranetAdvertisements);

    return aranetAdvertisements;
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    const advertisements = await this.discoverAranetDevices();

    return advertisements.map(advertisement => {
        this.log("gotcha", advertisement);
        return {
          name: advertisement.localName,
          data: {
            id: advertisement.uuid,
          },
          store: {
            peripheralUuid: advertisement.uuid
          }
        };
      });
    }
}

module.exports = Aranet4Driver;

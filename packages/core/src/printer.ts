/// <reference types="w3c-web-usb" />
import { WebUSB } from "usb";
import { cmd } from "./commands";

const VENDOR_ID    = 0x0416;
const PRODUCT_ID   = 0x5011;
const INTERFACE    = 0;
const ENDPOINT_OUT = 1;
const ENDPOINT_IN  = 0x81;

export class Printer {
  private device!: USBDevice;

  static async isPresent(): Promise<boolean> {
    const webusb = new WebUSB({ allowAllDevices: true });
    const devices = await webusb.getDevices();
    return devices.some(d => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
  }

  async connect() {
    const webusb = new WebUSB({ allowAllDevices: true });
    const devices = await webusb.getDevices();
    const printer = devices.find(
      (d) => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID
    );
    if (!printer) throw new Error("POS-58 not found. Is it connected?");
    this.device = printer;
    await this.device.open();
    await this.device.selectConfiguration(1);
    await this.device.claimInterface(INTERFACE);
    await this.device.clearHalt("out", ENDPOINT_OUT).catch(() => {});
  }

  async send(...chunks: Uint8Array[]) {
    for (const chunk of chunks) {
      let attempts = 3;
      while (true) {
        try {
          const result = await this.device.transferOut(ENDPOINT_OUT, chunk);
          if (result.status === "ok") break;
          throw new Error(`USB transfer failed: ${result.status}`);
        } catch (err) {
          if (--attempts === 0) throw err;
          await Bun.sleep(150);
        }
      }
    }
  }

  async disconnect() {
    await this.device.releaseInterface(INTERFACE);
    await this.device.close();
  }

  async readStatus(): Promise<{ paper: boolean; nearEnd: boolean; raw: number } | null> {
    await this.device.transferOut(ENDPOINT_OUT, new Uint8Array([0x10, 0x04, 0x04]));
    let result: USBInTransferResult;
    try {
      result = await Promise.race([
        this.device.transferIn(ENDPOINT_IN, 1),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("status read timed out")), 500)
        ),
      ]);
    } catch {
      // Printer has no IN endpoint (read-only USB) — skip status check
      return null;
    }
    const byte = result.data?.getUint8(0) ?? 0xFF;
    return {
      paper:   (byte & 0x60) === 0,
      nearEnd: (byte & 0x0C) !== 0,
      raw:     byte,
    };
  }

  async job(fn: (p: Printer) => Promise<void>) {
    await this.connect();

    const status = await this.readStatus();
    if (status !== null && !status.paper) {
      await this.disconnect();
      throw new Error("Out of paper — load paper and try again");
    }
    if (status?.nearEnd) console.warn("Warning: paper is running low");

    await this.send(cmd.init(), cmd.codepage437());
    try {
      await fn(this);
    } finally {
      await this.send(cmd.feed(2), cmd.cut());
      await this.disconnect();
    }
  }
}

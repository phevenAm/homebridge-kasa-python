import { Categories } from 'homebridge';

import HomeKitParentDevice from './baseParent.js';
import type KasaPythonPlatform from '../platform.js';
import type { CharacteristicDescriptor, ChildDevice, Hub } from './deviceTypes.js';

// python-kasa has no push notifications for hub-connected buttons/dials (S200B/S200D);
// their presses can only be observed by polling the hub's trigger log (see
// get_button_info in src/python/kasaApi.py). Each poll surfaces any log entries that
// arrived since the last one, and we translate those into HomeKit button presses here.
function mapButtonEventToProgrammableSwitchEvent(
  C: typeof import('homebridge').Characteristic,
  eventName: string,
): number {
  switch (eventName) {
    case 'click':
      return C.ProgrammableSwitchEvent.SINGLE_PRESS;
    case 'double_click':
      return C.ProgrammableSwitchEvent.DOUBLE_PRESS;
    default:
      // Covers rotation and anything else we haven't specifically mapped yet;
      // HomeKit's ProgrammableSwitchEvent has no dedicated "rotate" value.
      return C.ProgrammableSwitchEvent.LONG_PRESS;
  }
}

export default class HomeKitDeviceHubWithChildren extends HomeKitParentDevice {
  constructor(
    platform: KasaPythonPlatform,
    public kasaDevice: Hub,
  ) {
    super(platform, kasaDevice, Categories.PROGRAMMABLE_SWITCH, 'PROGRAMMABLE_SWITCH');
    this.setupChildServices();
    this.setupServiceLabel();
  }

  public async initialize(): Promise<void> {
    await this.startPolling();
  }

  private setupServiceLabel(): void {
    const children = this.kasaDevice.sys_info.children ?? [];
    if (children.length <= 1) {
      return;
    }
    const { ServiceLabel } = this.platform.Service;
    const { ServiceLabelNamespace } = this.platform.Characteristic;
    const service = this.homebridgeAccessory.getService(ServiceLabel) ?? this.addService(ServiceLabel, this.name);
    service.setCharacteristic(ServiceLabelNamespace, ServiceLabelNamespace.ARABIC_NUMERALS);
  }

  protected getChildServiceType() {
    return this.platform.Service.StatelessProgrammableSwitch;
  }

  protected buildChildDescriptors(): CharacteristicDescriptor[] {
    const C = this.platform.Characteristic;
    return [
      {
        type: C.ProgrammableSwitchEvent,
        name: 'ProgrammableSwitchEvent',
        writable: false,
        getInitial: () => C.ProgrammableSwitchEvent.SINGLE_PRESS,
        getCurrent: () => C.ProgrammableSwitchEvent.SINGLE_PRESS,
      },
      {
        type: C.ServiceLabelIndex,
        name: 'ServiceLabelIndex',
        writable: false,
        getInitial: context => this.extractChildIndex(context.child ?? {}) + 1,
        getCurrent: context => this.extractChildIndex(context.child ?? {}) + 1,
      },
    ];
  }

  protected async updateAllServicesAndCharacteristics(forceUpdate: boolean): Promise<void> {
    await super.updateAllServicesAndCharacteristics(forceUpdate);

    const children = this.kasaDevice.sys_info.children ?? [];
    const C = this.platform.Characteristic;
    for (const child of children as ChildDevice[]) {
      const events = child.button_events;
      if (!events || events.length === 0) {
        continue;
      }
      const subType = `child-${this.extractChildIndex(child) + 1}`;
      const service = this.homebridgeAccessory.getServiceById(this.platform.Service.StatelessProgrammableSwitch, subType);
      if (!service) {
        continue;
      }
      const characteristic = service.getCharacteristic(C.ProgrammableSwitchEvent);
      for (const event of events) {
        const value = mapButtonEventToProgrammableSwitchEvent(C, event.event);
        this.log.info(`Button event on ${child.alias}: ${event.event}`);
        characteristic.updateValue(value);
      }
    }
  }

  public identify(): void {
    this.log.info('identify');
  }
}

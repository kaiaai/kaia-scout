/**
 * @license
 * Copyright 2018 OOMWOO LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

export class Scout {
  _resolveFunc: Function | null = null;
  _rejectFunc: Function | null = null;
  _serial: any;
  _listener: any;
  _debug: boolean = false;
  _model: any;
  _cmd: any;
  _conn: any;
  static scout: Scout | undefined;
  static _created: boolean = false;

  constructor() {
    if (Scout._created)
      throw 'Only one instance allowed';
    Scout._created = true;
  }

  async init(params: any): Promise<any> {
    params = params || {};
    this.setEventListener(params.eventListener);
    this.debug(params.debug);

    // TODO remove : from Scout messages  
    this._initModel();
    this._cmd = {id: -1, active: false};		

    this.serial(params.serial);
    return this._makePromise();
  }
	
  serial(serial: any) {
    if (!serial || typeof serial === 'object') {
      if (this._serial)
        this._serial.setEventListener(null);
      this._serial = serial;
    }
    if (this._serial)
      this._serial.setEventListener(Scout._serialEventListener);
    return this._serial;
  }

  static _serialEventListener(err: any, info: any) {
    if (Scout.scout)
      Scout.scout._parseSerialMessage(err, info);
  }

  send(text: string) {
    if (this._serial)
      throw 'Serial required';
    this._issueEvent({event: 'write', message: text, err: false});
    if (this._debug)
      console.log('this._serial.write(text) ' + text);
    const res: any = this._serial.write(text);
    return res.err;
  }

  _parseSerialMessage(err: any, info: any) {
    // Forward raw message
    this._issueEvent(info);

    // kaia.btc.on() calls it
    if (info.event === 'usbDeviceDisconnected') {
      if (this.connected() && this._cmd.active)
        this._issueEvent({event: 'moveError', err: 'Disconnected', id: this._cmd.id});
      this._cmd.id = -1;
      this._cmd.active = false;
      this._reject('Disconnected');
    } else if (info.event === 'received') {
      let json;
      try {
        // "TBCB5F20 L221 R280 f291 l209 rD3 b1F3 t0 i25 VFFF v0.2.1\r\n"
        let s = '{'+(' '+info.message).replace(/[\r\n]+/g, '').replace(/ ([TLRVIflrbtvi])/g, '","$1":"').substr(2)+'"}';
        json = JSON.parse(s);
      } catch(error) {
        // Skip malformed message
        this._issueEvent({ event: 'parsed', err: 'Malformed message', message: info.message });
        return;
      }
      if (!json.T || !json.L || !json.R || !json.f || !json.l ||
          !json.r || !json.b || !json.t)
        return; // Skip malformed message
      let msg: any = {
        timeStamp: parseInt(json.T, 16),
        encLeft: this._encToSigned(parseInt(json.L, 16)),
        encRight: this._encToSigned(parseInt(json.R, 16)),
        distForward: parseInt(json.f, 16),
        distLeft: parseInt(json.l, 16),
        distRight: parseInt(json.r, 16),
        distBack: parseInt(json.b, 16),
        distTop: parseInt(json.t, 16),
        cmd: {id: 0, active: false},
      };
      if (json.i) {
        msg.cmd.id = parseInt(json.i, 16);
        msg.cmd.active = false;
      } else if (json.I) {
        msg.cmd.id = parseInt(json.I, 16);
        msg.cmd.active = true;
      } else
        return; // Skip malformed message
        
      if (json.V && json.v) {
        msg.vcc = parseInt(json.V, 16);
        msg.fw = json.v;
      }
      this._issueEvent({event: 'parsed', message: msg, err: false});
        
      // TODO move on('moveProgress')
      if (!this.connected()) {
        // (re)started receiving
        this._cmd.id = msg.cmd.id;
        this._cmd.active = msg.cmd.active;
        this._issueEvent({event: 'connected', err: false, id: this._cmd.id});
        this._resolve(this);
      } else if (this._cmd.active &&
                 this._cmd.id === msg.cmd.id &&
                 msg.cmd.active === false) {
        this._cmd.active = false;
        this._issueEvent({event: 'moveComplete', id: msg.cmd.id, err: false});
        this._resolve(this);
      }

      this._issueEvent({event: 'modelUpdating', model: this._model, err: false});
      this._model = this._updateModel(this._model, msg);
      this._issueEvent({event: 'modelUpdated', model: this._model, err: false});
    }
  }

  setEventListener(listener: any): void {
    if (!listener || typeof listener === 'function')
      this._listener = listener;
  }

  debug(debug: boolean) {
    this._debug = debug;
  }

  _issueEvent(event: any) {
    if (this._debug)
      console.log('_issueEvent(event) ' + JSON.stringify(event));
    if (this._listener)
      this._listener(event.err, event);
  }
	
  _initModel(): any  {
    this._model = {
      time: 0, // sec
      dTime: 0,
      dTimeMax: 0.2,
      x: 0,
      y:0,
      heading: 0,
      speed: 0, // linear speed
      angularSpeed: 0,
      accel: 0, // linear acceleration
      angularAccel: 0,
      encLeft: 0,
      encRight: 0,
      dEncLeft: 0,
      dEncRight: 0,
      wheelBase: 0.165, // meters
      wheelDia: 0.065, // meters
      encPulsesPerRev: 297.67, // 357.7*2, // 304
      epsilon: 1e-4,
      posValid: false,
      speedValid: false,
      accValid: false,
      default: { speed: 0.5, brake: true, p: 0x100, i: 0x10 }
    };
  }

  _updateModel(model: any, msg: any): any {
    // TODO handle 32-bit encoder overflow
    let newModel = Object.assign({}, model);
    let encToMeters = Math.PI * model.wheelDia / model.encPulsesPerRev;
    newModel.time = msg.timeStamp / 1000000;
    newModel.dTime = newModel.time - model.time;
    newModel.encLeft = msg.encLeft * encToMeters;
    newModel.encRight = msg.encRight * encToMeters;
    if (!model.posValid) {
      newModel.x = 0;
      newModel.y = 0;
      newModel.heading = 0;
      newModel.speed = 0;
      newModel.posValid = true;
      newModel.speedValid = false;
      newModel.accValid = false;
      return newModel;
    }

    let dX, dY, dHeading, dDistance, r;
    let dEncLeft = newModel.encLeft - model.encLeft;
    let dEncRight = newModel.encRight - model.encRight;
    if (Math.abs(dEncLeft - dEncRight) < model.epsilon) {
      let dEncAvg = (dEncLeft + dEncRight)/2;
      dX = dEncAvg * Math.sin(model.heading);
      dY = dEncAvg * Math.cos(model.heading);
      dHeading = 0;
      r = Infinity;
      dDistance = Math.sqrt(Math.pow(dX, 2) + Math.pow(dY, 2));
    } else {
      dHeading = (dEncRight - dEncLeft)/model.wheelBase;
      r = Math.abs(model.wheelBase*(dEncLeft/(dEncRight - dEncLeft) + 0.5));
      dX = r*(Math.sin(model.heading + dHeading) - Math.sin(model.heading));
      dY = r*(Math.cos(model.heading) - Math.cos(model.heading + dHeading));
      dDistance = r * dHeading;
    }
    newModel.dHeading = dHeading;
    newModel.dDistance = dDistance;
    newModel.heading = model.heading + dHeading;
    newModel.x = model.x + dX;
    newModel.y = model.y + dY;
    newModel.r = r;
    if (newModel.dTime > newModel.dTimeMax) {
      newModel.speedValid = false;
      newModel.accValid = false;
    } else {
      newModel.accValid = newModel.speedValid;
      newModel.speedValid = true;
    }

    newModel.speed = dDistance/newModel.dTime; // linear speed
    newModel.angularSpeed = dHeading/newModel.dTime;
    let dSpeed = newModel.speed - model.speed;
    let dAngularSpeed = newModel.angularSpeed - model.angularSpeed;
    newModel.accel = dSpeed/newModel.dTime; // linear acceleration
    newModel.angularAccel = dAngularSpeed/newModel.dTime;

    return newModel;
  }

  model(model: any) {
    if (model)
      //Object.assign(this._model, model);
      this._model = model;
    return this._model;
  }
  
  turn(angle: any, speed: any, args: any): Promise<any> {
    // angle in degrees; speed relative (for now)
    // args: stop, radius

    if (angle === undefined)
      throw 'Angle argument is required';
    if (typeof angle !== 'number')
      throw 'Angle must be a number (degrees)';
    if (speed === undefined)
      speed = this._model.default.speed;
    else if (typeof speed === 'object') {
      if (typeof args === 'object')
        throw 'Speed must be a number';
      args = speed;
      speed = this._model.default.speed;
    }

    // radius: inPlace, oneWheelStationary, meters to base midpoint
    args = args || {};
    let halfBase = this._model.wheelBase / 2;
    let radius = args.radius || 'oneWheelStationary';
    if (radius === 'inPlace')
      radius = 0;
    else if (radius === 'oneWheelStationary')
      radius = halfBase;
    else if (typeof radius !== 'number')
      throw 'Invalid radius';
    else if (radius < 0)
      throw 'Radius must be non-negative';
    if (angle === 0)
      throw 'Angle may not be 0';

    angle = angle * Math.PI / 180;
    let angleSign = Math.sign(angle);
    let radiusLeft = radius + angleSign*halfBase;
    let radiusRight = radius - angleSign*halfBase;

    let speedSign = Math.sign(speed);
    let angleAbs = Math.abs(angle);
    let speedAbs = Math.abs(speed);
    let speedRight;
    let speedLeft = speedRight = speedAbs;
    if (angle > 0)
      speedRight = Math.abs(speedAbs * radiusRight/radiusLeft);
    else 
      speedLeft = Math.abs(speedAbs * radiusLeft/radiusRight);

    args.distance = {
      left: angleAbs * speedSign * radiusLeft,
      right: angleAbs * speedSign * radiusRight
    };
    args.speed = {
      left: (args.distance.left === 0) ? 0 : speedLeft,
      right: (args.distance.right === 0) ? 0 :speedRight
    };

    return this.move(args, undefined);
  }

  move(args: any, speed: any): Promise<any> {
    args = args || {};
    if (typeof args === 'number')
      args = { 'distance': args };
    if (typeof args !== 'object')
      throw 'this.move(args[, speed]): args is object or number';

    // optional dist
    let distLeft, distRight;
    let dist = args.distance || 0;
    if (typeof args.distance === 'number')
      distLeft = distRight = args.distance;
    else {
      distRight = dist.right || 0;
      distLeft = dist.left || 0;
    }

    // TODO relative vs absolute speed
    // speed
    let speedLeft, speedRight;
    if (speed !== undefined)
      args.speed = speed;
    speed = args.speed || 0;

    if (typeof args.speed === 'number')
      speedLeft = speedRight = args.speed;
    else {
      speedLeft = (typeof speed.left === 'number') ? speed.left :
        ((distLeft === 0) ? 0 : this._model.default.speed);
      speedRight = (typeof speed.right === 'number') ? speed.right :
        ((distRight === 0) ? 0 : this._model.default.speed);
    }

    if (speedRight > 1 || speedRight < -1 || speedLeft > 1 || speedLeft < -1)
      throw 'Relative speed must be within -1.0 ... 1.0';

    if (distRight !== 0 && speedRight < 0 || distLeft !== 0 && speedLeft < 0)
      throw 'Speed value must be positive when distance is specified';

    if (distLeft !== 0)
      speedLeft = Math.abs(speedLeft) * Math.sign(distLeft);
    if (distRight !== 0)
      speedRight = Math.abs(speedRight) * Math.sign(distRight);

    // optional brake
    let brakeLeft, brakeRight, brake;
    if (args.brake === true)
      brakeLeft = brakeRight = true;
    else {
      brake = args.brake || {};
      brakeLeft = brake.left || this._model.default.brake;
      brakeRight = brake.right || this._model.default.brake;
    }

    let p = args.p || this._model.default.p || 0;
    let i = args.i || this._model.default.i || 0;

    // Don't use M for simplicity, easier test
    let msg =
      'L'  + (speedLeft  ? this._speedToHex(speedLeft)  : '') +
      ' R' + (speedRight ? this._speedToHex(speedRight) : '') + ' ' +
      (brakeLeft  ? 'G' : 'g') + (distLeft  ? this._distToHex(distLeft)  : '') + ' ' +
      (brakeRight ? 'H' : 'h') + (distRight ? this._distToHex(distRight) : '') + ' ';

    // Check if disconnected
    args.success = (this.connected());
    if (args.success) {
      if (distLeft !== 0 || distRight !== 0) {
        this._cmd.id++;
        this._cmd.active = true;
        msg += 'i' + this._cmd.id.toString(16);
        if (distLeft == distRight) {
          if (p)
            msg += ' P' + p.toString(16);
          if (i)
            msg += ' I' + i.toString(16);
        }
        msg += ' ';
      }
      args._cmd = {id: this._cmd.id};

      this.send(msg);
      this._issueEvent({event: 'move', args: args, err: false});
    } else {
      //this._issueEvent({event: 'moveError', args: args, err: 'Invalid parameters'});
      throw 'Invalid parameters';
    }

    //return args;
    return this._makePromise();
  }

  stop(args: any): Promise<any> {
    // {brake=true/false, brake: {left: true, right: false}
    // default brake=false
    args = args || {};
    if (typeof args !== 'object')
      throw 'Invalid arguments';

    let brakeLeft, brakeRight, brake, msg;
    if (args.brake === true)
      brakeLeft = brakeRight = true;
    else {
      brake = args.brake || {};
      brakeLeft = brake.left || false;
      brakeRight = brake.right || false;
    }
    // Don't use M to simplify code, testing
    /*
    if (args.brake.left && args.brake.right)
      msg = 'Mffff\r';
    else if (!args.brake.left && !args.brake.right)
      msg = 'M\r';
    else if (args.brake.left)
      msg = 'Lffff R\r';
    else if (args.brake.right)
      msg = 'Rffff L\r';
    else
      throw 'Invalid brake value';
    */
    msg = (brakeLeft ? 'Lffff ' : 'L ') + (brakeRight ? 'Rffff ' : 'R ');
    this.send(msg);
    this._issueEvent({event: 'stop', args: args, err: false});
    
    return Promise.resolve(this);
  }

  busy(): boolean {
    return this._cmd.active;
  }

  connected(): boolean {
    return this._cmd.id !== -1;
  }

  _encToSigned(val: any): any {
    return (val & 0x80000000) ? val - 0x100000000 : val;
  }

  _stopToSpeed(brake: boolean): any {
    return brake ? 'FF00' : '';
  }

  _speedToHex(speed: any): any {
    if (speed === 0)
      return '';
    speed = Math.round(speed * 255);
    return ((speed >= 0) ? speed : (0x10000 + speed)).toString(16);
  }

  _distToHex(dist: any): any {
    if (dist === 0)
      return '';
    dist = Math.round(dist * this._model.encPulsesPerRev /
      (Math.PI * this._model.wheelDia));
    return ((dist >= 0) ? dist : (0x100000000 + dist)).toString(16);
  }
  //function speedToSigned(val) {
  //  return (val & 0x8000) ? val - 0x10000 : val;
  //} 
  _clearCallback(): void {
    this._resolveFunc = null;
    this._rejectFunc = null;
  }

  _resolve(res: any): void {
    let cb = this._resolveFunc;
    this._clearCallback();
    if (cb !== null)
      cb(res);
  }

  _reject(err: any): void {
    let cb = this._rejectFunc;
    this._clearCallback();
    if (cb !== null)
      cb(err);
  }  

  _makePromise(): Promise<any> {
    let promise = new Promise<any>((resolve, reject) => {
      this._resolveFunc = resolve;
      this._rejectFunc = reject;
    });
    return promise;
  }
}

export async function createScout(params: any) {
  if (Scout.scout)
    return Promise.resolve(Scout.scout);
  Scout.scout = new Scout();
  return Scout.scout.init(params);
}

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
  serial: any;
  _listener: any;
  _debug: boolean = false;
  _model: any;
  static _created: boolean = false;

  // TODO events {err: err, event: event, ...} signature
  // TODO rename _postEvent to _issueEvent
  // TODO move, turn, stop(?) async

  constructor() {
    if (Scout.singleton())
      throw 'Only one instance allowed';
    Scount._created = true;
  }

  async init(params: any): Promise<any> {
    params = params || {};
    this.setSerial(params.serial);
    this.setEventListener(params.eventListener);
    this.debug(params.debug);

    // TODO remove : from Scout messages  
    this._initModel();
    this.conn.autoDetect = true;
    this.cmd = {id: -1, active: false};		
  }
	
  setSerial(serial: any) {
    if (!serial || typeof serial === 'function') {
      if (this._serial)
        this._serial.setEventListener(null);
      this._serial = serial;
    }
    if (this._serial)
      this._serial.setEventListener(serialEventListener);
  }

  write(text: string) {
    if (this._serial)
      throw 'Serial required';
    this._postEvent({event: 'write', message: text});
    if (this._debug)
      console.log('this._serial.write(text) ' + text);
    const res: any = this._serial.write(text);
    return res.err;
  }

  serialEventListener(err: any, info: any) {
    // Forward raw message
    this._postEvent(info);

    // kaia.btc.on() calls it
    if (info.event === 'disconnected') {
      if (this.isConnected() && this.cmd.active) {
        this.postEvent({event: 'moveError', id: this.cmd.id});
      }
      this.cmd.id = -1;
      this.cmd.active = false;
    } else if (info.event === 'received') {
      try {
        // "TBCB5F20 L221 R280 f291 l209 rD3 b1F3 t0 i25 VFFF v0.2.1\r"
        var s = '{'+(' '+info.msg).replace(/\r/g, '').replace(/ ([TLRVIflrbtvi])/g, '","$1":"').substr(2)+'"}';
        json = JSON.parse(s);
      } catch(error) {
        // Skip malformed message
        return;
      }
      if (!json.T || !json.L || !json.R || !json.f || !json.l ||
          !json.r || !json.b || !json.t)
        return; // Skip malformed message
      var msg = {
          timeStamp: parseInt(json.T, 16),
          encLeft: encToSigned(parseInt(json.L, 16)),
          encRight: encToSigned(parseInt(json.R, 16)),
          distForward: parseInt(json.f, 16),
          distLeft: parseInt(json.l, 16),
          distRight: parseInt(json.r, 16),
          distBack: parseInt(json.b, 16),
          distTop: parseInt(json.t, 16),
          cmd: {id: 0, active: false}
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
      this.postEvent({event: 'parsed', msg: msg});
        
      // TODO move on('moveProgress')
      if (!this.isConnected()) {
        // (re)started receiving
        this.cmd.id = msg.cmd.id;
        this.cmd.active = msg.cmd.active;
      } else if (this.cmd.active &&
                 this.cmd.id === msg.cmd.id &&
                 msg.cmd.active === false) {
        this.cmd.active = false;
        this.postEvent({event: 'moveComplete', id: msg.cmd.id});        
      }

      this.model = this.updateModel(
        this.model, msg);
      this.postEvent({event: 'model', model: this.model});
    }
  }

  setEventListener(listener: any): void {
    if (!listener || typeof listener === 'function')
      this._listener = listener;
  }

  debug(debug: boolean) {
    this._debug = debug;
  }

  _postEvent(event: any) {
    // TODO err, data signature
    // TODO rename to issueEvent
    if (this._debug)
      console.log('this._postEvent(event) ' + JSON.stringify(event));
    if (this._listener)
      this._listener(event);
  }
	
  _initModel()  {
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
    var newModel = Object.assign({}, model);
    encToMeters = Math.PI * model.wheelDia / model.encPulsesPerRev;
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

    dEncLeft = newModel.encLeft - model.encLeft;
    dEncRight = newModel.encRight - model.encRight;
    if (Math.abs(dEncLeft - dEncRight) < model.epsilon) {
      dEncAvg = (dEncLeft + dEncRight)/2;
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
    dSpeed = newModel.speed - model.speed;
    dAngularSpeed = newModel.angularSpeed - model.angularSpeed;
    newModel.accel = dSpeed/newModel.dTime; // linear acceleration
    newModel.angularAccel = dAngularSpeed/newModel.dTime;

    return newModel;
  }

  setModel(model: any) {
    Object.assign(this._model, model);
  }

  getModel() {
    return this._model;
  };

  //  this.comm = function() {};
  //  this.cmd = function() {};
  //  this.comm.conn = function() {};
  
  turn(angle: any, speed: any, args: any): any {
    // angle in degrees; speed relative (for now)
    // args: stop, radius

    if (angle === undefined)
      throw 'Angle argument is required';
    if (typeof angle !== 'number')
      throw 'Angle must be a number (degrees)';
    if (speed === undefined)
      speed = this.model.default.speed;
    else if (typeof speed === 'object') {
      if (typeof args === 'object')
        throw 'speed must be a number';
      args = speed;
      speed = this.model.default.speed;
    }

    // radius: inPlace, oneWheelStationary, meters to base midpoint
    args = args || {};
    halfBase = this.model.wheelBase / 2;
    radius = args.radius || 'oneWheelStationary';
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
    angleSign = Math.sign(angle);
    radiusLeft = radius + angleSign*halfBase;
    radiusRight = radius - angleSign*halfBase;

    speedSign = Math.sign(speed);
    angleAbs = Math.abs(angle);
    speedAbs = Math.abs(speed);
    speedLeft = speedRight = speedAbs;
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

    return this.move(args);
  }

  move(args: any, speed: any): any {
    args = args || {};
    if (typeof args === 'number')
      args = { 'distance': args };
    if (typeof args !== 'object')
      throw 'this.move(args[, speed]): args is object or number';

    // optional dist
    var distLeft, distRight;
    dist = args.distance || 0;
    if (typeof args.distance === 'number')
      distLeft = distRight = args.distance;
    else {
      distRight = dist.right || 0;
      distLeft = dist.left || 0;
    }

    // TODO relative vs absolute speed
    // speed
    var speedLeft, speedRight;
    if (speed !== undefined)
      args.speed = speed;
    speed = args.speed || 0;

    if (typeof args.speed === 'number')
      speedLeft = speedRight = args.speed;
    else {
      speedLeft = (typeof speed.left === 'number') ? speed.left :
        ((distLeft === 0) ? 0 : this.model.default.speed);
      speedRight = (typeof speed.right === 'number') ? speed.right :
        ((distRight === 0) ? 0 : this.model.default.speed);
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
    var brakeLeft, brakeRight;
    if (args.brake === true)
      brakeLeft = brakeRight = true;
    else {
      brake = args.brake || {};
      brakeLeft = brake.left || this.model.default.brake;
      brakeRight = brake.right || this.model.default.brake;
    }

    let p = args.p || this.model.default.p || 0;
    let i = args.i || this.model.default.i || 0;

    // Don't use M for simplicity, easier test
    msg =
      'L'  + (speedLeft  ? speedToHex(speedLeft)  : '') +
      ' R' + (speedRight ? speedToHex(speedRight) : '') + ' ' +
      (brakeLeft  ? 'G' : 'g') + (distLeft  ? distToHex(distLeft)  : '') + ' ' +
      (brakeRight ? 'H' : 'h') + (distRight ? distToHex(distRight) : '') + ' ';

    // Check if disconnected
    args.success = (this.isConnected());
    if (args.success) {
      if (distLeft !== 0 || distRight !== 0) {
        this.cmd.id++;
        this.cmd.active = true;
        msg += 'i' + this.cmd.id.toString(16);
        if (distLeft == distRight) {
          if (p)
            msg += ' P' + p.toString(16);
          if (i)
            msg += ' I' + i.toString(16);
        }
        msg += ' ';
      }
      args.cmd = {id: this.cmd.id};

      this._write(msg);
      this._postEvent({event: 'move', args: args});
    } else
      this._postEvent({event: 'moveError', args: args});

    return args;
  }

  stop(args: any) {
    // {brake=true/false, brake: {left: true, right: false}
    // default brake=false
    args = args || {};
    if (typeof args !== 'object')
      throw 'this.stop(args) expects object or no argument';

    var brakeLeft, brakeRight;
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
      msg = "Mffff\r";
    else if (!args.brake.left && !args.brake.right)
      msg = "M\r";
    else if (args.brake.left)
      msg = "Lffff R\r";
    else if (args.brake.right)
      msg = "Rffff L\r";
    else
      throw "Invalid brake value";
    */
    msg = (brakeLeft ? 'Lffff ' : 'L ') + (brakeRight ? 'Rffff ' : 'R ');
    this.send(msg);
    this.postEvent({event: 'stop', args: args});
  }

  _isCmdActive(): boolean {
    return this._cmd.active;
  }

  _isConnected(): boolean {
    return this._cmd.id !== -1;
  }

  _encToSigned(val: any): any {
    return (val & 0x80000000) ? val - 0x100000000 : val;
  }

  _stopToSpeed(brake: boolean): any {
    return brake ? 'FF00' : '';
  }

  _speedToHex(speed): any {
    if (speed === 0)
      return '';
    speed = Math.round(speed * 255);
    return ((speed >= 0) ? speed : (0x10000 + speed)).toString(16);
  }

  _distToHex(dist: any): any {
    if (dist === 0)
      return '';
    dist = Math.round(dist * this.model.encPulsesPerRev /
      (Math.PI * this.model.wheelDia));
    return ((dist >= 0) ? dist : (0x100000000 + dist)).toString(16);
  }
  //function speedToSigned(val) {
  //  return (val & 0x8000) ? val - 0x10000 : val;
  //} 
}

let scout: Scout;
export async function createScout(params: any) {
  if (scout)
    return Promise.resolve(scout);
  scout = new Scout();
  return scout.init(params);
}

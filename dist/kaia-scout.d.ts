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
export declare class Scout {
    _serial: any;
    _listener: any;
    _debug: boolean;
    _model: any;
    _cmd: any;
    _conn: any;
    static _created: boolean;
    constructor();
    init(params: any): Promise<any>;
    setSerial(serial: any): void;
    send(text: string): any;
    _serialEventListener(err: any, info: any): void;
    setEventListener(listener: any): void;
    debug(debug: boolean): void;
    _issueEvent(event: any): void;
    _initModel(): any;
    _updateModel(model: any, msg: any): any;
    setModel(model: any): void;
    getModel(): any;
    turn(angle: any, speed: any, args: any): any;
    move(args: any, speed: any): any;
    stop(args: any): void;
    _isCmdActive(): boolean;
    connected(): boolean;
    _encToSigned(val: any): any;
    _stopToSpeed(brake: boolean): any;
    _speedToHex(speed: any): any;
    _distToHex(dist: any): any;
}
export declare function createScout(params: any): Promise<any>;

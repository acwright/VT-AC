"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VTAC = void 0;
const sdl_1 = __importDefault(require("@kmamal/sdl"));
const serialport_1 = require("serialport");
class VTAC {
    constructor() {
        this.baudRate = 115200;
        this.parity = 'none';
        this.stopBits = 1;
        this.scale = 2;
        this.buffer = Buffer.alloc(320 * 240 * 4);
    }
    launch() {
        if (this.path) {
            this.port = new serialport_1.SerialPort({
                path: this.path,
                baudRate: this.baudRate,
                parity: this.parity,
                stopBits: this.stopBits
            }, function (err) {
                if (err) {
                    return console.log('Error: ', err.message);
                }
            });
            this.port.on('data', function (data) {
                console.log('Data:', data);
            });
        }
        this.window = sdl_1.default.video.createWindow({
            title: "VT-AC",
            width: 320 * this.scale,
            height: 240 * this.scale
        });
        this.window.on('keyDown', (event) => {
            this.onKey(event);
        });
        this.window.on('textInput', (event) => {
            this.onText(event);
        });
        this.window.on('close', (event) => {
            var _a;
            (_a = this.port) === null || _a === void 0 ? void 0 : _a.close();
        });
        let offset = 0;
        for (let i = 0; i < 240; i++) {
            for (let j = 0; j < 320; j++) {
                this.buffer[offset++] = Math.floor(Math.random() * 255); // R
                this.buffer[offset++] = Math.floor(Math.random() * 255); // G
                this.buffer[offset++] = Math.floor(Math.random() * 255); // B
                this.buffer[offset++] = 255; // A
            }
        }
        this.window.render(320, 240, 320 * 4, 'rgba32', this.buffer);
    }
    onKey(event) {
        switch (event.key) {
            case 'enter':
            case 'return':
                console.log('Return pressed');
                break;
            default:
                break;
        }
    }
    onText(event) {
        console.log(event.text);
    }
}
exports.VTAC = VTAC;
//# sourceMappingURL=VTAC.js.map
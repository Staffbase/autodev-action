"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@actions/core");
const autodev_1 = __importDefault(require("./autodev"));
(0, autodev_1.default)().catch((error) => {
    (0, core_1.setFailed)(error);
});

import * as fc from "fast-check";

import {
  toValidEnvName,
  toValidScriptFormat,
  toValidScriptName,
  type ValidEnvName,
  type ValidScriptFormat,
  type ValidScriptName,
} from "../script-name-parsing/index.js";

export const arbDate = fc
  .integer({
    min: new Date("2020-01-01").getTime(),
    max: new Date("2030-12-31").getTime(),
  })
  .map((ts) => new Date(ts))
  .filter((d) => !isNaN(d.getTime()));

export const arbFormat = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter((s): s is ValidScriptFormat => {
    try {
      toValidScriptFormat(s);
      return true;
    } catch {
      return false;
    }
  });

export const arbEnv = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s): s is ValidEnvName => {
    try {
      toValidEnvName(s);
      return true;
    } catch {
      return false;
    }
  });

export const arbUserName = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s): s is ValidScriptName => {
    try {
      toValidScriptName(s, false);
      return true;
    } catch {
      return false;
    }
  });

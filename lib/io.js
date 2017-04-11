/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2017 eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

let {IO: LegacyIO} = require("legacyIO");
let {Utils} = require("utils");

let webextension = require("webextension");
let messageID = 0;
let messageCallbacks = new Map();

webextension.then(port =>
{
  port.onMessage.addListener(message =>
  {
    let {id} = message;
    let callbacks = messageCallbacks.get(id);
    if (callbacks)
    {
      messageCallbacks.delete(id);

      if (message.success)
        callbacks.resolve(message.result);
      else
        callbacks.reject(message.result);
    }
  });
});

function callWebExt(method, ...args)
{
  return webextension.then(port =>
  {
    return new Promise((resolve, reject) =>
    {
      let id = ++messageID;
      messageCallbacks.set(id, {resolve, reject});
      port.postMessage({id, method, args});
    });
  });
}

function callLegacy(method, ...args)
{
  return new Promise((resolve, reject) =>
  {
    LegacyIO[method](...args, (error, result) =>
    {
      if (error)
        reject(error);
      else
        resolve(result);
    });
  });
}

function legacyFile(fileName)
{
  let file = LegacyIO.resolveFilePath("adblockplus");
  file.append(fileName);
  return file;
}

exports.IO =
{
  /**
   * @callback TextSink
   * @param {string} line
   */

  /**
   * Reads text lines from a file.
   * @param {string} fileName
   *    Name of the file to be read
   * @param {TextSink} listener
   *    Function that will be called for each line in the file
   * @return {Promise}
   *    Promise to be resolved or rejected once the operation is completed
   */
  readFromFile(fileName, listener)
  {
    return callWebExt("readFromFile", fileName).then(contents =>
    {
      return new Promise((resolve, reject) =>
      {
        let lineIndex = 0;

        function processBatch()
        {
          while (lineIndex < contents.length)
          {
            listener(contents[lineIndex++]);
            if (lineIndex % 1000 == 0)
            {
              Utils.runAsync(processBatch);
              return;
            }
          }
          resolve();
        }

        processBatch();
      });
    }).catch(error =>
    {
      if (error == "NoSuchFile")
      {
        let wrapper = {
          process(line)
          {
            if (line !== null)
              listener(line);
          }
        };
        return callLegacy("readFromFile", legacyFile(fileName), wrapper);
      }
      throw error;
    });
  },

  /**
   * Writes text lines to a file.
   * @param {string} fileName
   *    Name of the file to be written
   * @param {Iterable.<string>} data
   *    An array-like or iterable object containing the lines (without line
   *    endings)
   * @return {Promise}
   *    Promise to be resolved or rejected once the operation is completed
   */
  writeToFile(fileName, data)
  {
    return callWebExt("writeToFile", fileName, Array.from(data));
  },

  /**
   * Copies a file.
   * @param {string} fromFile
   *    Name of the file to be copied
   * @param {string} toFile
   *    Name of the file to be written, will be overwritten if exists
   * @return {Promise}
   *    Promise to be resolved or rejected once the operation is completed
   */
  copyFile(fromFile, toFile)
  {
    return callWebExt("copyFile", fromFile, toFile).catch(error =>
    {
      if (error == "NoSuchFile")
        return callLegacy("copyFile", legacyFile(fromFile), legacyFile(toFile));
      throw error;
    });
  },

  /**
   * Renames a file.
   * @param {string} fromFile
   *    Name of the file to be renamed
   * @param {string} newName
   *    New file name, will be overwritten if exists
   * @return {Promise}
   *    Promise to be resolved or rejected once the operation is completed
   */
  renameFile(fromFile, newName)
  {
    return callWebExt("renameFile", fromFile, newName).catch(error =>
    {
      if (error == "NoSuchFile")
        return callLegacy("renameFile", legacyFile(fromFile), newName);
      throw error;
    });
  },

  /**
   * Removes a file.
   * @param {string} fileName
   *    Name of the file to be removed
   * @return {Promise}
   *    Promise to be resolved or rejected once the operation is completed
   */
  removeFile(fileName)
  {
    return callWebExt("removeFile", fileName).catch(error =>
    {
      if (error == "NoSuchFile")
        return callLegacy("removeFile", legacyFile(fileName));
      throw error;
    });
  },

  /**
   * @typedef StatData
   * @type {object}
   * @property {boolean} exists
   *    true if the file exists
   * @property {number} lastModified
   *    file modification time in milliseconds
   */

  /**
   * Retrieves file metadata.
   * @param {string} fileName
   *    Name of the file to be looked up
   * @return {Promise.<StatData>}
   *    Promise to be resolved with file metadata once the operation is
   *    completed
   */
  statFile(fileName)
  {
    return callWebExt("statFile", fileName).catch(error =>
    {
      if (error == "NoSuchFile")
        return callLegacy("statFile", legacyFile(fileName));
      throw error;
    });
  }
};

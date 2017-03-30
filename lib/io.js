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

function attachCallback(promise, callback, fallback)
{
  promise.then(result =>
  {
    callback(null, result);
  }).catch(error =>
  {
    if (fallback && error == "NoSuchFile")
      fallback();
    else
      callback(error);
  });
}

exports.IO =
{
  resolveFilePath: LegacyIO.resolveFilePath,

  /**
   * Reads strings from a file asynchronously, calls listener.process() with
   * each line read and with a null parameter once the read operation is done.
   * The callback will be called when the operation is done.
   */
  readFromFile(/**nsIFile*/ file, /**Object*/ listener, /**Function*/ callback)
  {
    attachCallback(
      callWebExt("readFromFile", file.leafName).then(contents =>
      {
        return new Promise((resolve, reject) =>
        {
          let lineIndex = 0;

          function processBatch()
          {
            while (lineIndex < contents.length)
            {
              listener.process(contents[lineIndex++]);
              if (lineIndex % 1000 == 0)
              {
                Utils.runAsync(processBatch);
                return;
              }
            }

            listener.process(null);
            resolve();
          }

          processBatch();
        });
      }),
      callback,
      () => LegacyIO.readFromFile(file, listener, callback)
    );
  },

  /**
   * Writes string data to a file in UTF-8 format asynchronously. The callback
   * will be called when the write operation is done.
   */
  writeToFile(/**nsIFile*/ file, /**Iterator*/ data, /**Function*/ callback)
  {
    attachCallback(
      callWebExt("writeToFile", file.leafName, Array.from(data)),
      callback
    );
  },

  /**
   * Copies a file asynchronously. The callback will be called when the copy
   * operation is done.
   */
  copyFile(/**nsIFile*/ fromFile, /**nsIFile*/ toFile, /**Function*/ callback)
  {
    attachCallback(
      callWebExt("copyFile", fromFile.leafName, toFile.leafName),
      callback,
      () => LegacyIO.copyFile(fromFile, toFile, callback)
    );
  },

  /**
   * Renames a file within the same directory, will call callback when done.
   */
  renameFile(/**nsIFile*/ fromFile, /**String*/ newName, /**Function*/ callback)
  {
    attachCallback(
      callWebExt("renameFile", fromFile.leafName, newName),
      callback,
      () => LegacyIO.renameFile(fromFile, newName, callback)
    );
  },

  /**
   * Removes a file, will call callback when done.
   */
  removeFile(/**nsIFile*/ file, /**Function*/ callback)
  {
    attachCallback(
      callWebExt("removeFile", file.leafName),
      callback,
      () => LegacyIO.removeFile(file, callback)
    );
  },

  /**
   * Gets file information such as whether the file exists.
   */
  statFile(/**nsIFile*/ file, /**Function*/ callback)
  {
    attachCallback(
      callWebExt("statFile", file.leafName),
      callback,
      () => LegacyIO.statFile(file, callback)
    );
  }
};

/*
 * This file is part of Adblock Plus <http://adblockplus.org/>,
 * Copyright (C) 2006-2014 Eyeo GmbH
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

/**
 * @fileOverview Module containing file I/O helpers.
 */

let {Services} = Cu.import("resource://gre/modules/Services.jsm", null);
let {FileUtils} = Cu.import("resource://gre/modules/FileUtils.jsm", null);
let {OS} = Cu.import("resource://gre/modules/osfile.jsm", null);
let {Task} = Cu.import("resource://gre/modules/Task.jsm", null);

let {Prefs} = require("prefs");
let {Utils} = require("utils");

let firstRead = true;
const BUFFER_SIZE = 0x80000;  // 512kB

let IO = exports.IO =
{
  /**
   * Retrieves the platform-dependent line break string.
   */
  get lineBreak()
  {
    let lineBreak = (Services.appinfo.OS == "WINNT" ? "\r\n" : "\n");
    Object.defineProperty(this, "lineBreak", {value: lineBreak});
    return lineBreak;
  },

  /**
   * Tries to interpret a file path as an absolute path or a path relative to
   * user's profile. Returns a file or null on failure.
   */
  resolveFilePath: function(/**String*/ path) /**nsIFile*/
  {
    if (!path)
      return null;

    try {
      // Assume an absolute path first
      return new FileUtils.File(path);
    } catch (e) {}

    try {
      // Try relative path now
      return FileUtils.getFile("ProfD", path.split("/"));
    } catch (e) {}

    return null;
  },

  /**
   * Reads strings from a file asynchronously, calls listener.process() with
   * each line read and with a null parameter once the read operation is done.
   * The callback will be called when the operation is done.
   */
  readFromFile: function(/**nsIFile*/ file, /**Object*/ listener, /**Function*/ callback)
  {
    try
    {
      let processing = false;
      let buffer = "";
      let loaded = false;
      let error = null;

      let onProgress = function(data)
      {
        let index = (processing ? -1 : Math.max(data.lastIndexOf("\n"), data.lastIndexOf("\r")));
        if (index >= 0)
        {
          // Protect against reentrance in case the listener processes events.
          processing = true;
          try
          {
            let oldBuffer = buffer;
            buffer = data.substr(index + 1);
            data = data.substr(0, index + 1);
            let lines = data.split(/[\r\n]+/);
            lines.pop();
            lines[0] = oldBuffer + lines[0];
            for (let i = 0; i < lines.length; i++)
              listener.process(lines[i]);
          }
          finally
          {
            processing = false;
            data = buffer;
            buffer = "";
            onProgress(data);

            if (loaded)
            {
              loaded = false;
              onSuccess();
            }

            if (error)
            {
              let param = error;
              error = null;
              onError(param);
            }
          }
        }
        else
          buffer += data;
      };

      let onSuccess = function()
      {
        if (processing)
        {
          // Still processing data, delay processing this event.
          loaded = true;
          return;
        }

        if (buffer !== "")
          listener.process(buffer);
        listener.process(null);

        callback(null);
      };

      let onError = function(e)
      {
        if (processing)
        {
          // Still processing data, delay processing this event.
          error = e;
          return;
        }

        callback(e);
      };

      let decoder = new TextDecoder();
      Task.spawn(function()
      {
        if (firstRead && Services.vc.compare(Utils.platformVersion, "23.0a1") <= 0)
        {
          // See https://issues.adblockplus.org/ticket/530 - the first file
          // opened cannot be closed due to Gecko bug 858723. Make sure that
          // our patterns.ini file doesn't stay locked by opening a dummy file
          // first.
          try
          {
            let dummyPath = IO.resolveFilePath(Prefs.data_directory + "/dummy").path;
            let dummy = yield OS.File.open(dummyPath, {write: true, truncate: true});
            yield dummy.close();
          }
          catch (e)
          {
            // Dummy might be locked already, we don't care
          }
        }
        firstRead = false;

        let f = yield OS.File.open(file.path, {read: true});
        while (true)
        {
          let array = yield f.read(BUFFER_SIZE);
          if (!array.length)
            break;

          let data = decoder.decode(array, {stream: true});
          onProgress(data);
        }
        yield f.close();
      }.bind(this)).then(onSuccess, onError);
    }
    catch (e)
    {
      callback(e);
    }
  },

  /**
   * Writes string data to a file in UTF-8 format asynchronously. The callback
   * will be called when the write operation is done.
   */
  writeToFile: function(/**nsIFile*/ file, /**Iterator*/ data, /**Function*/ callback)
  {
    try
    {
      let encoder = new TextEncoder();

      Task.spawn(function()
      {
        // This mimics OS.File.writeAtomic() but writes in chunks.
        let tmpPath = file.path + ".tmp";
        let f = yield OS.File.open(tmpPath, {write: true, truncate: true});

        let buf = [];
        let bufLen = 0;
        let lineBreak = this.lineBreak;

        function writeChunk()
        {
          let array = encoder.encode(buf.join(lineBreak) + lineBreak);
          buf = [];
          bufLen = 0;
          return f.write(array);
        }

        for (let line in data)
        {
          buf.push(line);
          bufLen += line.length;
          if (bufLen >= BUFFER_SIZE)
            yield writeChunk();
        }

        if (bufLen)
          yield writeChunk();

        // OS.File.flush() isn't exposed prior to Gecko 27, see bug 912457.
        if (typeof f.flush == "function")
          yield f.flush();
        yield f.close();
        yield OS.File.move(tmpPath, file.path, {noCopy: true});
      }.bind(this)).then(callback.bind(null, null), callback);
    }
    catch (e)
    {
      callback(e);
    }
  },

  /**
   * Copies a file asynchronously. The callback will be called when the copy
   * operation is done.
   */
  copyFile: function(/**nsIFile*/ fromFile, /**nsIFile*/ toFile, /**Function*/ callback)
  {
    try
    {
      let promise = OS.File.copy(fromFile.path, toFile.path);
      promise.then(callback.bind(null, null), callback);
    }
    catch (e)
    {
      callback(e);
    }
  },

  /**
   * Renames a file within the same directory, will call callback when done.
   */
  renameFile: function(/**nsIFile*/ fromFile, /**String*/ newName, /**Function*/ callback)
  {
    try
    {
      toFile = fromFile.clone();
      toFile.leafName = newName;
      let promise = OS.File.move(fromFile.path, toFile.path);
      promise.then(callback.bind(null, null), callback);
    }
    catch(e)
    {
      callback(e);
    }
  },

  /**
   * Removes a file, will call callback when done.
   */
  removeFile: function(/**nsIFile*/ file, /**Function*/ callback)
  {
    try
    {
      let promise = OS.File.remove(file.path);
      promise.then(callback.bind(null, null), callback);
    }
    catch(e)
    {
      callback(e);
    }
  },

  /**
   * Gets file information such as whether the file exists.
   */
  statFile: function(/**nsIFile*/ file, /**Function*/ callback)
  {
    try
    {
      let promise = OS.File.stat(file.path);
      promise.then(function onSuccess(info)
      {
        callback(null, {
          exists: true,
          isDirectory: info.isDir,
          isFile: !info.isDir,
          lastModified: info.lastModificationDate.getTime()
        });
      }, function onError(e)
      {
        if (e.becauseNoSuchFile)
        {
          callback(null, {
            exists: false,
            isDirectory: false,
            isFile: false,
            lastModified: 0
          });
        }
        else
          callback(e);
      });
    }
    catch(e)
    {
      callback(e);
    }
  }
}

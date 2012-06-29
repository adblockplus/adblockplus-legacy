/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Module containing file I/O helpers.
 */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

let {TimeLine} = require("timeline");

let IO = exports.IO =
{
  /**
   * Retrieves the platform-dependent line break string.
   */
  get lineBreak()
  {
    let lineBreak = (Services.appinfo.OS == "WINNT" ? "\r\n" : "\n");
    delete IO.lineBreak;
    IO.__defineGetter__("lineBreak", function() lineBreak);
    return IO.lineBreak;
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
  readFromFile: function(/**nsIFile|nsIURI*/ file, /**Boolean*/ decode, /**Object*/ listener, /**Function*/ callback, /**String*/ timeLineID)
  {
    try
    {
      let uri = file instanceof Ci.nsIFile ? Services.io.newFileURI(file) : file;
      let channel = Services.io.newChannelFromURI(uri);
      channel.contentType = "text/plain";
      let converter = null;
      if (decode)
      {
        converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Ci.nsIScriptableUnicodeConverter);
        converter.charset = "utf-8";
      }

      channel.asyncOpen({
        buffer: "",
        QueryInterface: XPCOMUtils.generateQI([Ci.nsIRequestObserver, Ci.nsIStreamListener]),
        onStartRequest: function(request, context) {},
        onDataAvailable: function(request, context, stream, offset, count)
        {
          if (timeLineID)
          {
            TimeLine.asyncStart(timeLineID);
          }

          let data = this.buffer + NetUtil.readInputStreamToString(stream, count);
          let index = Math.max(data.lastIndexOf("\n"), data.lastIndexOf("\r"));
          if (index >= 0)
          {
            this.buffer = data.substr(index + 1);
            data = data.substr(0, index + 1);
            if (converter)
              data = converter.ConvertToUnicode(data);

            let lines = data.split(/[\r\n]+/);
            lines.pop();
            for (let i = 0; i < lines.length; i++)
              listener.process(lines[i]);
          }
          else
            this.buffer = data;

          if (timeLineID)
          {
            TimeLine.asyncEnd(timeLineID);
          }
        },
        onStopRequest: function(request, context, result)
        {
          if (timeLineID)
          {
            TimeLine.asyncStart(timeLineID);
          }

          if (Components.isSuccessCode(result) && this.buffer.length)
            listener.process(this.buffer);
          listener.process(null);

          if (timeLineID)
          {
            TimeLine.asyncEnd(timeLineID);
            TimeLine.asyncDone(timeLineID);
          }

          if (!Components.isSuccessCode(result))
          {
            let e = Cc["@mozilla.org/js/xpc/Exception;1"].createInstance(Ci.nsIXPCException);
            e.initialize("File read operation failed", result, null, Components.stack, file, null);
            callback(e);
          }
          else
            callback(null);
        }
      }, null);
    }
    catch (e)
    {
      callback(e);
    }
  },

  /**
   * Writes string data to a file asynchronously, optionally encodes it into
   * UTF-8 first. The callback will be called when the write operation is done.
   */
  writeToFile: function(/**nsIFile*/ file, /**Boolean*/ encode, /**Iterator*/ data, /**Function*/ callback, /**String*/ timeLineID)
  {
    try
    {
      let fileStream = FileUtils.openSafeFileOutputStream(file, FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_TRUNCATE);

      let pipe = Cc["@mozilla.org/pipe;1"].createInstance(Ci.nsIPipe);
      pipe.init(true, true, 0, 0x8000, null);

      let outStream = pipe.outputStream;
      if (encode)
      {
        outStream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
        outStream.init(pipe.outputStream, "UTF-8", 0, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
      }

      let copier = Cc["@mozilla.org/network/async-stream-copier;1"].createInstance(Ci.nsIAsyncStreamCopier);
      copier.init(pipe.inputStream, fileStream, null, true, false, 0x8000, true, true);
      copier.asyncCopy({
        onStartRequest: function(request, context) {},
        onStopRequest: function(request, context, result)
        {
          if (timeLineID)
          {
            TimeLine.asyncDone(timeLineID);
          }

          if (!Components.isSuccessCode(result))
          {
            let e = Cc["@mozilla.org/js/xpc/Exception;1"].createInstance(Ci.nsIXPCException);
            e.initialize("File write operation failed", result, null, Components.stack, file, null);
            callback(e);
          }
          else
            callback(null);
        }
      }, null);

      let lineBreak = this.lineBreak;
      function writeNextChunk()
      {
        let buf = [];
        let bufLen = 0;
        while (bufLen < 0x4000)
        {
          try
          {
            let str = data.next();
            buf.push(str);
            bufLen += str.length;
          }
          catch (e)
          {
            if (e instanceof StopIteration)
              break;
            else if (typeof e == "number")
              pipe.outputStream.closeWithStatus(e);
            else if (e instanceof Ci.nsIException)
              pipe.outputStream.closeWithStatus(e.result);
            else
            {
              Cu.reportError(e);
              pipe.outputStream.closeWithStatus(Cr.NS_ERROR_FAILURE);
            }
            return;
          }
        }

        pipe.outputStream.asyncWait({
          onOutputStreamReady: function()
          {
            if (timeLineID)
            {
              TimeLine.asyncStart(timeLineID);
            }

            if (buf.length)
            {
              let str = buf.join(lineBreak) + lineBreak;
              if (encode)
                outStream.writeString(str);
              else
                outStream.write(str, str.length);
              writeNextChunk();
            }
            else
              outStream.close();

            if (timeLineID)
            {
              TimeLine.asyncEnd(timeLineID);
            }
          }
        }, 0, 0, Services.tm.currentThread);
      }
      writeNextChunk();
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
      let inStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
      inStream.init(fromFile, FileUtils.MODE_RDONLY, 0, Ci.nsIFileInputStream.DEFER_OPEN);

      let outStream = FileUtils.openFileOutputStream(toFile, FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_TRUNCATE);

      NetUtil.asyncCopy(inStream, outStream, function(result)
      {
        if (!Components.isSuccessCode(result))
        {
          let e = Cc["@mozilla.org/js/xpc/Exception;1"].createInstance(Ci.nsIXPCException);
          e.initialize("File write operation failed", result, null, Components.stack, file, null);
          callback(e);
        }
        else
          callback(null);
      });
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
      fromFile.moveTo(null, newName);
      callback(null);
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
      file.remove(false);
      callback(null);
    }
    catch(e)
    {
      callback(e);
    }
  }
}

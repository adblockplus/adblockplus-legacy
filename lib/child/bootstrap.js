/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2015 Eyeo GmbH
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

(function()
{
  const Cc = Components.classes;
  const Ci = Components.interfaces;
  const Cr = Components.results;
  const Cu = Components.utils;

  let {Loader, main, unload} = Cu.import("resource://gre/modules/commonjs/toolkit/loader.js", {});
  let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

  let loader = null;

  let shutdownHandlers = [];
  let onShutdown =
  {
    done: false,
    add: function(handler)
    {
      if (shutdownHandlers.indexOf(handler) < 0)
        shutdownHandlers.push(handler);
    },
    remove: function(handler)
    {
      let index = shutdownHandlers.indexOf(handler);
      if (index >= 0)
        shutdownHandlers.splice(index, 1);
    }
  };

  let callbackPrefix = Services.appinfo.processID + " ";
  let maxCallbackID = 0;
  let callbacks = new Map();

  function sendSyncMessageSingleResponse(messageName, data)
  {
    return sendRpcMessage(messageName, {data})[0];
  }

  function sendAsyncMessageWithResponse(messageName, data, callback)
  {
    data = {data};
    if (callback)
    {
      let callbackID = callbackPrefix + (++maxCallbackID);
      callbacks.set(callbackID, callback);
      data.callbackID = callbackID;
    }
    sendAsyncMessage(messageName, data);
  }

  function onResponse(message)
  {
    let {callbackID, response} = message.data;
    if (callbacks.has(callbackID))
    {
      let callback = callbacks.get(callbackID);
      callbacks.delete(callbackID);
      callback(response);
    }
  }

  function init(info)
  {
    loader = Loader({
      paths: {
        "": info.addonRoot + "lib/"
      },
      globals: {
        Components, Cc, Ci, Cu, Cr, atob, btoa, onShutdown,
        addMessageListener, removeMessageListener,
        sendAsyncMessage: sendAsyncMessageWithResponse,
        sendSyncMessage: sendSyncMessageSingleResponse
      },
      modules: {"info": info},
      id: info.addonID
    });
    onShutdown.add(() => unload(loader, "disable"))

    main(loader, "child/main");
  }

  function shutdown(message)
  {
    if (message.data == Components.stack.filename)
    {
      onShutdown.done = true;
      for (let i = shutdownHandlers.length - 1; i >= 0; i --)
      {
        try
        {
          shutdownHandlers[i]();
        }
        catch (e)
        {
          Cu.reportError(e);
        }
      }
      shutdownHandlers = null;
    }
  }

  sendAsyncMessageWithResponse("AdblockPlus:GetInfo", null, init);
  addMessageListener("AdblockPlus:Response", onResponse);
  addMessageListener("AdblockPlus:Shutdown", shutdown);
  onShutdown.add(() => {
    removeMessageListener("AdblockPlus:Response", onResponse);
    removeMessageListener("AdblockPlus:Shutdown", shutdown);
  });
})();

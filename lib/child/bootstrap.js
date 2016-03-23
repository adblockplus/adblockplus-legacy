/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
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

  Cu.importGlobalProperties(["atob", "btoa", "File", "URL", "URLSearchParams",
      "TextDecoder", "TextEncoder"]);

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

  function init()
  {
    let url = new URL(Components.stack.filename);
    let params = new URLSearchParams(url.search.substr(1));
    let info = JSON.parse(params.get("info"));

    let loader = Loader({
      paths: {
        "": info.addonRoot + "lib/"
      },
      globals: {
        Components, Cc, Ci, Cu, Cr, atob, btoa, File, URL, URLSearchParams,
        TextDecoder, TextEncoder, onShutdown
      },
      modules: {"info": info, "messageManager": this},
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

  addMessageListener("AdblockPlus:Shutdown", shutdown);
  onShutdown.add(() =>
  {
    removeMessageListener("AdblockPlus:Shutdown", shutdown);
  });

  init();
})();

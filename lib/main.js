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

/**
 * @fileOverview Starts up Adblock Plus
 */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

bootstrapChildProcesses();
registerPublicAPI();
require("filterListener");
require("contentPolicy");
require("synchronizer");
require("notification");
require("sync");
require("messageResponder");
require("ui");
require("objectTabs");

function bootstrapChildProcesses()
{
  let info = require("info");

  let processScript = info.addonRoot + "lib/child/bootstrap.js?" +
      Math.random() + "&info=" + encodeURIComponent(JSON.stringify(info));
  let messageManager = Cc["@mozilla.org/parentprocessmessagemanager;1"]
                         .getService(Ci.nsIProcessScriptLoader)
                         .QueryInterface(Ci.nsIMessageBroadcaster);
  messageManager.loadProcessScript(processScript, true);

  onShutdown.add(() => {
    messageManager.broadcastAsyncMessage("AdblockPlus:Shutdown", processScript);
    messageManager.removeDelayedProcessScript(processScript);
  });
}

function registerPublicAPI()
{
  let {addonRoot} = require("info");

  let uri = Services.io.newURI(addonRoot + "lib/Public.jsm", null, null);
  if (uri instanceof Ci.nsIMutable)
    uri.mutable = false;

  let classID = Components.ID("5e447bce-1dd2-11b2-b151-ec21c2b6a135");
  let contractID = "@adblockplus.org/abp/public;1";
  let factory =
  {
    createInstance: function(outer, iid)
    {
      if (outer)
        throw Cr.NS_ERROR_NO_AGGREGATION;
      return uri.QueryInterface(iid);
    },
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory])
  };

  let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  registrar.registerFactory(classID, "Adblock Plus public API URL", contractID, factory);

  onShutdown.add(function()
  {
    registrar.unregisterFactory(classID, factory);
    Cu.unload(uri.spec);
  });
}

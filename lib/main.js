/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Starts up Adblock Plus
 */

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

let {TimeLine} = require("timeline");

TimeLine.enter("Adblock Plus startup");
let {Prefs} = require("prefs");
TimeLine.log("Done loading preferences");
registerPublicAPI();
TimeLine.log("Done registering public API");
require("filterListener");
TimeLine.log("Done loading filter listener");
require("contentPolicy");
TimeLine.log("Done loading content policy");
require("synchronizer");
TimeLine.log("Done loading subscription synchronizer");
require("sync");
TimeLine.log("Done loading sync support");
require("ui");
TimeLine.log("Done loading UI integration code");
if (!Prefs.correctTyposAsked || (Prefs.correctTyposAsked && Prefs.correctTypos))
{
  require("typoFixer");
  TimeLine.log("Done loading typo correction");
}
else
{
  let onPrefChange = function(name)
  {
    if (name == "correctTypos")
    {
      require("typoFixer");
      Prefs.removeListener(onPrefChange);
    }
  }
  
  Prefs.addListener(onPrefChange);
}
TimeLine.leave("Started up");

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

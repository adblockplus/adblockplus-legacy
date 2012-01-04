/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

{
  let Cc = Components.classes;
  let Ci = Components.interfaces;
  let Cr = Components.results;
  let Cu = Components.utils;

  // Use UIReady event to initialize in Fennec (bug 531071)
  let chromeRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
  let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
  let utilsURL = chromeRegistry.convertChromeURL(ioService.newURI("chrome://adblockplus-modules/content/Utils.jsm", null, null));
  let eventName = Cu.import(utilsURL.spec, null).Utils.isFennec ? "UIReady" : "load";

  window.addEventListener(eventName, function()
  {
    window.removeEventListener(eventName, arguments.callee, false);

    if (!("@adblockplus.org/abp/private;1" in Cc))
    {
      // Force initialization (in Fennec we won't be initialized at this point)
      let bootstrapURL = chromeRegistry.convertChromeURL(ioService.newURI("chrome://adblockplus-modules/content/Bootstrap.jsm", null, null));
      Cu.import(bootstrapURL.spec, null).Bootstrap.startup();
    }

    let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);
    Cu.import(baseURL.spec + "AppIntegration.jsm", null).AppIntegration.addWindow(window);
  }, false);
}

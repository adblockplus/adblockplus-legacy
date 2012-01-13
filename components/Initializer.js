/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// Gecko 1.9.0/1.9.1 compatibility - add XPCOMUtils.defineLazyServiceGetter
if (!("defineLazyServiceGetter" in XPCOMUtils))
{
  XPCOMUtils.defineLazyServiceGetter = function XPCU_defineLazyServiceGetter(obj, prop, contract, iface)
  {
    obj.__defineGetter__(prop, function XPCU_serviceGetter()
    {
      delete obj[prop];
      return obj[prop] = Cc[contract].getService(Ci[iface]);
    });
  };
}

/**
 * Application startup/shutdown observer, triggers init()/shutdown() methods in Bootstrap.jsm module.
 * @constructor
 */
function Initializer() {}
Initializer.prototype =
{
  classDescription: "Adblock Plus initializer",
  contractID: "@adblockplus.org/abp/startup;1",
  classID: Components.ID("{d32a3c00-4ed3-11de-8a39-0800200c9a66}"),
  _xpcom_categories: [{ category: "app-startup", service: true }],

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),

  observe: function(subject, topic, data)
  {
    let observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    switch (topic)
    {
      case "app-startup":
        observerService.addObserver(this, "profile-after-change", true);
        break;
      case "profile-after-change":
        observerService.addObserver(this, "quit-application", true);

        // Don't init in Fennec, initialization will happen when UI is ready
        let appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
        if (appInfo.ID != "{a23983c0-fd0e-11dc-95ff-0800200c9a66}" && appInfo.ID != "{aa3c5121-dab2-40e2-81ca-7ea25febc110}")
        {
          try
          {
            // Gecko 2.0 and higher - chrome URLs can be loaded directly
            Cu.import("chrome://adblockplus-modules/content/Bootstrap.jsm");
          }
          catch (e)
          {
            // Gecko 1.9.x - have to convert chrome URLs to file URLs first
            let chromeRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
            let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
            let bootstrapURL = chromeRegistry.convertChromeURL(ioService.newURI("chrome://adblockplus-modules/content/Bootstrap.jsm", null, null));
            Cu.import(bootstrapURL.spec);
          }
          Bootstrap.startup();
        }
        break;
      case "quit-application":
        try {
          // This will fail if component was added via chrome.manifest (Gecko 2.0)
          observerService.removeObserver(this, "profile-after-change");
        }catch(e) {}
        observerService.removeObserver(this, "quit-application");
        if ("@adblockplus.org/abp/private;1" in Cc)
        {
          let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);
          Cu.import(baseURL.spec + "Bootstrap.jsm");
          Bootstrap.shutdown(false);
        }
        break;
    }
  }
};

if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory([Initializer]);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule([Initializer]);

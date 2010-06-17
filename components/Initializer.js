/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

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
        if (appInfo.ID != "{a23983c0-fd0e-11dc-95ff-0800200c9a66}")
        {
          let chromeRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
          let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
          let bootstrapURL = chromeRegistry.convertChromeURL(ioService.newURI("chrome://adblockplus-modules/content/Bootstrap.jsm", null, null));
          Cu.import(bootstrapURL.spec);
          Bootstrap.startup();
        }
        break;
      case "quit-application":
        observerService.removeObserver(this, "profile-after-change");
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

var NSGetModule = XPCOMUtils.generateNSGetModule([Initializer]);

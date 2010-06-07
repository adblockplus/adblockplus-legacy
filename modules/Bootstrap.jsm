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

/**
 * @fileOverview Bootstrap module, will initialize Adblock Plus when loaded
 */

var EXPORTED_SYMBOLS = ["Bootstrap"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let chromeRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
let publicURL = chromeRegistry.convertChromeURL(ioService.newURI("chrome://adblockplus-modules/content/Public.jsm", null, null));
if (publicURL instanceof Ci.nsIMutable)
  publicURL.mutable = false;

let baseURL = publicURL.clone().QueryInterface(Ci.nsIURL);
baseURL.fileName = "";

const cidPublic = Components.ID("5e447bce-1dd2-11b2-b151-ec21c2b6a135");
const contractIDPublic = "@adblockplus.org/abp/public;1";

const cidPrivate = Components.ID("2f1e0288-1dd2-11b2-bbfe-d7b8a982508e");
const contractIDPrivate = "@adblockplus.org/abp/private;1";

let factoryPublic = {
  createInstance: function(outer, iid)
  {
    if (outer)
      throw Cr.NS_ERROR_NO_AGGREGATION;
    return publicURL.QueryInterface(iid);
  }
};

let factoryPrivate = {
  createInstance: function(outer, iid)
  {
    if (outer)
      throw Cr.NS_ERROR_NO_AGGREGATION;
    return baseURL.QueryInterface(iid);
  }
};

Cu.import(baseURL.spec + "TimeLine.jsm");

let defaultModules = [
  baseURL.spec + "Prefs.jsm",
  baseURL.spec + "FilterStorage.jsm",
  baseURL.spec + "ContentPolicy.jsm",
  baseURL.spec + "ElemHide.jsm",
  baseURL.spec + "FilterListener.jsm",
  baseURL.spec + "Synchronizer.jsm"
];

let loadedModules = {__proto__: null};

let initialized = false;

/**
 * Allows starting up and shutting down Adblock Plus functions.
 * @class
 */
var Bootstrap =
{
  /**
   * Initializes add-on, loads and initializes all modules.
   */
  startup: function()
  {
    if (initialized)
      return;
    initialized = true;

    TimeLine.enter("Entered Bootstrap.startup()");
  
    // Register component to allow retrieving private and public URL
    
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(cidPublic, "Adblock Plus public module URL", contractIDPublic, factoryPublic);
    registrar.registerFactory(cidPrivate, "Adblock Plus private module URL", contractIDPrivate, factoryPrivate);
  
    TimeLine.log("done registering URL components");
  
    // Load and initialize modules
  
    TimeLine.log("started initializing default modules");
  
    for each (let url in defaultModules)
      Bootstrap.loadModule(url);

    TimeLine.log("initializing additional modules");

    let categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
    let enumerator = categoryManager.enumerateCategory("adblock-plus-module-location");
    while (enumerator.hasMoreElements())
    {
      let uri = enumerator.getNext().QueryInterface(Ci.nsISupportsCString).data;
      Bootstrap.loadModule(uri);
    }

    let observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    observerService.addObserver(BootstrapPrivate, "xpcom-category-entry-added", true);
    observerService.addObserver(BootstrapPrivate, "xpcom-category-entry-removed", true);
  
    TimeLine.leave("Bootstrap.startup() done");
  },

  /**
   * Shuts down add-on.
   * @param {Boolean} cleanup  should be true if shutdown isn't due to application exiting, will revert all hooks from the application.
   */
  shutdown: function(cleanup)
  {
    if (!initialized)
      return;

    if (cleanup)
      initialized = false;

    TimeLine.enter("Entered Bootstrap.shutdown()");

    if (cleanup)
    {
      // Unregister components
      
      let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
      registrar.unregisterFactory(cidPublic, factoryPublic);
      registrar.unregisterFactory(cidPrivate, factoryPrivate);
    
      TimeLine.log("done unregistering URL components");

      // Remove category observer

      let observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
      observerService.removeObserver(BootstrapPrivate, "xpcom-category-entry-added");
      observerService.removeObserver(BootstrapPrivate, "xpcom-category-entry-removed");

      TimeLine.log("done removing category observer");
    }

    // Shut down modules

    TimeLine.log("started shutting down modules");

    for (let url in loadedModules)
      Bootstrap.unloadModule(url, cleanup);

    TimeLine.leave("Bootstrap.shutdown() done");
  },

  /**
   * Loads and initializes a module.
   */
  loadModule: function(/**String*/ url)
  {
    if (url in loadedModules)
      return;

    let module = {};
    try
    {
      Cu.import(url, module);
    }
    catch (e)
    {
      Cu.reportError("Adblock Plus: Failed to load module " + url + ": " + e);
      return;
    }

    for each (let obj in module)
    {
      if ("startup" in obj)
      {
        try
        {
          obj.startup();
          loadedModules[url] = obj;
        }
        catch (e)
        {
          Cu.reportError("Adblock Plus: Calling method startup() for module " + url + " failed: " + e);
        }
        return;
      }
    }

    Cu.reportError("Adblock Plus: No exported object with startup() method found for module " + url);
  },

  /**
   * Shuts down and unloads a module (ok, unloading isn't currently possible, see bug 564674).
   */
  unloadModule: function(/**String*/ url, /**Boolean*/ cleanup)
  {
    if (!(url in loadedModules))
      return;

    let obj = loadedModules[url];
    if (cleanup)
      delete loadedModules[url];

    if ("shutdown" in obj)
    {
      try
      {
        obj.shutdown(cleanup);
      }
      catch (e)
      {
        Cu.reportError("Adblock Plus: Calling method shutdown() for module " + url + " failed: " + e);
      }
      return;
    }

    Cu.reportError("Adblock Plus: No exported object with shutdown() method found for module " + url);
  }
};

/**
 * Observer called on modules category changes.
 * @class
 */
var BootstrapPrivate =
{
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),

  observe: function(subject, topic, data)
  {
    if (data != "adblock-plus-module-location")
      return;

    switch (topic)
    {
      case "xpcom-category-entry-added":
        Bootstrap.loadModule(subject.QueryInterface(Ci.nsISupportsCString).data);
        break;
      case "xpcom-category-entry-removed":
        Bootstrap.unloadModule(subject.QueryInterface(Ci.nsISupportsCString).data, true);
        break;
    }
  }
};

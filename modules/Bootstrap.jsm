/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Bootstrap module, will initialize Adblock Plus when loaded
 */

var EXPORTED_SYMBOLS = ["Bootstrap"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

let baseURL = "chrome://adblockplus-modules/content/";
Cu.import(baseURL + "Utils.jsm");
Cu.import(baseURL + "TimeLine.jsm");

let publicURL = Services.io.newURI(baseURL + "Public.jsm", null, null);
if (publicURL instanceof Ci.nsIMutable)
  publicURL.mutable = false;

const cidPublic = Components.ID("5e447bce-1dd2-11b2-b151-ec21c2b6a135");
const contractIDPublic = "@adblockplus.org/abp/public;1";
let factoryPublic =
{
  createInstance: function(outer, iid)
  {
    if (outer)
      throw Cr.NS_ERROR_NO_AGGREGATION;
    return publicURL.QueryInterface(iid);
  }
};

let defaultModules = [
  baseURL + "Prefs.jsm",
  baseURL + "FilterListener.jsm",
  baseURL + "ContentPolicy.jsm",
  baseURL + "Synchronizer.jsm",
  baseURL + "Sync.jsm"
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
  
    // Register component to allow retrieving public URL
    
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(cidPublic, "Adblock Plus public module URL", contractIDPublic, factoryPublic);

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

    Services.obs.addObserver(BootstrapPrivate, "xpcom-category-entry-added", true);
    Services.obs.addObserver(BootstrapPrivate, "xpcom-category-entry-removed", true);
  
    TimeLine.leave("Bootstrap.startup() done");
  },

  /**
   * Shuts down add-on.
   */
  shutdown: function()
  {
    if (!initialized)
      return;

    TimeLine.enter("Entered Bootstrap.shutdown()");

    // Shut down modules
    for (let url in loadedModules)
      Bootstrap.shutdownModule(url);

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
   * Shuts down a module.
   */
  shutdownModule: function(/**String*/ url)
  {
    if (!(url in loadedModules))
      return;

    let obj = loadedModules[url];
    if ("shutdown" in obj)
    {
      try
      {
        obj.shutdown();
      }
      catch (e)
      {
        Cu.reportError("Adblock Plus: Calling method shutdown() for module " + url + " failed: " + e);
      }
      return;
    }
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

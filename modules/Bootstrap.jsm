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

let chromeRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
let publicURL = chromeRegistry.convertChromeURL(ioService.newURI("chrome://adblockplus-modules/content/Public.jsm", null, null));
if (publicURL instanceof Ci.nsIMutable)
  publicURL.mutable = false;

let baseURL = publicURL.clone().QueryInterface(Ci.nsIURL);
baseURL.fileName = "";

Cu.import(baseURL.spec + "TimeLine.jsm");

var initialized = false;

var Bootstrap =
{
  init: function()
  {
    if (initialized)
      return;
    initialized = true;

    TimeLine.enter("Entered Bootstrap.jsm init()");
  
    // Register component to allow retrieving private and public URL
    
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
    
    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(cidPublic, "Adblock Plus public module URL", contractIDPublic, factoryPublic);
    registrar.registerFactory(cidPrivate, "Adblock Plus private module URL", contractIDPrivate, factoryPrivate);
  
    TimeLine.log("done registering URL components");
  
    // Pull modules to initialize Adblock Plus functionality
  
    TimeLine.log("started initializing modules");
  
    Cu.import(baseURL.spec + "Prefs.jsm");
    Cu.import(baseURL.spec + "FilterStorage.jsm");
    Cu.import(baseURL.spec + "ContentPolicy.jsm");
    Cu.import(baseURL.spec + "ElemHide.jsm");
    Cu.import(baseURL.spec + "FilterListener.jsm");
    Cu.import(baseURL.spec + "Synchronizer.jsm");
  
    TimeLine.leave("Bootstrap.jsm init() done");
  },

  shutdown: function()
  {
    if (!initialized)
      return;
    initialized = false;

    FilterStorage.saveToDisk();
    Prefs.shutdown();
  }
};

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
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

const ABP_PACKAGE = "/adblockplus.mozdev.org"; 
const ABP_EXTENSION_ID = "{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}";
const ABP_CONTRACTID = "@mozilla.org/adblockplus;1";
const ABP_CID = Components.ID("{79c889f6-f5a2-abba-8b27-852e6fec4d56}");

const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                         .getService(Components.interfaces.mozIJSSubScriptLoader);

/*
 * Module object
 */

const module =
{
  registerSelf: function(compMgr, fileSpec, location, type)
  {
    compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
    compMgr.registerFactoryLocation(ABP_CID, 
                    "Adblock content policy",
                    ABP_CONTRACTID,
                    fileSpec, location, type);

    var catman = Components.classes["@mozilla.org/categorymanager;1"]
                           .getService(Components.interfaces.nsICategoryManager);
    catman.addCategoryEntry("content-policy", ABP_CONTRACTID,
              ABP_CONTRACTID, true, true);
  },

  unregisterSelf: function(compMgr, fileSpec, location)
  {
    compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);

    compMgr.unregisterFactoryLocation(ABP_CID, fileSpec);
    var catman = Components.classes["@mozilla.org/categorymanager;1"]
                           .getService(Components.interfaces.nsICategoryManager);
    catman.deleteCategoryEntry("content-policy", ABP_CONTRACTID, true);
  },

  getClassObject: function(compMgr, cid, iid)
  {
    if (!cid.equals(ABP_CID))
      throw Components.results.NS_ERROR_NO_INTERFACE;

    if (!iid.equals(Components.interfaces.nsIFactory))
      throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

    return factory;
  },

  canUnload: function(compMgr)
  {
    return true;
  }
};

function NSGetModule(comMgr, fileSpec)
{
  return module;
}

/*
 * Factory object
 */

var initialized = false;
const factory = {
  // nsIFactory interface implementation
  createInstance: function(outer, iid) {
    if (outer != null)
      throw Components.results.NS_ERROR_NO_AGGREGATION;

    if (!initialized)
      init();

    return abp.QueryInterface(iid);
  },

  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (iid.equals(Components.interfaces.nsISupports) ||
        iid.equals(Components.interfaces.nsIFactory))
      return this;

    if (!iid.equals(Components.interfaces.nsIClassInfo))
      dump("Adblock Plus: factory.QI to an unknown interface: " + iid + "\n");

    throw Components.results.NS_ERROR_NO_INTERFACE;
  }
}

/*
 * Constants / Globals
 */

const Node = Components.interfaces.nsIDOMNode;
const Window = Components.interfaces.nsIDOMWindow;

const windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
var lastBrowser = null;
var lastWindow  = null;

var cache = null;

/*
 * Content policy class definition
 */

const abp = {
  // nsISupports interface implementation
  QueryInterface: function(iid) {
    if (iid.equals(Components.interfaces.nsIContentPolicy))
      return policy;

    if (iid.equals(Components.interfaces.nsISupports))
      return this;

    if (!iid.equals(Components.interfaces.nsIClassInfo) &&
        !iid.equals(Components.interfaces.nsISecurityCheckedComponent))
      dump("Adblock Plus: abp.QI to an unknown interface: " + iid + "\n");

    throw Components.results.NS_ERROR_NO_INTERFACE;
  },

  // Returns installed Adblock Plus version
  getInstalledVersion: function() {
    // Try Firefox Extension Manager
    try {
      var item = this.getUpdateItem();
      if (item)
        return item.version;
    } catch (e) {}

    // Try InstallTrigger
    try {
      var browser = windowMediator.getMostRecentWindow("navigator:browser");
      if (browser)
        return browser.InstallTrigger.getVersion(ABP_PACKAGE);
    } catch (e) {}
  
    return null;
  },

  // Returns update item for Adblock Plus (only when extension manager is available)
  getUpdateItem: function() {
    if (!("@mozilla.org/extensions/manager;1" in Components.classes))
      return null;

    var extensionManager = Components.classes["@mozilla.org/extensions/manager;1"]
                                    .getService(Components.interfaces.nsIExtensionManager);

    // FF 1.1+
    if ('getItemForID' in extensionManager)
      return extensionManager.getItemForID(ABP_EXTENSION_ID);

    // FF 1.0
    var itemList = extensionManager.getItemList(ABP_EXTENSION_ID, Components.interfaces.nsIUpdateItem.TYPE_EXTENSION, {});
    if (itemList && itemList.length > 0)
      return itemList[0];

    return null;
  },

  // Retrieves settings dialog if it is currently open
  getSettingsDialog: function() {
    return windowMediator.getMostRecentWindow("abp:settings");
  },

  // Opens preferences dialog for the supplied window and filter suggestion
  openSettingsDialog: function(insecWnd, location, filter) {
    var dlg = this.getSettingsDialog();
    var func = function() {
      dlg.setContentWindow(insecWnd);
      if (typeof location != "undefined" && location)
        dlg.setLocation(location);
      if (typeof filter != "undefined" && filter)
        dlg.selectPattern(filter);
    }

    if (dlg) {
      func();

      try {
        dlg.focus();
      }
      catch (e) {
        // There must be some modal dialog open
        dlg = windowMediator.getMostRecentWindow("abp:subscription");
        if (!dlg)
          dlg = windowMediator.getMostRecentWindow("abp:about");

        if (dlg)
          dlg.focus();
      }
    }
    else {
      var browser = windowMediator.getMostRecentWindow("navigator:browser");
      dlg = browser.open("chrome://adblockplus/content/settings.xul", "_blank", "chrome,centerscreen,resizable");
      dlg.addEventListener("post-load", func, false);
    }
  },

  // Loads a URL in the browser window
  loadInBrowser: function(url) {
    var windowService = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
    var currentWindow = windowService.getMostRecentWindow("navigator:browser");
    if (currentWindow) {
      try {
        currentWindow.delayedOpenTab(url);
      }
      catch(e) {
        currentWindow.loadURI(url);
      }
    }
  },

  params: null,

  // Saves sidebar state before detaching/reattaching
  setParams: function(params) {
    this.params = params;
  },

  // Retrieves sidebar state
  getParams: function() {
    var ret = this.params;
    this.params = null;
    return ret;
  }
};
abp.wrappedJSObject = abp;

/*
 * Core Routines
 */

// Initialization and registration
function init() {
  initialized = true;

  loader.loadSubScript('chrome://adblockplus/content/security.js');
  loader.loadSubScript('chrome://adblockplus/content/utils.js');
  loader.loadSubScript('chrome://adblockplus/content/policy.js');
  loader.loadSubScript('chrome://adblockplus/content/data.js');
  loader.loadSubScript('chrome://adblockplus/content/prefs.js');
  loader.loadSubScript('chrome://adblockplus/content/synchronizer.js');
  loader.loadSubScript('chrome://adblockplus/content/flasher.js');

  // Filter cache initialization
  cache = new HashTable();

  // Clean up uninstalled files
  var dirService = Components.classes["@mozilla.org/file/directory_service;1"]
                             .getService(Components.interfaces.nsIProperties);
  var dirArray = ["AChrom", "UChrm", "ProfD", "ComsD"];
  for (var i = 0, n ; i < dirArray.length ; i++) {
    try {
      var currentDir = dirService.get(dirArray[i], Components.interfaces.nsIFile);
      var dirEntries = currentDir.directoryEntries;
      while (dirEntries.hasMoreElements()) {
        var file = dirEntries.getNext().QueryInterface(Components.interfaces.nsIFile);
        if (file.path.match(/-uninstalled$/))
          file.remove(false);
      }
    } catch(e) {}
  }

  // Install sidebar in Mozilla Suite if necessary
  installSidebar();
}

// Try to fix selected language (Mozilla and SeaMonkey don't do it correctly)
/*function fixPackageLocale() {
  try {
    var locale = "en-US";
    try {
      var branch = Components.classes["@mozilla.org/preferences-service;1"]
                             .getService(Components.interfaces.nsIPrefBranch);
      locale = branch.getCharPref("general.useragent.locale");
    } catch (e) {}

    var iface = ("nsIChromeRegistrySea" in Components.interfaces ? Components.interfaces.nsIChromeRegistrySea : Components.interfaces.nsIXULChromeRegistry);
    var registry = Components.classes["@mozilla.org/chrome/chrome-registry;1"]
                             .getService(iface);
    try {
      registry.selectLocaleForPackage(locale, "adblockplus", true);
    }
    catch (e) {
      dump(e + "\n");
      registry.selectLocaleForPackage("en-US", "adblockplus", true);
    }
  } catch(e) {dump(e + "\n")}
}*/

// Adds the sidebar to the Customize tabs dialog in Mozilla Suite/Seamonkey
function installSidebar() {
  try {
    var branch = prefService.QueryInterface(Components.interfaces.nsIPrefBranch);
    var customizeURL = branch.getCharPref("sidebar.customize.all_panels.url");
    if (/adblockplus/.test(customizeURL))
      return; // Adblock Plus sidebar is already installed

    customizeURL += " chrome://adblockplus/content/local-panels.rdf";
    branch.setCharPref("sidebar.customize.all_panels.url", customizeURL);
  } catch(e) {}
}

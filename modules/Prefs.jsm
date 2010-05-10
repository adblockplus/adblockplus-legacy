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
 * @fileOverview Manages Adblock Plus preferences.
 */

var EXPORTED_SYMBOLS = ["Prefs"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import(baseURL.spec + "TimeLine.jsm");
Cu.import(baseURL.spec + "Utils.jsm");

const prefRoot = "extensions.adblockplus.";

/**
 * Will be set to true if Adblock Plus is scheduled to be uninstalled on
 * browser restart.
 * @type Boolean
 */
let willBeUninstalled = false;

/**
 * Preferences branch containing Adblock Plus preferences.
 * @type nsIPrefBranch
 */
let branch = Utils.prefService.getBranch(prefRoot);

/**
 * Maps preferences to their default values.
 * @type Object
 */
let defaultPrefs = {__proto__: null};

/**
 * List of listeners to be notified whenever preferences are reloaded
 * @type Array of Function
 */
let listeners = [];

/**
 * nsIPrefBranch methods used to load prefererences, mapped by JavaScript type
 * @type Object
 */
let loadPrefMethods = {
  string: "getCharPref",
  boolean: "getBoolPref",
  number: "getIntPref",
};

/**
 * nsIPrefBranch methods used to save prefererences, mapped by JavaScript type
 * @type Object
 */
let savePrefMethods = {
  string: "setCharPref",
  boolean: "setBoolPref",
  number: "setIntPref",
};

/**
 * This object allows easy access to Adblock Plus preferences, all defined
 * preferences will be available as its members.
 * @class
 */
var Prefs =
{
  /**
   * Will be set to true if the user enters private browsing mode.
   * @type Boolean
   */
  privateBrowsing: false,

  /**
   * Called on module startup.
   */
  startup: function()
  {
    TimeLine.enter("Entered Prefs.startup()");
  
    // Initialize prefs list
    let defaultBranch = Utils.prefService.getDefaultBranch(prefRoot);
    let types = {};
    types[Ci.nsIPrefBranch.PREF_INT] = "getIntPref";
    types[Ci.nsIPrefBranch.PREF_BOOL] = "getBoolPref";
    types[Ci.nsIPrefBranch.PREF_STRING] = "getCharPref";
  
    for each (let name in defaultBranch.getChildList("", {}))
    {
      let type = defaultBranch.getPrefType(name);
      let method = (type in types ? types[type] : types[Ci.nsIPrefBranch.PREF_STRING]);
  
      try {
        defaultPrefs[name] = defaultBranch[method](name);
      } catch(e) {}
    }
  
    TimeLine.log("done loading defaults");
  
    // Initial prefs loading
    TimeLine.log("loading actual pref values");
    reload();
    TimeLine.log("done loading pref values");
  
    // Register observers
    TimeLine.log("registering observers");
    registerObservers();
  
    TimeLine.leave("Prefs.startup() done");
  },

  /**
   * Called on module shutdown.
   */
  shutdown: function(/**Boolean*/ cleanup)
  {
    TimeLine.enter("Entered Prefs.shutdown()");

    if (willBeUninstalled)
    {
      // Make sure that a new installation after uninstall will be treated like
      // an update.
      try {
        branch.clearUserPref("currentVersion");
      } catch(e) {}
    }

    if (cleanup)
    {
      TimeLine.log("unregistering observers");
      unregisterObservers();
      listeners = [];
      defaultPrefs = {__proto__: null};
    }

    TimeLine.leave("Prefs.shutdown() done");
  },

  /**
   * Retrieves the default value of a preference, will return null if the
   * preference doesn't exist.
   */
  getDefault: function(/**String*/ pref)
  {
    return (pref in defaultPrefs ? defaultPrefs[pref] : null);
  },

  /**
   * Saves all object properties back to preferences
   */
  save: function()
  {
    try
    {
      PrefsPrivate.ignorePrefChanges = true;
      for (let pref in defaultPrefs)
        savePref(pref);
    }
    finally
    {
      PrefsPrivate.ignorePrefChanges = false;
    }

    // Make sure to save the prefs on disk (and if we don't - at least reload the prefs)
    try
    {
      Utils.prefService.savePrefFile(null);
    }
    catch(e) {}  

    reload();
  },

  /**
   * Adds a preferences listener that will be fired whenever preferences are
   * reloaded
   */
  addListener: function(/**Function*/ listener)
  {
    let index = listeners.indexOf(listener);
    if (index < 0)
      listeners.push(listener);
  },
  /**
   * Removes a preferences listener
   */
  removeListener: function(/**Function*/ listener)
  {
    let index = listeners.indexOf(listener);
    if (index >= 0)
      listeners.splice(index, 1);
  }
};

/**
 * Private nsIObserver implementation
 * @class
 */
var PrefsPrivate =
{
 /**
 * If set to true notifications about preference changes will no longer cause
 * a reload. This is to prevent unnecessary reloads while saving.
 * @type Boolean
 */
 ignorePrefChanges: false,

  /**
   * nsIObserver implementation
   */
  observe: function(subject, topic, data)
  {
    if (topic == "private-browsing")
    {
      if (data == "enter")
        Prefs.privateBrowsing = true;
      else if (data == "exit")
        Prefs.privateBrowsing = false;
    }
    else if (topic == "em-action-requested")
    {
      if (subject instanceof Ci.nsIUpdateItem && subject.id == Utils.addonID)
        willBeUninstalled = (data == "item-uninstalled");
    }
    else if (!this.ignorePrefChanges)
      reload();
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
}

/**
 * Adds observers to keep various properties of Prefs object updated.
 */
function registerObservers()
{
  // Observe preferences changes
  try {
    branch.QueryInterface(Ci.nsIPrefBranchInternal)
          .addObserver("", PrefsPrivate, true);
  }
  catch (e) {
    Cu.reportError(e);
  }

  let observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
  observerService.addObserver(PrefsPrivate, "em-action-requested", true);

  // Add Private Browsing observer
  if ("@mozilla.org/privatebrowsing;1" in Cc)
  {
    try
    {
      Prefs.privateBrowsing = Cc["@mozilla.org/privatebrowsing;1"].getService(Ci.nsIPrivateBrowsingService).privateBrowsingEnabled;
      observerService.addObserver(PrefsPrivate, "private-browsing", true);
    }
    catch(e)
    {
      Cu.reportError(e);
    }
  }
}

/**
 * Removes observers.
 */
function unregisterObservers()
{
  try {
    branch.QueryInterface(Ci.nsIPrefBranchInternal)
          .removeObserver("", PrefsPrivate);
  }
  catch (e) {
    Cu.reportError(e);
  }

  let observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
  observerService.removeObserver(PrefsPrivate, "em-action-requested");
  observerService.removeObserver(PrefsPrivate, "private-browsing");
}

/**
 * Reloads a preference and stores it as a property of Prefs object.
 */
function reloadPref(/**String*/ pref)
{
  let defaultValue = defaultPrefs[pref];
  try
  {
    Prefs[pref] = branch[loadPrefMethods[typeof defaultValue]](pref);
  }
  catch (e)
  {
    this[pref] = defaultValue;
  }
}

/**
 * Saves a property of the Prefs object into the corresponding preference.
 */
function savePref(/**String*/ pref)
{
  let defaultValue = defaultPrefs[pref];
  try
  {
    branch[savePrefMethods[typeof defaultValue]](pref, Prefs[pref]);
  }
  catch (e)
  {
    Cu.reportError(e);
  }
}

/**
 * Reloads all preferences on change an notifies listeners.
 */
function reload()
{
  // Load data from prefs.js
  for (let pref in defaultPrefs)
    reloadPref(pref);

  // Always disable object tabs in Fennec, they aren't usable
  if (Utils.appID == "{a23983c0-fd0e-11dc-95ff-0800200c9a66}")
    Prefs.frameobjects = false;

  // Fire pref listeners
  for each (let listener in listeners)
    listener();
}

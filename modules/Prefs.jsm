/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Manages Adblock Plus preferences.
 */

var EXPORTED_SYMBOLS = ["Prefs"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = "chrome://adblockplus-modules/content/";
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import(baseURL + "TimeLine.jsm");
Cu.import(baseURL + "Utils.jsm");

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
 * List of listeners to be notified whenever preferences are updated
 * @type Array of Function
 */
let listeners = [];

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
    let defaultBranch = this.defaultBranch;
    for each (let name in defaultBranch.getChildList("", {}))
    {
      let type = defaultBranch.getPrefType(name);
      switch (type)
      {
        case Ci.nsIPrefBranch.PREF_INT:
          defineIntegerProperty(name);
          break;
        case Ci.nsIPrefBranch.PREF_BOOL:
          defineBooleanProperty(name);
          break;
        case Ci.nsIPrefBranch.PREF_STRING:
          defineStringProperty(name);
          break;
      }
      if ("_update_" + name in PrefsPrivate)
        PrefsPrivate["_update_" + name]();
    }

    // Always disable object tabs in Fennec, they aren't usable
    if (Utils.isFennec)
      Prefs.frameobjects = false;

    TimeLine.log("done loading initial values");
  
    // Register observers
    TimeLine.log("registering observers");
    registerObservers();
  
    TimeLine.leave("Prefs.startup() done");
  },

  /**
   * Backwards compatibility, this pref is optional
   */
  get patternsfile() /**String*/
  {
    let result = null;
    try
    {
      result = branch.getCharPref("patternsfile");
    } catch(e) {}
    this.__defineGetter__("patternsfile", function() result);
    return this.patternsfile;
  },

  /**
   * Retrieves the preferences branch containing default preference values.
   */
  get defaultBranch() /**nsIPreferenceBranch*/
  {
    return Utils.prefService.getDefaultBranch(prefRoot);
  },

  /**
   * Called on module shutdown.
   */
  shutdown: function()
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

    TimeLine.leave("Prefs.shutdown() done");
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
    else if (topic == "nsPref:changed" && !this.ignorePrefChanges && "_update_" + data in PrefsPrivate)
      PrefsPrivate["_update_" + data]();
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

  Services.obs.addObserver(PrefsPrivate, "em-action-requested", true);

  // Add Private Browsing observer
  if ("@mozilla.org/privatebrowsing;1" in Cc)
  {
    try
    {
      Prefs.privateBrowsing = Cc["@mozilla.org/privatebrowsing;1"].getService(Ci.nsIPrivateBrowsingService).privateBrowsingEnabled;
      Services.obs.addObserver(PrefsPrivate, "private-browsing", true);
    }
    catch(e)
    {
      Cu.reportError(e);
    }
  }
}

/**
 * Triggers preference listeners whenever a preference is changed.
 */
function triggerListeners(/**String*/ name)
{
  for each (let listener in listeners)
    listener(name);
}

/**
 * Sets up getter/setter on Prefs object for preference.
 */
function defineProperty(/**String*/ name, defaultValue, /**Function*/ readFunc, /**Function*/ writeFunc)
{
  let value = defaultValue;
  PrefsPrivate["_update_" + name] = function()
  {
    try
    {
      value = readFunc();
      triggerListeners(name);
    }
    catch(e)
    {
      Cu.reportError(e);
    }
  }
  Prefs.__defineGetter__(name, function() value);
  Prefs.__defineSetter__(name, function(newValue)
  {
    if (value == newValue)
      return value;

    try
    {
      PrefsPrivate.ignorePrefChanges = true;
      writeFunc(newValue);
      value = newValue;
      triggerListeners(name);
    }
    catch(e)
    {
      Cu.reportError(e);
    }
    finally
    {
      PrefsPrivate.ignorePrefChanges = false;
    }
    return value;
  });
}

/**
 * Sets up getter/setter on Prefs object for an integer preference.
 */
function defineIntegerProperty(/**String*/ name)
{
  defineProperty(name, 0, function() branch.getIntPref(name),
                          function(newValue) branch.setIntPref(name, newValue));
}

/**
 * Sets up getter/setter on Prefs object for a boolean preference.
 */
function defineBooleanProperty(/**String*/ name)
{
  defineProperty(name, false, function() branch.getBoolPref(name),
                              function(newValue) branch.setBoolPref(name, newValue));
}

/**
 * Sets up getter/setter on Prefs object for a string preference.
 */
function defineStringProperty(/**String*/ name)
{
  defineProperty(name, "", function() branch.getComplexValue(name, Ci.nsISupportsString).data,
    function(newValue)
    {
      let str = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
      str.data = newValue;
      branch.setComplexValue(name, Ci.nsISupportsString, str);
    });
}

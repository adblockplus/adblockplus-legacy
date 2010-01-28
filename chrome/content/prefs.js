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
 * This file is included from AdblockPlus.js.
 */

const prefRoot = "extensions.adblockplus.";

XPCOMUtils.defineLazyServiceGetter(this, "prefService", "@mozilla.org/preferences-service;1", "nsIPrefService");

/**
 * This object allows easy access to Adblock Plus preferences, all defined
 * preferences will be available as its members.
 * @class
 */
var prefs = {
  /**
   * Old value of the "currentVersion" preference - version of Adblock Plus used
   * on previous browser start.
   * @type String
   */
  lastVersion: null,

  /**
   * Will be set to true if the user enters private browsing mode.
   * @type Boolean
   */
  privateBrowsing: false,

  /**
   * If set to true notifications about preference changes will no longer cause
   * a reload. This is to prevent unnecessary reloads while saving.
   * @type Boolean
   */
  _disableObserver: false,

  /**
   * Preferences branch containing Adblock Plus preferences.
   * @type nsIPrefBranch
   */
  _branch: prefService.getBranch(prefRoot),

  /**
   * Maps preferences to their default values.
   * @type Object
   */
  _defaultPrefs: null,

  /**
   * nsIPrefBranch methods used to load prefererences, mapped by JavaScript type
   * @type Object
   */
  _loadPrefMethods: {
    string: "getCharPref",
    boolean: "getBoolPref",
    number: "getIntPref",
  },
  /**
   * nsIPrefBranch methods used to save prefererences, mapped by JavaScript type
   * @type Object
   */
  _savePrefMethods: {
    string: "setCharPref",
    boolean: "setBoolPref",
    number: "setIntPref",
  },

  /**
   * List of listeners to be notified whenever preferences are reloaded
   * @type Array of Function
   */
  _listeners: [],

  /**
   * Will be set to true if Adblock Plus is scheduled to be uninstalled on
   * browser restart.
   */
  _willBeUninstalled: false,

  addObservers: function() {
    // Observe preferences changes
    try {
      this._branch
          .QueryInterface(Ci.nsIPrefBranchInternal)
          .addObserver("", this, true);
    }
    catch (e) {
      dump("Adblock Plus: exception registering pref observer: " + e + "\n");
    }

    let observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    observerService.addObserver(this, "em-action-requested", true);

    // Add Private Browsing observer
    if ("@mozilla.org/privatebrowsing;1" in Cc)
    {
      try
      {
        this.privateBrowsing = Cc["@mozilla.org/privatebrowsing;1"].getService(Ci.nsIPrivateBrowsingService).privateBrowsingEnabled;
        observerService.addObserver(this, "private-browsing", true);
      }
      catch(e)
      {
        dump("Adblock Plus: exception initializing private browsing observer: " + e + "\n");
      }
    }
  },

  /**
   * Called during browser startup, performs initial load of preferences.
   */
  init: function()
  {
    // Prevent multiple invocation
    if (this.currentVersion)
      return;

    // Initialize prefs list
    let defaultBranch = prefService.getDefaultBranch(prefRoot);
    let types = {};
    types[defaultBranch.PREF_INT] = "Int";
    types[defaultBranch.PREF_BOOL] = "Bool";

    this._defaultPrefs = {};
    this._defaultPrefs.__proto__ = null;
    for each (let name in defaultBranch.getChildList("", {}))
    {
      let type = defaultBranch.getPrefType(name);
      let typeName = (type in types ? types[type] : "Char");

      try {
        this._defaultPrefs[name] = defaultBranch["get" + typeName + "Pref"](name);
      } catch(e) {}
    }

    // Initial prefs loading
    this.reload();

    // Update lastVersion pref if necessary
    this.lastVersion = this.currentVersion;
    if (this.currentVersion != abp.getInstalledVersion())
    {
      this.currentVersion = abp.getInstalledVersion();
      this.save();
    }

    // Add observers for pref changes
    prefs.addObservers();
  },

  /**
   * Called during browser shutdown.
   */
  shutdown: function()
  {
    if (this._willBeUninstalled)
    {
      // Make sure that a new installation after uninstall will be treated like
      // an update.
      try {
        this._branch.clearUserPref("currentVersion");
      } catch(e) {}
    }
  },

  /**
   * Retrieves the default value of a preference, will return null if the
   * preference doesn't exist.
   */
  getDefault: function(/**String*/ pref)
  {
    return (pref in this._defaultPrefs ? this._defaultPrefs[pref] : null);
  },

  /**
   * Reloads a preference and stores it as a property of this object.
   */
  _reloadPref: function(/**String*/pref)
  {
    let defaultValue = this._defaultPrefs[pref];
    try
    {
      this[pref] = this._branch[this._loadPrefMethods[typeof defaultValue]](pref);
    }
    catch (e)
    {
      this[pref] = defaultValue;
    }
  },

  /**
   * Saves a property of the object into the corresponding preference.
   */
  _savePref: function(/**String*/pref)
  {
    let defaultValue = this._defaultPrefs[pref];
    try
    {
      this._branch[this._savePrefMethods[typeof defaultValue]](pref, this[pref]);
    }
    catch (e) {}
  },

  /**
   * Reloads all preferences on change an notifies listeners.
   */
  reload: function()
  {
    // Load data from prefs.js
    for (let pref in this._defaultPrefs)
      this._reloadPref(pref);

    // Always disable object tabs in Fennec, they aren't usable
    let appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
    if (appInfo.ID == "{a23983c0-fd0e-11dc-95ff-0800200c9a66}")
      this.frameobjects = false;

    elemhide.apply();

    // Fire pref listeners
    for each (let listener in this._listeners)
      listener(this);
  },

  /**
   * Saves all object properties back to preferences
   */
  save: function()
  {
    try
    {
      this._disableObserver = true;
      for (let pref in this._defaultPrefs)
        this._savePref(pref);
    }
    finally
    {
      this._disableObserver = false;
    }

    // Make sure to save the prefs on disk (and if we don't - at least reload the prefs)
    try
    {
      prefService.savePrefFile(null);
    }
    catch(e) {}  

    this.reload();
  },

  /**
   * Adds a preferences listener that will be fired whenever preferences are
   * reloaded
   */
  addListener: function(/**Function*/handler)
  {
    this._listeners.push(handler);
  },
  /**
   * Removes a preferences listener
   */
  removeListener: function(/**Function*/handler)
  {
    for (let i = 0; i < this._listeners.length; i++)
      if (this._listeners[i] == handler)
        this._listeners.splice(i--, 1);
  },

  /**
   * nsIObserver implementation
   */
  observe: function(subject, topic, data)
  {
    if (topic == "private-browsing")
    {
      if (data == "enter")
        this.privateBrowsing = true;
      else if (data == "exit")
        this.privateBrowsing = false;
    }
    else if (topic == "em-action-requested")
      this._willBeUninstalled = (data == "item-uninstalled");
    else if (!this._disableObserver)
      this.reload();
  },

  /**
   * nsISupports implementation
   */
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
};

abp.prefs = prefs;

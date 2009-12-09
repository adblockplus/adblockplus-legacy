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
 * Portions created by the Initial Developer are Copyright (C) 2006-2009
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

var prefService = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);

/**
 * This object allows easy access to Adblock Plus preferences, all defined
 * preferences will be available as its members.
 * @class
 */
var prefs = {
  /**
   * Old value of the "currentVersion" preference - version of Adblock Plus used
   * on previous browser start.
   */
  lastVersion: null,

  /**
   * If set to true notifications about preference changes will no longer cause
   * a reload. This is to prevent unnecessary reloads while saving.
   */
  _disableObserver: false,

  /**
   * Will be set to true if the user enters private browsing mode.
   */
  privateBrowsing: false,

  branch: prefService.getBranch(prefRoot),
  prefList: [],
  listeners: [],

  /**
   * Will be set to true if Adblock Plus is scheduled to be uninstalled on
   * browser restart.
   */
  _willBeUninstalled: false,

  addObservers: function() {
    // Observe preferences changes
    try {
      var branchInternal = this.branch.QueryInterface(Ci.nsIPrefBranchInternal);
      branchInternal.addObserver("", this, true);
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
    var defaultBranch = prefService.getDefaultBranch(prefRoot);
    var defaultPrefs = defaultBranch.getChildList("", {});
    var types = {};
    types[defaultBranch.PREF_INT] = "Int";
    types[defaultBranch.PREF_BOOL] = "Bool";

    this.prefList = [];
    for each (var name in defaultPrefs) {
      var type = defaultBranch.getPrefType(name);
      var typeName = (type in types ? types[type] : "Char");

      try {
        var pref = [name, typeName, defaultBranch["get" + typeName + "Pref"](name)];
        this.prefList.push(pref);
        this.prefList[" " + name] = pref;
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
        this.branch.clearUserPref("currentVersion");
      } catch(e) {}
    }
  },

  // Loads a pref and stores it as a property of the object
  loadPref: function(pref) {
    try {
      this[pref[0]] = this.branch["get" + pref[1] + "Pref"](pref[0]);
    }
    catch (e) {
      // Use default value
      this[pref[0]] = pref[2];
    }
  },

  // Saves a property of the object into the corresponding pref
  savePref: function(pref) {
    try {
      this.branch["set" + pref[1] + "Pref"](pref[0], this[pref[0]]);
    }
    catch (e) {}
  },

  // Reloads the preferences
  reload: function() {
    // Load data from prefs.js
    for (let i = 0; i < this.prefList.length; i++)
      this.loadPref(this.prefList[i]);

    // Always disable object tabs in Fennec, they aren't usable
    let appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
    if (appInfo.ID == "{a23983c0-fd0e-11dc-95ff-0800200c9a66}")
      this.frameobjects = false;

    elemhide.apply();

    // Fire pref listeners
    for each (var listener in this.listeners)
      listener(this);
  },

  // Saves the changes back into the prefs
  save: function() {
    try {
      this._disableObserver = true;
      for (let i = 0; i < this.prefList.length; i++)
        this.savePref(this.prefList[i]);
    }
    finally {
      this._disableObserver = false;
    }

    // Make sure to save the prefs on disk (and if we don't - at least reload the prefs)
    try {
      prefService.savePrefFile(null);
    }
    catch(e) {}  

    this.reload();
  },

  addListener: function(handler) {
    this.listeners.push(handler);
  },

  removeListener: function(handler) {
    for (var i = 0; i < this.listeners.length; i++)
      if (this.listeners[i] == handler)
        this.listeners.splice(i--, 1);
  },

  /**
   * nsIObserver implementation
   */
  observe: function(subject, topic, data)
  {
    if (topic == "private-browsing")
    {
      if (prefName == "enter")
        this.privateBrowsing = true;
      else if (prefName == "exit")
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

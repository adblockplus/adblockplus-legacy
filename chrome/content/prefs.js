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
 * Portions created by the Initial Developer are Copyright (C) 2006-2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Manages Adblock Plus preferences.
 * This file is included from nsAdblockPlus.js.
 */

const prefRoot = "extensions.adblockplus.";

var gObjtabClass = ""
for (let i = 0; i < 20; i++)
  gObjtabClass += String.fromCharCode("a".charCodeAt(0) + Math.random() * 26);

var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                            .getService(Components.interfaces.nsIPrefService);

var ScriptableInputStream = Components.Constructor("@mozilla.org/scriptableinputstream;1", "nsIScriptableInputStream", "init");

var prefs = {
  lastVersion: null,
  initialized: false,
  disableObserver: false,
  privateBrowsing: false,
  branch: prefService.getBranch(prefRoot),
  prefList: [],
  listeners: [],

  addObservers: function() {
    // Observe preferences changes
    try {
      var branchInternal = this.branch.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
      branchInternal.addObserver("", this, true);
    }
    catch (e) {
      dump("Adblock Plus: exception registering pref observer: " + e + "\n");
    }

    var observerService = Components.classes["@mozilla.org/observer-service;1"]
                                    .getService(Components.interfaces.nsIObserverService);

    // Observe profile changes
    try {
      observerService.addObserver(this, "profile-before-change", true);
      observerService.addObserver(this, "profile-after-change", true);
    }
    catch (e) {
      dump("Adblock Plus: exception registering profile observer: " + e + "\n");
    }

    // Add Private Browsing observer
    if ("@mozilla.org/privatebrowsing;1" in Components.classes)
    {
      try
      {
        this.privateBrowsing = Components.classes["@mozilla.org/privatebrowsing;1"]
                                         .getService(Components.interfaces.nsIPrivateBrowsingService)
                                         .privateBrowsingEnabled;
        observerService.addObserver(this, "private-browsing", true);
      }
      catch(e)
      {
        dump("Adblock Plus: exception initializing private browsing observer: " + e + "\n");
      }
    }

    // Delay initialization if profile isn't available yet (SeaMonkey)
    var doInit = true;
    if ("@mozilla.org/profile/manager;1" in Components.classes) {
      try {
        // Need to catch errors here because of kprofile.dll (Pocket K-Meleon)
        var profileManager = Components.classes["@mozilla.org/profile/manager;1"]
                                      .getService(Components.interfaces.nsIProfileInternal);
        doInit = profileManager.isCurrentProfileAvailable();
      } catch(e) {}
    }
    if (doInit)
      this.observe(null, "profile-after-change", null);
  },

  init: function() {
    try {
      // Initialize object tabs CSS
      var channel = ioService.newChannel("chrome://adblockplus/content/objtabs.css", null, null);
      channel.asyncOpen({
        data: "",
        onDataAvailable: function(request, context, stream, offset, count) {
          stream = ScriptableInputStream(stream);
          this.data += stream.read(count);
        },
        onStartRequest: function() {},
        onStopRequest: function() {
          var data = this.data.replace(/%%CLASSNAME%%/g, gObjtabClass);
          var objtabsCSS = makeURL("data:text/css," + encodeURIComponent(data));
          Components.classes["@mozilla.org/content/style-sheet-service;1"]
                    .getService(Components.interfaces.nsIStyleSheetService)
                    .loadAndRegisterSheet(objtabsCSS, styleService.USER_SHEET);
          channel = null;
        },
        QueryInterface: function(iid) {
          if (iid.equals(Components.interfaces.nsISupports) ||
              iid.equals(Components.interfaces.nsIRequestObserver) ||
              iid.equals(Components.interfaces.nsIStreamListener))
            return this;

          throw Components.results.NS_ERROR_NO_INTERFACE;
        }
      }, null);
    }
    catch (e) {}

    // Try to fix selected locale in Mozilla/SeaMonkey
    strings = stringService.createBundle("chrome://adblockplus/locale/global.properties");
    fixPackageLocale();
    strings = stringService.createBundle("chrome://adblockplus/locale/global.properties");

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

    filterStorage.loadFromDisk();
    policy.init();
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
    for each (var pref in this.prefList)
      this.loadPref(pref);

    elemhide.apply();

    // Fire pref listeners
    for each (var listener in this.listeners)
      listener(this);
  },

  // Saves the changes back into the prefs
  save: function() {
    this.disableObserver = true;
  
    for each (var pref in this.prefList)
      this.savePref(pref);

    this.disableObserver = false;

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

  // nsIObserver implementation
  observe: function(subject, topic, prefName) {
    if (topic == "profile-after-change") {
      this.init();
      this.initialized = true;
    }
    else if (this.initialized && topic == "profile-before-change") {
      filterStorage.saveToDisk();
      this.initialized = false;
    }
    else if (topic == "private-browsing")
    {
      if (prefName == "enter")
        this.privateBrowsing = true;
      else if (prefName == "exit")
        this.privateBrowsing = false;
    }
    else if (this.initialized && !this.disableObserver)
      this.reload();
  },

  // nsISupports implementation
  QueryInterface: function(iid) {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsISupportsWeakReference) &&
        !iid.equals(Components.interfaces.nsIObserver))
      throw Components.results.NS_ERROR_NO_INTERFACE;

    return this;
  }
};

prefs.addObservers();
abp.prefs = prefs;

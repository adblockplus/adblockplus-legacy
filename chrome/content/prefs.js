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

/*
 * Manages Adblock Plus preferences.
 * This file is included from nsAdblockPlus.js.
 */

var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                            .getService(Components.interfaces.nsIPrefService);

const prefList = ["Bool enabled true", "Bool linkcheck false", "Bool fastcollapse false", "Bool frameobjects true",
                  "Bool listsort true", "Bool warnregexp true", "Bool showinstatusbar true", "Bool blocklocalpages true",
                  "Bool checkedtoolbar false", "Bool checkedadblockprefs false", "Bool checkedadblockinstalled false",
                  "Bool detachsidebar false", "List patterns", "List grouporder", "Int synchronizationinterval 24"];
const synchList = ["String title", "Bool autodownload true", "Bool disabled false", "Bool external false",
                   "Int lastdownload 0", "Int lastsuccess 0", "Char downloadstatus", "Char lastmodified", "List patterns"];

var prefs = {
  disableObserver: false,
  branch: prefService.getBranch("extensions.adblockplus."),
  listeners: [],

  init: function() {
    // Preferences observer registration
    try {
      var prefInternal = prefService.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
      prefInternal.addObserver("extensions.adblockplus.", this, false);
    }
    catch (e) {
      dump("Adblock Plus: exception registering pref observer: " + e + "\n");
    }

    // Initial prefs loading
    this.reload();
  },

  // Loads a pref and stores it as a property of the object
  loadPref: function(obj, pref, prefix) {
    if (typeof prefix == "undefined")
      prefix = "";

    var parts = pref.split(" ");
    var prefName = prefix + parts[1];
    try {
      if (parts[0] == "String")
        obj[parts[1]] = this.branch.getComplexValue(prefName, Components.interfaces.nsISupportsString).data;
      else if (parts[0] == "List") {
        var str = this.branch.getCharPref(prefName);
        if (str)
          obj[parts[1]] = str.split(" ");
        else
          obj[parts[1]] = [];
      }
      else
        obj[parts[1]] = this.branch["get" + parts[0] + "Pref"](prefName);
    }
    catch (e) {
      // Use default value
      if (parts[0] == "List")
        obj[parts[1]] = [];
      else if (parts[0] == "Bool")
        obj[parts[1]] = (parts[2] == "true");
      else if (parts[0] == "Int")
        obj[parts[1]] = parseInt(parts[2]);
      else
        obj[parts[1]] = parts[2];
    }
  },

  // Saves a property of the object into the corresponding pref
  savePref: function(obj, pref, prefix) {
    if (typeof prefix == "undefined")
      prefix = "";

    var parts = pref.split(" ");
    var prefName = prefix + parts[1];
    try {
      if (parts[0] == "String") {
        var str = Components.classes["@mozilla.org/supports-string;1"]
                            .createInstance(Components.interfaces.nsISupportsString);
        str.data = obj[parts[1]];
        this.branch.setComplexValue(prefName, Components.interfaces.nsISupportsString, str);
      }
      else if (parts[0] == "List")
        this.branch.setCharPref(prefName, obj[parts[1]].join(" "));
      else
        this.branch["set" + parts[0] + "Pref"](prefName, obj[parts[1]]);
    }
    catch (e) {}
  },

  // Reloads the preferences
  reload: function() {
    for (var i = 0; i < prefList.length; i++)
      this.loadPref(this, prefList[i]);

    // Convert patterns into regexps
    this.regexps = [];
    this.whitelist = [];
  
    for (i = 0; i < this.patterns.length; i++)
      if (this.patterns[i] != "")
        this.addPattern(this.patterns[i]);
  
    // Load synchronization settings
    this.synch = new HashTable();
    for (i = 0; i < this.grouporder.length; i++) {
      if (this.grouporder[i].indexOf("~") == 0)
        continue;
  
      var synchPrefs = {url: this.grouporder[i]};
      var prefix = "synch." + synchPrefs.url + ".";
      for (var j = 0; j < synchList.length; j++)
        this.loadPref(synchPrefs, synchList[j], prefix);

      if (!synchPrefs.external) {
        try {
          // Test URL for validity, this will throw an exception for invalid URLs
          var url = Components.classes["@mozilla.org/network/simple-uri;1"]
                              .createInstance(Components.interfaces.nsIURI);
          url.spec = synchPrefs.url;
        }
        catch (e) {
          continue;
        }
      }

      if (!synchPrefs.title)
        synchPrefs.title = synchPrefs.url;

      for (j = 0; j < synchPrefs.patterns.length; j++)
        if (synchPrefs.patterns[j] != "")
          this.addPattern(synchPrefs.patterns[j]);

      this.synch.put(synchPrefs.url, synchPrefs);
    }
  
    // Fire pref listeners
    for (i = 0; i < this.listeners.length; i++)
      this.listeners[i](this);

    // Import settings from old versions
    if (!this.checkedadblockprefs)
      this.importOldPrefs();
  },

  // Saves the changes back into the prefs
  save: function() {
    this.disableObserver = true;
  
    for (var i = 0; i < prefList.length; i++)
      this.savePref(this, prefList[i]);

    for (i = 0; i < this.grouporder.length; i++) {
      if (!this.synch.has(this.grouporder[i]))
        continue;

      var synchPrefs = this.synch.get(this.grouporder[i]);
      var prefix = "synch." + this.grouporder[i] + ".";
      for (var j = 0; j < synchList.length; j++)
        this.savePref(synchPrefs, synchList[j], prefix);
    }

    // Make sure to save the this on disk
    prefService.savePrefFile(null);
  
    this.disableObserver = false;
    this.reload();
  },

  importOldPrefs: function() {
    var importBranch = prefService.getBranch("adblock.");
    for (var i = 0; i < prefList.length; i++) {
      if (prefList[i].match(/^Bool (\w+)/)) {
        var prefName = RegExp.$1;
        try {
          if (importBranch.prefHasUserValue(prefName) && !this.branch.prefHasUserValue(prefName))
            this[prefName] = importBranch.getBoolPref(prefName);
        } catch (e) {}
      }
    }
  
    try {
      if (importBranch.prefHasUserValue("patterns") && !this.branch.prefHasUserValue("patterns"))
        this.patterns = importBranch.getCharPref("patterns").split(" ");
    } catch (e) {}

    this.checkedadblockprefs = true;
    this.save();
  },

  addListener: function(handler) {
    this.listeners.push(handler);
  },

  removeListener: function(handler) {
    for (var i = 0; i < this.listeners.length; i++)
      if (this.listeners[i] == handler)
        this.listeners.splice(i--, 1);
  },

  // Converts a pattern into RegExp and adds it to the list
  addPattern: function(pattern) {
    var regexp;
    var origPattern = pattern;
  
    var list = this.regexps;
    var isWhite = false;
    if (pattern.indexOf("@@") == 0) {
      // Adblock Plus compatible whitelisting
      pattern = pattern.substr(2);
      list = this.whitelist;
      isWhite = true;
    }
  
    if (pattern.charAt(0) == "/" && pattern.charAt(pattern.length - 1) == "/")  // pattern is a regexp already
      regexp = pattern.substr(1, pattern.length - 2);
    else {
      regexp = pattern.replace(/^\*+/,"").replace(/\*+$/,"").replace(/\*+/, "*").replace(/([^\w\*])/g, "\\$1").replace(/\*/g, ".*");
      if (pattern.match(/^https?:\/\//))
        regexp = "^" + regexp;
    }
    try {
      regexp = new RegExp(regexp, "i");
      regexp.origPattern = origPattern;
      regexp.isWhite = isWhite;
      list.push(regexp);
    } catch(e) {}
  },

  // Removes all preferences of a subscription
  removeSubscription: function(name) {
    this.disableObserver = true;

    for (var i = 0; i < this.grouporder.length; i++)
      if (this.grouporder[i] == name)
        this.grouporder.splice(i--, 1);

    var prefix = "synch." + name + ".";
    for (i = 0; i < synchList.length; i++) {
      try {
        this.branch.clearUserPref(prefix + synchList[i].split(" ")[1]);
      } catch (e) {}
    }
    this.synch.remove(name);

    this.disableObserver = false;

    this.save();
  },

  // nsIObserver implementation
  observe: function(subject, topic, prefName) { 
    if (!this.disableObserver)
      this.reload();
  },

  // nsISupports implementation
  QueryInterface: function(iid) {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsIObserver))
      throw Components.results.NS_ERROR_NO_INTERFACE;

    return this;
  }
};

prefs.init();
abp.prefs = prefs;

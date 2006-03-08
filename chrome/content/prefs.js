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

const prefRoot = "extensions.adblockplus.";

var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                            .getService(Components.interfaces.nsIPrefService);
var dirService = Components.classes["@mozilla.org/file/directory_service;1"]
                           .getService(Components.interfaces.nsIProperties);
var profileDir = dirService.get("ProfD", Components.interfaces.nsIFile);
var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                          .getService(Components.interfaces.nsIIOService);

var styleService = null;
if ("nsIStyleSheetService" in Components.interfaces) {
  styleService = Components.classes["@mozilla.org/content/style-sheet-service;1"]
                           .getService(Components.interfaces.nsIStyleSheetService);
}

// Matcher class constructor
function Matcher() {
  this.patterns = [];
  this.known = new HashTable();
}

Matcher.prototype = {
  // Clears the list
  clear: function() {
    this.patterns = [];
    this.known.clear();
  },

  // Adds a pattern to the list
  add: function(pattern) {
    if (this.known.has(pattern.regexp))
      return;

    this.patterns.push(pattern);
    this.known.put(pattern.regexp, true);
  },

  // Tests whether URL matches any of the patterns in the list, returns the matching pattern
  matchesAny: function(location) {
    for (var i = 0; i < this.patterns.length; i++)
      if (this.patterns[i].regexp.test(location))
        return this.patterns[i];
  
    return null;
  }
};

// Element hiding component
var elemhide = {
  patterns: [],
  url: null,
  clear: function() {
    this.patterns = [];
    this.unapply();
  },
  add: function(pattern) {
    this.patterns.push(pattern);
  },
  apply: function() {
    this.unapply();

    // Grouping selectors by domains
    var domains = new HashTable();
    for (var i = 0; i < this.patterns.length; i++) {
      var domain = this.patterns[i].domain;
      if (!domain)
        domain = "";

      var list;
      if (domains.has(domain))
        list = domains.get(domain);
      else {
        list = [];
        domains.put(domain, list);
      }
      list.push(this.patterns[i].selector);
    }

    // Joining domains list
    var cssData = "";
    var keys = domains.keys();
    for (var i = 0; i < keys.length; i++) {
      var domain = keys[i];
      var rule = domains.get(domain).join(",") + "{display:none !important}";
      if (domain)
        rule = "@-moz-document domain(" + domain + "){" + rule + "}";
      cssData += rule;
    }

    // Creating new stylesheet
    if (styleService && cssData) {
      try {
        this.url = Components.classes["@mozilla.org/network/simple-uri;1"]
                             .createInstance(Components.interfaces.nsIURI);
        this.url.spec = "data:text/css,/*** Adblock Plus ***/" + cssData;
        styleService.loadAndRegisterSheet(this.url, styleService.USER_SHEET);
      } catch(e) {}
    }
  },
  unapply: function() {
    if (styleService && this.url) {
      try {
        styleService.unregisterSheet(this.url, styleService.USER_SHEET);
      } catch (e) {}
      this.url = null;
    }
  }
};

var prefs = {
  disableObserver: false,
  branch: prefService.getBranch(prefRoot),
  prefList: [],
  rdf: null,
  knownPatterns: new HashTable(),
  userPatterns: [],
  knownSubscriptions: new HashTable(),
  listedSubscriptions: new HashTable(),
  subscriptions: [],
  filterPatterns: new Matcher(),
  whitePatterns: new Matcher(),
  whitePatternsPage: new Matcher(),
  elemhidePatterns: elemhide,
  listeners: [],
  hitListeners: [],

  init: function() {
    // Preferences observer registration
    try {
      var branchInternal = this.branch.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
      branchInternal.addObserver("", this, false);
    }
    catch (e) {
      dump("Adblock Plus: exception registering pref observer: " + e + "\n");
    }

    // Shutdown observer registration
    try {
      var observerService = Components.classes["@mozilla.org/observer-service;1"]
                                      .getService(Components.interfaces.nsIObserverService);
      observerService.addObserver(this, "xpcom-shutdown", false);
    }
    catch (e) {
      dump("Adblock Plus: exception registering shutdown observer: " + e + "\n");
    }

    // Initialize prefs list
    var defaultBranch = prefService.getDefaultBranch(prefRoot);
    var defaultPrefs = defaultBranch.getChildList("", {});
    for (var i = 0; i < defaultPrefs.length; i++) {
      var name = defaultPrefs[i];
      var type = defaultBranch.getPrefType(name);
      var typeName = "Char";
      if (type == defaultBranch.PREF_INT)
        typeName = "Int";
      else if (type == defaultBranch.PREF_BOOL)
        typeName = "Bool";

      try {
        var pref = [name, typeName, defaultBranch["get" + typeName + "Pref"](name)];
        this.prefList.push(pref);
        this.prefList[" " + name] = pref;
      } catch(e) {}
    }

    // Initial prefs loading
    this.reload();
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
    for (var i = 0; i < this.prefList.length; i++)
      this.loadPref(this.prefList[i]);

    // Make sure we have an RDF datasource
    var oldRDF = this.rdf;
    this.initDataSource();

    // Only reload data from RDF if we have a new datasource
    if (this.rdf != oldRDF)
      this.reloadPatterns()

    if (this.enabled)
      this.elemhidePatterns.apply();

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
  
    for (var i = 0; i < this.prefList.length; i++)
      this.savePref(this.prefList[i]);

    this.disableObserver = false;

    // Make sure to save the prefs on disk (and if we don't - at least reload the prefs)
    try {
      prefService.savePrefFile(null);
    }
    catch(e) {}  

    this.reload();
  },

  initDataSource: function() {
    var rdfFile = null;
    if (!rdfFile) {
      // Try using patternsfile as absolute path first
      try {
        rdfFile = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
        rdfFile.initWithPath(this.patternsfile);
      }
      catch (e) {
        rdfFile = null;
      }
    }

    if (!rdfFile) {
      // Try relative path now
      try {
        rdfFile = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
        rdfFile.setRelativeDescriptor(profileDir, this.patternsfile);
      }
      catch (e) {
        rdfFile = null;
      }
    }

    if (!rdfFile && " patternsfile" in this.prefList) {
      // Use default
      try {
        rdfFile = Components.classes["@mozilla.org/file/local;1"]
                            .createInstance(Components.interfaces.nsILocalFile);
        rdfFile.setRelativeDescriptor(profileDir, this.prefList[" patternsfile"][2]);
      }
      catch (e) {
        rdfFile = null;
      }
    }

    if (rdfFile) {
      // Try to initialize the datasource from file
      try {
        rdfFile.normalize();
        var rdfURI = ioService.newFileURI(rdfFile);

        // If we have the datasource for this file already - nothing to do
        if (this.rdf && this.rdf.URI == rdfURI.spec)
          return;

        // Try to create the file's directory recursively
        var parents = [];
        try {
          for (var parent = rdfFile.parent; parent; parent = parent.parent)
            parents.push(parent);
        } catch (e) {}
        for (var i = parents.length - 1; i >= 0; i--) {
          try {
            parents[i].create(parents[i].DIRECTORY_TYPE, 0644);
          } catch (e) {}
        }

        this.rdf = rdfService.GetDataSourceBlocking(rdfURI.spec);
        return;
      }
      catch (e) {}
    }

    if (!this.rdf || this.rdf.URI) {
      // Use in-memory datasource if everything else fails and we don't have an in-memory datasource already
      this.rdf = Components.classes["@mozilla.org/rdf/datasource;1?name=in-memory-datasource"]
                           .createInstance(Components.interfaces.nsIRDFDataSource);
      return;
    }
  },

  resourcePatterns: resource("patterns"),
  resourceInitialized: resource("initialized"),
  resourceText: resource("text"),
  resourceType: resource("type"),
  resourceRegExp: resource("regexp"),
  resourcePageWhitelist: resource("pageWhitelist"),
  resourceDisabled: resource("disabled"),
  resourceHitCount: resource("hitCount"),
  resourceSubscriptions: resource("subscriptions"),
  resourceURL: resource("url"),
  resourceTitle: resource("title"),
  resourceAutoDownload: resource("autoDownload"),
  resourceExternal: resource("external"),
  resourceLastDownload: resource("lastDownload"),
  resourceLastSuccess: resource("lastSuccess"),
  resourceDownloadStatus: resource("downloadStatus"),
  resourceLastModified: resource("lastModified"),

  // Reloads pattern data from the RDF file
  reloadPatterns: function() {
//    var start = new Date().getTime();

    if (cache)
      cache.clear();
    this.knownPatterns.clear();
    this.listedSubscriptions.clear();
    this.filterPatterns.clear();
    this.whitePatterns.clear();
    this.whitePatternsPage.clear();
    this.elemhidePatterns.clear();

    var patterns = sequence(this.rdf, this.resourcePatterns);
    var enum = patterns.GetElements();
    this.userPatterns = [];
    while (enum.hasMoreElements()) {
      var pattern = this.patternFromResource(enum.getNext());
      if (pattern)
        this.userPatterns.push(pattern);
    }

    if (this.branch.prefHasUserValue("patterns")) {
      // Import old patterns
      this.disableObserver = true;
      var list = this.patterns.split(" ");
      for (var i = 0; i < list.length; i++) {
        if (!this.knownPatterns.has(list[i])) {
          var pattern = this.patternFromText(list[i]);
          if (pattern)
            this.userPatterns.push(pattern);
        }
      }

      try {
        this.branch.clearUserPref("patterns");
        prefService.savePrefFile(null);
      } catch(e) {}
      this.disableObserver = false;
    }

    var subscriptions = sequence(this.rdf, this.resourceSubscriptions);
    var enum = subscriptions.GetElements();
    this.subscriptions = [];
    while (enum.hasMoreElements()) {
      var subscription = this.subscriptionFromResource(enum.getNext());
      if (subscription) {
        this.subscriptions.push(subscription);
        this.listedSubscriptions.put(subscription.url, subscription);
      }
    }

    if (this.branch.prefHasUserValue("grouporder")) {
      // Import old subscriptions
      this.disableObserver = true;
      var list = this.grouporder.split(" ");
      for (var i = 0; i < list.length; i++) {
        if (!this.listedSubscriptions.has(list[i])) {
          var subscription = this.subscriptionFromURL(list[i]);
          if (subscription) {
            this.subscriptions.push(subscription);
            this.listedSubscriptions.put(subscription.url, subscription);
          }
        }
      }
      try {
        this.branch.clearUserPref("grouporder");
        prefService.savePrefFile(null);
      } catch(e) {}
      this.disableObserver = false;
    }

    if (!this.checkedadblocksync)
      this.importOldPatterns();

    if (this.userPatterns.length == 0 &&
        " patterns" in this.prefList &&
        !manipulator(this.rdf, this.resourcePatterns).getBoolean(this.resourceInitialized, false)) {
      // Fill patterns list with default values
      var list = this.prefList[" patterns"][2].split(" ");
      for (var i = 0; i < list.length; i++) {
        var pattern = this.patternFromText(list[i]);
        if (pattern)
          this.userPatterns.push(pattern);
      }
    }

    if (" grouporder" in this.prefList) {
      var special = this.prefList[" grouporder"][2].split(" ");
      for (i = 0; i < special.length; i++) {
        if (!this.listedSubscriptions.has(special[i])) {
          var subscription = this.subscriptionFromURL(special[i]);
          if (subscription) {
            this.subscriptions.push(subscription);
            this.listedSubscriptions.put(subscription.url, subscription);
          }
        }
      }
    }

    if (this.enabled)
      this.elemhidePatterns.apply();

//    dump("Time to load patterns: " + (new Date().getTime() - start) + "\n");
  },

  // Saves pattern data back to the RDF file
  savePatterns: function(noReload) {
//    var start = new Date().getTime();

    // Remove everything from the datasource first
    var enum = this.rdf.GetAllResources();
    while (enum.hasMoreElements())
      manipulator(this.rdf, enum.getNext()).removeOutArcs();

    manipulator(this.rdf, this.resourcePatterns).setBoolean(this.resourceInitialized, true);

    // Store user patterns
    var patterns = sequence(this.rdf, this.resourcePatterns);
    for (var i = 0; i < this.userPatterns.length; i++) {
      var node = resource("pattern " + this.userPatterns[i].text);
      this.patternToResource(node, this.userPatterns[i]);
      patterns.AppendElement(node);
    }

    // Store subscriptions
    var subscriptions = sequence(this.rdf, this.resourceSubscriptions);
    for (i = 0; i < this.subscriptions.length; i++) {
      var node = resource("subscription " + this.subscriptions[i].url);
      this.subscriptionToResource(node, this.subscriptions[i]);
      subscriptions.AppendElement(node);
    }

    // Make sure everything is written on disk
    try {
      this.rdf.QueryInterface(Components.interfaces.nsIRDFRemoteDataSource).Flush();
    } catch(e) {}

//    dump("Time to save patterns: " + (new Date().getTime() - start) + "\n");

    // Reinit data now
    if (typeof noReload == "undefined" || !noReload)
      this.reloadPatterns();
  },

  // Creates a pattern from a resource in the RDF datasource
  patternFromResource: function(node, forceDisabled) {
    try {
      node = manipulator(this.rdf, node);
    }
    catch (e) {
      return null;
    }

    var text = node.getLiteral(this.resourceText, null);
    if (text == null)
      return null;

    if (this.knownPatterns.has(text))
      return this.knownPatterns.get(text);

    var ret = {text: text};

    ret.type = node.getLiteral(this.resourceType, null);
    ret.regexpText = node.getLiteral(this.resourceRegExp, null);
    if (ret.type == "whitelist")
      ret.pageWhitelist = node.getBoolean(this.resourcePageWhitelist, null);
    if (ret.type == null || ret.type == "elemhide" || ret.type == "invalid" ||
        ((ret.type == "whitelist" || ret.type == "filterlist") && ret.regexpText == null) ||
        (ret.type == "whitelist" && ret.pageWhitelist == null)
       )
      this.initPattern(ret);
    else
      this.initRegexp(ret);

    ret.disabled = node.getBoolean(this.resourceDisabled, false);
    ret.hitCount = node.getInteger(this.resourceHitCount, 0);

    if (typeof forceDisabled == "undefined" || !forceDisabled)
      this.addPattern(ret);
    this.knownPatterns.put(text, ret);
    return ret;
  },

  // Creates a pattern from pattern text
  patternFromText: function(text, forceDisabled) {
    if (!/\S/.test(text))
      return null;

    if (this.knownPatterns.has(text))
      return this.knownPatterns.get(text);

    var ret = {text: text};
    this.initPattern(ret);

    ret.disabled = false;
    ret.hitCount = 0;

    if (typeof forceDisabled == "undefined" || !forceDisabled)
      this.addPattern(ret);
    this.knownPatterns.put(text, ret);
    return ret;
  },

  initPattern: function(pattern) {
    var text = pattern.text;
    if (/^([^\/\*\|\@]*)#([\w\-]+|\*)(?:\(([\w\-]+)\))?$/.test(text)) {
      pattern.type = "elemhide";

      pattern.domain = RegExp.$1;
      var tagname = RegExp.$2;
      var id = RegExp.$3;

      if (tagname == "*")
        tagname = "";

      if (id)
        pattern.selector = tagname + "." + id + "," + tagname + "#" + id;
      else if (tagname)
        pattern.selector = tagname;
      else
        pattern.type = "invalid";

      if (!styleService)
        pattern.type = "invalid";
    }
    else if (text.indexOf("!") == 0)
      pattern.type = "comment";
    else {
      pattern.type = "filterlist"
      if (text.indexOf("@@") == 0) {
        pattern.type = "whitelist";
        text = text.substr(2);
        pattern.pageWhitelist = /^\|?https?:\/\//.test(text);
      }

      if (/^\/.*\/$/.test(text))  // pattern is a regexp already
        pattern.regexpText = text.substr(1, text.length - 2);
      else {
        pattern.regexpText = text.replace(/\*+/g, "*")        // remove multiple wildcards
                                 .replace(/(\W)/g, "\\$1")    // escape special symbols
                                 .replace(/\\\*/g, ".*")      // replace wildcards by .*
                                 .replace(/^\\\|/, "^")       // process anchor at expression start
                                 .replace(/\\\|$/, "$")       // process anchor at expression end
                                 .replace(/^(\.\*)/,"")       // remove leading wildcards
                                 .replace(/(\.\*)$/,"");      // remove trailing wildcards
      }
      if (pattern.regexpText == "")
        pattern.regexpText = ".*";

      this.initRegexp(pattern);
    }
  },

  initRegexp: function(pattern) {
    if ((pattern.type == "whitelist" || pattern.type == "filterlist") && !("regexp" in pattern)) {
      try {
        pattern.regexp = new RegExp(pattern.regexpText, "i");
      }
      catch (e) {
        pattern.type = "invalid";
      }
    }
  },

  patternToResource: function(node, pattern) {
    node = manipulator(this.rdf, node);

    // Store pattern data
    node.setLiteral(this.resourceText, pattern.text);
    node.setLiteral(this.resourceType, pattern.type);
    if ("regexpText" in pattern && pattern.regexpText)
      node.setLiteral(this.resourceRegExp, pattern.regexpText);
    if ("pageWhitelist" in pattern && pattern.pageWhitelist != null)
      node.setBoolean(this.resourcePageWhitelist, pattern.pageWhitelist);
    node.setBoolean(this.resourceDisabled, pattern.disabled);
    node.setInteger(this.resourceHitCount, pattern.hitCount);
  },

  addPattern: function(pattern) {
    if (!pattern.disabled) {
      if (pattern.type == "filterlist")
        this.filterPatterns.add(pattern);
      else if (pattern.type == "whitelist") {
        this.whitePatterns.add(pattern);
        if (pattern.pageWhitelist)
          this.whitePatternsPage.add(pattern);
      }
      else if (pattern.type == "elemhide")
        this.elemhidePatterns.add(pattern);
    }
  },

  increaseHitCount: function(pattern) {
    pattern.hitCount++;

    // Fire hit count listeners
    for (i = 0; i < this.hitListeners.length; i++)
      this.hitListeners[i](pattern);
  },

  specialSubscriptions: {
    ' ~il~': ["invalid_description", "invalid"],
    ' ~wl~': ["whitelist_description", "whitelist"],
    ' ~fl~': ["filterlist_description", "filterlist", "comment"],
    ' ~eh~': ["elemhide_description", "elemhide"],
  },

  // Creates a subscription from a resource in the RDF datasource
  subscriptionFromResource: function(node) {
    try {
      node = manipulator(this.rdf, node);
    }
    catch (e) {
      return null;
    }

    var url = node.getLiteral(this.resourceURL, null);
    if (url == null)
      return null;

    if (this.listedSubscriptions.has(url))
      return null;

    if (" " + url in this.specialSubscriptions)
      return this.subscriptionFromURL(url);
    else {
      var ret = {url: url};
      ret.special = false;
      ret.title = node.getLiteral(this.resourceTitle, url);
      ret.autoDownload = node.getBoolean(this.resourceAutoDownload, true);
      ret.disabled = node.getBoolean(this.resourceDisabled, false);
      ret.external = node.getBoolean(this.resourceExternal, false);
      ret.lastDownload = node.getInteger(this.resourceLastDownload, 0);
      ret.lastSuccess = node.getInteger(this.resourceLastSuccess, 0);
      ret.downloadStatus = node.getLiteral(this.resourceDownloadStatus, null);
      ret.lastModified = node.getLiteral(this.resourceLastModified, null);

      if (!ret.external) {
        try {
          // Test URL for validity, this will throw an exception for invalid URLs
          var uri = Components.classes["@mozilla.org/network/simple-uri;1"]
                              .createInstance(Components.interfaces.nsIURI);
          uri.spec = ret.url;
        }
        catch (e) {
          return null;
        }
      }

      var patterns = node.getSequence();
      var enum = patterns.GetElements();
      ret.patterns = [];
      while (enum.hasMoreElements()) {
        var pattern = this.patternFromResource(enum.getNext(), ret.disabled);
        if (pattern)
          ret.patterns.push(pattern);
      }
    }

    this.knownSubscriptions.put(url, ret);
    return ret;
  },

  subscriptionFromURL: function(url) {
    if (this.listedSubscriptions.has(url))
      return null;

    var ret;
    if (" " + url in this.specialSubscriptions) {
      var data = this.specialSubscriptions[" " + url];
      ret = {
        url: url,
        special: true,
        title: abp.getString(data[0]),
        types: data.slice(1),
        patterns: []
      };
    }
    else {
      ret = {
        url: url,
        special: false,
        title: url,
        autoDownload: true,
        disabled: false,
        external: false,
        lastDownload: 0,
        lastSuccess: 0,
        downloadStatus: "",
        lastModified: "",
        patterns: []
      };

      // Try to import old subscription data
      var prefix = "synch." + url + ".";
      if (this.branch.prefHasUserValue(prefix + "title")) {
        try {
          ret.title = this.branch.getComplexValue(prefix + "title", Components.interfaces.nsISupportsString).data;
          this.branch.clearUserPref(prefix + "title");
        } catch(e) {}
      }
      var imprt = [
        ["Bool","autodownload","autoDownload"],
        ["Bool","disabled","disabled"],
        ["Bool","external","external"],
        ["Int","lastdownload","lastDownload"],
        ["Int","lastsuccess","lastSuccess"],
        ["Char","downloadstatus","downloadStatus"],
        ["Char","lastmodified","lastModified"]
      ];
      for (var i = 0; i < imprt.length; i++) {
        if (this.branch.prefHasUserValue(prefix + imprt[i][1])) {
          try {
            ret[imprt[i][2]] = this.branch["get"+imprt[i][0]+"Pref"](prefix + imprt[i][1]);
            this.branch.clearUserPref(prefix + imprt[i][1]);
          } catch(e) {}
        }
      }

      if (!ret.external) {
        try {
          // Test URL for validity, this will throw an exception for invalid URLs
          var uri = Components.classes["@mozilla.org/network/simple-uri;1"]
                              .createInstance(Components.interfaces.nsIURI);
          uri.spec = ret.url;
        }
        catch (e) {
          return null;
        }
      }

      if (this.branch.prefHasUserValue(prefix + "patterns")) {
        try {
          var list = this.branch.getCharPref(prefix + "patterns").split(" ");
          for (var i = 0; i < list.length; i++) {
            var pattern = this.patternFromText(list[i], ret.disabled);
            if (pattern)
              ret.patterns.push(pattern);
          }
          this.branch.clearUserPref(prefix + "patterns");
        } catch(e) {}
      }
    }

    this.knownSubscriptions.put(url, ret);
    return ret;
  },

  subscriptionToResource: function(node, subscription) {
    node = manipulator(this.rdf, node);

    // Store pattern data
    node.setLiteral(this.resourceURL, subscription.url);
    if (subscription.special)
      return;

    if (subscription.title)
      node.setLiteral(this.resourceTitle, subscription.title);
    node.setBoolean(this.resourceAutoDownload, subscription.autoDownload);
    node.setBoolean(this.resourceDisabled, subscription.disabled);
    node.setBoolean(this.resourceExternal, subscription.external);
    if (subscription.lastDownload)
      node.setInteger(this.resourceLastDownload, subscription.lastDownload);
    if (subscription.lastSuccess)
      node.setInteger(this.resourceLastSuccess, subscription.lastSuccess);
    if (subscription.downloadStatus)
      node.setLiteral(this.resourceDownloadStatus, subscription.downloadStatus);
    if (subscription.lastModified)
      node.setLiteral(this.resourceLastModified, subscription.lastModified);

    var patterns = node.getSequence();
    for (var i = 0; i < subscription.patterns.length; i++) {
      var patternNode = resource("pattern " + subscription.patterns[i].text);
      this.patternToResource(patternNode, subscription.patterns[i]);
      patterns.AppendElement(patternNode);
    }
  },

  importOldPrefs: function() {
    var importBranch = prefService.getBranch("adblock.");
    for (var i = 0; i < this.prefList.length; i++) {
      if (this.prefList[i][1] == "Bool") {
        var prefName = this.prefList[i][0];
        try {
          if (importBranch.prefHasUserValue(prefName) && !this.branch.prefHasUserValue(prefName))
            this[prefName] = importBranch.getBoolPref(prefName);
        } catch (e) {}
      }
    }
  
    this.checkedadblockprefs = true;
  },

  importOldPatterns: function() {
    var importBranch = prefService.getBranch("adblock.");
    var i, j, list;

    list = [];
    try {
      if (importBranch.prefHasUserValue("patterns") && this.userPatterns.length == 0)
        list = importBranch.getCharPref("patterns").split(" ");
    } catch (e) {}

    for (i = 0; i < list.length; i++) {
      var pattern = this.patternFromText(list[i]);
      if (pattern)
        this.userPatterns.push(pattern);
    }

    list = [];
    try {
      list = importBranch.getCharPref("syncpath").split("|");
    } catch (e) {}

    for (i = 0; i < list.length; i++) {
      var subscription = this.subscriptionFromURL(list[i]);
      if (subscription)
        this.subscriptions.push(subscription);
    }

    this.checkedadblocksync = true;
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

  addHitCountListener: function(handler) {
    this.hitListeners.push(handler);
  },

  removeHitCountListener: function(handler) {
    for (var i = 0; i < this.hitListeners.length; i++)
      if (this.hitListeners[i] == handler)
        this.hitListeners.splice(i--, 1);
  },

  // nsIObserver implementation
  observe: function(subject, topic, prefName) {
    if (topic == "xpcom-shutdown")
      this.savePatterns(true);
    else if (!this.disableObserver)
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

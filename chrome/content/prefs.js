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
var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                          .getService(Components.interfaces.nsIIOService);

var unicodeConverter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                 .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
unicodeConverter.charset = "UTF-8";

var styleService = null;
if ("nsIStyleSheetService" in Components.interfaces) {
  styleService = Components.classes["@mozilla.org/content/style-sheet-service;1"]
                           .getService(Components.interfaces.nsIStyleSheetService);
}

// Matcher class constructor
function Matcher() {
  this.patterns = [];
  this.shortcutHash = new HashTable();
  this.shortcuts = 0;
  this.regexps = [];
  this.known = new HashTable();
  this.resultCache = new HashTable();
  this.cacheEntries = 0;
}

const shortcutLength = 8;
const minShortcutNumber = 100;
const maxCacheEntries = 10000;

Matcher.prototype = {
  // Clears the list
  clear: function() {
    this.patterns = [];
    this.shortcutHash = new HashTable();
    this.shortcuts = 0;
    this.regexps = [];
    this.known.clear();
    this.resultCache.clear();
    this.cacheEntries = 0;
  },

  // Adds a pattern to the list
  add: function(pattern) {
    if (this.known.has(pattern.regexp))
      return;

    // Look for a suitable shortcut if the current can't be used
    if (!("shortcut" in pattern) || this.shortcutHash.has(pattern.shortcut)) {
      delete pattern.shortcut;
      if (!/^(@@)?\/.*\/$/.test(pattern.text)) {
        for (var i = 0; i < pattern.text.length - shortcutLength + 1; i++) {
          var candidate = pattern.text.substr(i, shortcutLength);
          if (!/[*|@]/.test(candidate) && !this.shortcutHash.has(candidate)) {
            pattern.shortcut = candidate;
            break;
          }
        }
      }
    }

    if ("shortcut" in pattern) {
      this.shortcutHash.put(pattern.shortcut, pattern);
      this.shortcuts++;
    }
    else 
      this.regexps.push(pattern);

    this.patterns.push(pattern);
    this.known.put(pattern.regexp, true);
  },

  matchesAnyInternal: function(location) {
    var list = this.patterns;
    if (this.shortcuts > minShortcutNumber) {
      // Optimize matching using shortcuts
      var endPos = location.length - shortcutLength + 1;
      for (var i = 0; i <= endPos; i++) {
        var substr = location.substr(i, shortcutLength);
        if (this.shortcutHash.has(substr) && this.shortcutHash.get(substr).regexp.test(location))
          return this.shortcutHash.get(substr);
      }

      list = this.regexps;
    }

    for (i = 0; i < list.length; i++)
      if (list[i].regexp.test(location))
        return list[i];

    return null;
  },

  // Tests whether URL matches any of the patterns in the list, returns the matching pattern
  matchesAny: function(location) {
    var result = this.resultCache.get(location);
    if (typeof result == "undefined") {
      result = this.matchesAnyInternal(location);

      if (this.cacheEntries >= maxCacheEntries) {
        this.resultCache.clear();
        this.cacheEntries = 0;
      }
  
      this.resultCache.put(location, result);
      this.cacheEntries++;
    }

    return result;
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
        list = new HashTable();
        domains.put(domain, list);
      }
      list.put(this.patterns[i].selector, true);
    }

    // Joining domains list
    var cssData = "";
    var keys = domains.keys();
    for (var i = 0; i < keys.length; i++) {
      var domain = keys[i];
      var rule = domains.get(domain).keys().join(",") + "{display:none !important}\n";
      if (domain) {
        var parts = domain.split(",");
        rule = '@-moz-document domain("' + domain.split(",").join('"),domain("') + '"){\n' + rule + '}\n';
      }
      cssData += rule;
    }

    // Creating new stylesheet
    if (styleService && cssData) {
      try {
        this.url = Components.classes["@mozilla.org/network/simple-uri;1"]
                             .createInstance(Components.interfaces.nsIURI);
        this.url.spec = "data:text/css;charset=utf8,/*** Adblock Plus ***/" + encodeURIComponent("\n" + cssData);
        styleService.loadAndRegisterSheet(this.url, styleService.USER_SHEET);
      } catch(e) {};
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
abp.elemhideRegExp = /^([^\/\*\|\@"]*?)#(?:([\w\-]+|\*)((?:\([\w\-]+(?:[$^*]?=[^\(\)"]*)?\))*)|#([^{}]+))$/;

var prefs = {
  initialized: false,
  disableObserver: false,
  branch: prefService.getBranch(prefRoot),
  prefList: [],
  patternsFile: null,
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

  addObservers: function() {
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
      observerService.addObserver(this, "profile-before-change", false);
      observerService.addObserver(this, "profile-after-change", false);
    }
    catch (e) {
      dump("Adblock Plus: exception registering profile observer: " + e + "\n");
    }

    var doInit = true;
    if ("@mozilla.org/profile/manager;1" in Components.classes) {
      var profileManager = Components.classes["@mozilla.org/profile/manager;1"]
                                    .getService(Components.interfaces.nsIProfileInternal);
      doInit = profileManager.isCurrentProfileAvailable();
    }
    if (doInit)
      this.observe(null, "profile-after-change", null);
  },

  init: function() {
    // Try to fix selected locale in Mozilla/SeaMonkey
    strings = stringService.createBundle("chrome://adblockplus/locale/global.properties");
    fixPackageLocale();
    strings = stringService.createBundle("chrome://adblockplus/locale/global.properties");

    // Initialize prefs list
    var defaultBranch = prefService.getDefaultBranch(prefRoot);
    var defaultPrefs = defaultBranch.getChildList("", {});

    this.prefList = [];
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
    this.reloadPatterns();

    // Initialize content policy constants
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
    for (var i = 0; i < this.prefList.length; i++)
      this.loadPref(this.prefList[i]);

    if (this.enabled)
      this.elemhidePatterns.apply();
    else
      this.elemhidePatterns.unapply();

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

  // Reloads pattern data from the patterns file
  reloadPatterns: function() {
//    var start = new Date().getTime();

    this.knownPatterns.clear();
    this.listedSubscriptions.clear();
    this.userPatterns = [];
    this.subscriptions = [];

    this.patternsFile = this.getFileByPath(this.patternsfile);
    if (!this.patternsFile && " patternsfile" in this.prefList)
      this.patternsFile = this.getFileByPath(this.prefList[" patternsfile"][2]);  // Try default

    var stream = null;
    if (this.patternsFile) {
      stream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                         .createInstance(Components.interfaces.nsIFileInputStream);
      try {
        stream.init(this.patternsFile, 0x01, 0444, 0);
      }
      catch (e) {
        stream = null;
      }
    }

    if (stream) {
      stream = stream.QueryInterface(Components.interfaces.nsILineInputStream);

      var makeList = {"user patterns": true, "subscription patterns": true};
      var wantList = false;
      var makeObj = {"pattern": true, "subscription": true};
      var wantObj = false;
      var curObj = null;
      var curSection = null;
      var wantProp = false;
      var line = {value: null};
      while (stream.readLine(line) || (line = {value: '[end]'})) {
        var val = line.value;

        try {
          val = unicodeConverter.ConvertToUnicode(val);
        } catch(e) {}

        if (wantObj && /^(\w+)=(.*)$/.test(val))
          curObj[RegExp.$1] = RegExp.$2;
        else if (/^\s*\[(.+)\]\s*$/.test(val)) {
          var newSection = RegExp.$1.toLowerCase();
          if (curObj) {
            // Process current object before going to next section
            if (curSection == "pattern")
              prefs.patternFromObject(curObj);
            else if (curSection == "subscription") {
              var subscription = prefs.subscriptionFromObject(curObj);
              if (subscription) {
                prefs.subscriptions.push(subscription);
                prefs.listedSubscriptions.put(subscription.url, subscription);
              }
            }
            else if (curSection == "user patterns") {
              for (var i = 0; i < curObj.length; i++) {
                var pattern = prefs.patternFromText(curObj[i]);
                if (pattern)
                  prefs.userPatterns.push(pattern);
              }
            }
            else if (curSection == "subscription patterns" && prefs.subscriptions.length) {
              subscription = prefs.subscriptions[prefs.subscriptions.length - 1];
              for (var i = 0; i < curObj.length; i++) {
                var pattern = prefs.patternFromText(curObj[i]);
                if (pattern)
                  subscription.patterns.push(pattern);
              }
            }
          }
  
          if (newSection == 'end')
            break;

          curSection = newSection;
          wantList = curSection in makeList;
          wantObj = curSection in makeObj;
          if (wantObj)
            curObj = {};
          else if (wantList)
            curObj = [];
          else
            curObj = null;
        }
        else if (wantList && val)
          curObj.push(val);
      }
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

    if (this.userPatterns.length == 0 && " patterns" in this.prefList && !stream) {
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

    this.initMatching();

//    dump("Time to load patterns: " + (new Date().getTime() - start) + "\n");
  },

  initMatching: function() {
/*    if (cache)
      cache.clear();*/

    this.filterPatterns.clear();
    this.whitePatterns.clear();
    this.whitePatternsPage.clear();
    this.elemhidePatterns.clear();

    for (var i = 0; i < this.userPatterns.length; i++)
      this.addPattern(this.userPatterns[i]);

    for (i = 0; i < this.subscriptions.length; i++) {
      var subscription = this.subscriptions[i];
      if (!subscription.disabled)
        for (var j = 0; j < subscription.patterns.length; j++)
          this.addPattern(subscription.patterns[j]);
    }

    if (this.enabled)
      this.elemhidePatterns.apply();
  },

  getFileByPath: function(path) {
    try {
      // Assume a relative path first
      var file = Components.classes["@mozilla.org/file/local;1"]
                           .createInstance(Components.interfaces.nsILocalFile);
      file.initWithPath(path);
      return file;
    } catch (e) {}

    try {
      // Try relative path now
      var profileDir = dirService.get("ProfD", Components.interfaces.nsIFile);
      file = Components.classes["@mozilla.org/file/local;1"]
                       .createInstance(Components.interfaces.nsILocalFile);
      file.setRelativeDescriptor(profileDir, path);
      return file;
    } catch (e) {}

    return null;
  },

  // Saves pattern data back to the patterns file
  savePatterns: function() {
    var i;
//    var start = new Date().getTime();

    if (!this.patternsFile)
      return;

    try {
      this.patternsFile.normalize();
    }
    catch (e) {}

    // Try to create the file's directory recursively
    var parents = [];
    try {
      for (var parent = this.patternsFile.parent; parent; parent = parent.parent) {
        parents.push(parent);

        // Hack for MacOS: parent for / is /../ :-/
        if (parent.path == "/")
          break;
      }
    } catch (e) {}
    for (i = parents.length - 1; i >= 0; i--) {
      try {
        parents[i].create(parents[i].DIRECTORY_TYPE, 0755);
      } catch (e) {}
    }

    if (this.patternsFile.exists()) {
      // Check whether we need to backup the file
      var part1 = this.patternsFile.leafName;
      var part2 = "";
      if (/^(.*)(\.\w+)$/.test(part1)) {
        part1 = RegExp.$1;
        part2 = RegExp.$2;
      }

      var doBackup = (this.patternsbackups > 0);
      if (doBackup) {
        var lastBackup = this.patternsFile.clone();
        lastBackup.leafName = part1 + "-backup1" + part2;
        if (lastBackup.exists() && (new Date().getTime() - lastBackup.lastModifiedTime) / 3600000 < this.patternsbackupinterval)
          doBackup = false;
      }

      if (doBackup) {
        var backupFile = this.patternsFile.clone();
        backupFile.leafName = part1 + "-backup" + this.patternsbackups + part2;

        // Remove oldest backup
        try {
          backupFile.remove(false);
        } catch (e) {}

        // Rename backup files
        for (i = this.patternsbackups - 1; i >= 0; i--) {
          backupFile.leafName = part1 + (i > 0 ? "-backup" + i : "") + part2;
          try {
            backupFile.moveTo(backupFile.parent, part1 + "-backup" + (i+1) + part2);
          } catch (e) {}
        }
      }
      else {
        // Remove existing file
        try {
          this.patternsFile.remove(false);
        } catch (e) {}
      }
    }

    var stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                           .createInstance(Components.interfaces.nsIFileOutputStream);
    try {
      stream.init(this.patternsFile, 0x02 | 0x08 | 0x20, 0644, 0)
    }
    catch (e) {
      dump("Adblock plus: failed write pattern to file " + this.patternsFile.path + ": " + e + "\n");
      return;
    }

    var lineBreak = abp.getLineBreak();
    var buf = ['# Adblock Plus preferences', ''];

    var saved = new HashTable();

    // Save pattern data
    for (i = 0; i < this.userPatterns.length; i++) {
      var pattern = this.userPatterns[i];
      if (!saved.has(pattern.text)) {
        this.serializePattern(buf, pattern);
        saved.put(pattern.text, pattern);
      }
    }

    for (i = 0; i < this.subscriptions.length; i++) {
      var subscription = this.subscriptions[i];
      for (var j = 0; j < subscription.patterns.length; j++) {
        var pattern = subscription.patterns[j];
        if (!saved.has(pattern.text)) {
          this.serializePattern(buf, pattern);
          saved.put(pattern.text, pattern);
        }
      }
    }

    // Save user patterns list
    buf.push('[User patterns]');
    for (i = 0; i < this.userPatterns.length; i++)
      buf.push(this.userPatterns[i].text);
    buf.push('');

    // Save subscriptions list
    for (i = 0; i < this.subscriptions.length; i++)
      this.serializeSubscription(buf, this.subscriptions[i]);

    buf = unicodeConverter.ConvertFromUnicode(buf.join(lineBreak) + lineBreak);
    try {
      stream.write(buf, buf.length);
    }
    finally {
      stream.close();
    }

//    dump("Time to save patterns: " + (new Date().getTime() - start) + "\n");
  },

  // Creates a pattern from a data object
  patternFromObject: function(obj) {
    var text = ("text" in obj ? obj.text : null);
    if (!text)
      return null;

    if (this.knownPatterns.has(text))
      return this.knownPatterns.get(text);

    var ret = {text: text};

    ret.type = ("type" in obj ? obj.type : null);
    ret.regexpText = ("regexp" in obj ? obj.regexp : null);
    ret.pageWhitelist = ("pageWhitelist" in obj ? obj.pageWhitelist == "true" : null);
    if (ret.type == null || ret.type == "elemhide" || ret.type == "invalid" ||
        ((ret.type == "whitelist" || ret.type == "filterlist") && ret.regexpText == null) ||
        (ret.type == "whitelist" && ret.pageWhitelist == null)
       )
      this.initPattern(ret);
    else
      this.initRegexp(ret);

    if ("shortcut" in obj)
      ret.shortcut = obj.shortcut;
    ret.disabled = ("disabled" in obj && obj.disabled == "true");
    ret.hitCount = ("hitCount" in obj ? parseInt(obj.hitCount) : 0) || 0;

    this.knownPatterns.put(text, ret);
    return ret;
  },

  // Creates a pattern from pattern text
  patternFromText: function(text) {
    if (!/\S/.test(text))
      return null;

    if (this.knownPatterns.has(text))
      return this.knownPatterns.get(text);

    var ret = {text: text};
    this.initPattern(ret);

    ret.disabled = false;
    ret.hitCount = 0;

    this.knownPatterns.put(text, ret);
    return ret;
  },

  initPattern: function(pattern) {
    var text = pattern.text;
    if (abp.elemhideRegExp.test(text)) {
      pattern.type = "elemhide";

      var domain = RegExp.$1;
      var tagname = RegExp.$2;
      var attrRules = RegExp.$3;
      var selector = RegExp.$4;

      pattern.domain = domain.replace(/^,+/, "").replace(/,+$/, "").replace(/,+/g, ",");

      if (tagname == "*")
        tagname = "";

      if (selector)
        pattern.selector = selector;
      else {
        var id = null;
        var additional = "";
        if (attrRules) {
          attrRules = attrRules.match(/\([\w\-]+(?:[$^*]?=[^\(\)"]*)?\)/g);
          for (var i = 0; i < attrRules.length; i++) {
            var rule = attrRules[i].substr(1, attrRules[i].length - 2);
            var separator = rule.indexOf("=");
            if (separator > 0) {
              rule = rule.replace(/=/, '="') + '"';
              additional += "[" + rule + "]";
            }
            else {
              if (id) {
                // Duplicate id - invalid rule
                id = null;
                tagname = null;
                break;
              }
              else
                id = rule;
            }
          }
        }
  
        if (id)
          pattern.selector = tagname + "." + id + additional + "," + tagname + "#" + id + additional;
        else if (tagname || additional)
          pattern.selector = tagname + additional;
        else
          pattern.type = "invalid";
      }

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
        pattern.pageWhitelist = /^\|?[\w\-]+:\/\//.test(text);
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

  serializePattern: function(buf, pattern) {
    buf.push('[Pattern]');

    buf.push('text=' + pattern.text);
    buf.push('type=' + pattern.type);
    if ("regexpText" in pattern && pattern.regexpText)
      buf.push('regexp=' + pattern.regexpText);
    if ("pageWhitelist" in pattern && pattern.pageWhitelist != null)
      buf.push('pageWhitelist=' + pattern.pageWhitelist);
    if ("shortcut" in pattern)
      buf.push('shortcut=' + pattern.shortcut);
    if ("domain" in pattern)
      buf.push('domain=' + pattern.domain);
    if ("selector" in pattern)
      buf.push('selector=' + pattern.selector);
    buf.push('disabled=' + pattern.disabled);
    if (pattern.hitCount)
      buf.push('hitCount=' + pattern.hitCount);

    buf.push('');
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
    for (var i = 0; i < this.hitListeners.length; i++)
      this.hitListeners[i](pattern);
  },

  resetHitCounts: function(patterns) {
    if (typeof patterns == "undefined" || !patterns)
      patterns = this.knownPatterns.values();
    for (var i = 0; i < patterns.length; i++)
      patterns[i].hitCount = 0;

    // Fire hit count listeners
    for (i = 0; i < this.hitListeners.length; i++)
      this.hitListeners[i](null);
  },

  specialSubscriptions: {
    ' ~il~': ["invalid_description", "invalid"],
    ' ~wl~': ["whitelist_description", "whitelist"],
    ' ~fl~': ["filterlist_description", "filterlist", "comment"],
    ' ~eh~': ["elemhide_description", "elemhide"],
  },

  // Creates a subscription from a data object
  subscriptionFromObject: function(obj) {
    var url = ("url" in obj ? obj.url : null);
    if (!url)
      return null;

    if (this.listedSubscriptions.has(url))
      return null;

    if (" " + url in this.specialSubscriptions)
      return this.subscriptionFromURL(url);
    else {
      var ret = {url: url};
      ret.special = false;
      ret.title = ("title" in obj && obj.title ? obj.title : url);
      ret.autoDownload = !("autoDownload" in obj && obj.autoDownload == "false");
      ret.disabled = ("disabled" in obj && obj.disabled == "true");
      ret.external = ("external" in obj && obj.external == "true");
      ret.lastDownload = parseInt("lastDownload" in obj ? obj.lastDownload : 0) || 0;
      ret.lastSuccess = parseInt("lastSuccess" in obj ? obj.lastSuccess : 0) || 0;
      ret.downloadStatus = ("downloadStatus" in obj ? obj.downloadStatus : "");
      ret.lastModified = ("lastModified" in obj ? obj.lastModified : "");

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

      ret.patterns = [];
    }

    ret.getPatterns = this.getSubscriptionPatterns;
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
            var pattern = this.patternFromText(list[i]);
            if (pattern)
              ret.patterns.push(pattern);
          }
          this.branch.clearUserPref(prefix + "patterns");
        } catch(e) {}
      }
    }

    ret.getPatterns = this.getSubscriptionPatterns;
    this.knownSubscriptions.put(url, ret);
    return ret;
  },

  createExternalSubscription: function(id, title) {
    var ret = {
      url: id,
      special: false,
      title: title,
      autoDownload: true,
      disabled: false,
      external: true,
      lastDownload: 0,
      lastSuccess: 0,
      downloadStatus: "",
      lastModified: "",
      patterns: []
    };

    ret.getPatterns = this.getSubscriptionPatterns;
    this.knownSubscriptions.put(id, ret);
    return ret;
  },

  // nsIAdblockPlusSubscription.getPatterns implementation
  getSubscriptionPatterns: function(length) {
    var ret = [];
    for (var i = 0; i < this.patterns.length; i++)
      ret.push(this.patterns[i].text);
    length.value = ret.length;
    return ret;
  },

  serializeSubscription: function(buf, subscription) {
    buf.push('[Subscription]');

    buf.push('url=' + subscription.url);

    if (!subscription.special) {
      buf.push('title=' + subscription.title);
      buf.push('autoDownload=' + subscription.autoDownload);
      buf.push('disabled=' + subscription.disabled);
      buf.push('external=' + subscription.external);
      if (subscription.lastDownload)
        buf.push('lastDownload=' + subscription.lastDownload);
      if (subscription.lastSuccess)
        buf.push('lastSuccess=' + subscription.lastSuccess);
      if (subscription.downloadStatus)
        buf.push('downloadStatus=' + subscription.downloadStatus);
      if (subscription.lastModified)
        buf.push('lastModified=' + subscription.lastModified);
  
      if (subscription.patterns.length) {
        buf.push('', '[Subscription patterns]');
        for (var i = 0; i < subscription.patterns.length; i++)
          buf.push(subscription.patterns[i].text);
      }
    }

    buf.push('');
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
    this.save();
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
    if (topic == "profile-after-change") {
      this.init();
      this.initialized = true;
    }
    else if (this.initialized && topic == "profile-before-change") {
      this.savePatterns();
      this.initialized = false;
    }
    else if (this.initialized && !this.disableObserver)
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

prefs.addObservers();
abp.prefs = prefs;

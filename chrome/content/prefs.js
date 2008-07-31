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
const gObjtabClass = "abp-objtab-" + Math.random().toString().replace(/\W/g, "");

var prefService = Components.classes["@mozilla.org/preferences-service;1"]
                            .getService(Components.interfaces.nsIPrefService);
var dirService = Components.classes["@mozilla.org/file/directory_service;1"]
                           .getService(Components.interfaces.nsIProperties);

var styleService = Components.classes["@mozilla.org/content/style-sheet-service;1"]
                             .getService(Components.interfaces.nsIStyleSheetService);
var ScriptableInputStream = Components.Constructor("@mozilla.org/scriptableinputstream;1", "nsIScriptableInputStream", "init");

// Matcher class constructor
function Matcher() {
  this.clear();
}

const shortcutLength = 8;
const maxCacheEntries = 10000;

var typeMap = {
  OTHER: 1,
  SCRIPT: 2,
  IMAGE: 4,
  STYLESHEET: 8,
  OBJECT: 16,
  SUBDOCUMENT: 32,
  DOCUMENT: 64,
  BACKGROUND: 256,
  XBL: 512,
  PING: 1024,
  XMLHTTPREQUEST: 2048,
  OBJECT_SUBREQUEST: 4096,
  DTD: 8192
};

Matcher.prototype = {
  // Clears the list
  clear: function() {
    this.patterns = [];
    this.shortcutHash = {__proto__: null};
    this.shortcuts = 0;
    this.regexps = [];
    this.known = {__proto__: null};
    this.resultCache = {__proto__: null};
    this.cacheEntries = 0;
  },

  // Adds a pattern to the list
  add: function(pattern) {
    var key = pattern.regexp;
    if ("contentType" in pattern)
      key += pattern.contentType;

    if (key in this.known)
      return;

    // Look for a suitable shortcut if the current can't be used
    if (!("shortcut" in pattern) || pattern.shortcut in this.shortcutHash) {
      delete pattern.shortcut;
      if (!abp.regexpRegExp.test(pattern.text)) {
        let shortcut = this.findShortcut(pattern.text);
        if (shortcut)
          pattern.shortcut = shortcut;
      }
    }

    if ("shortcut" in pattern) {
      var shortcut = pattern.shortcut;
      this.shortcutHash[shortcut] = pattern;
      this.shortcuts++;
    }
    else 
      this.regexps.push(pattern);

    this.patterns.push(pattern);
    this.known[key] = true;
  },

  findShortcut: function(text) {
    text = text.replace(abp.optionsRegExp, "").toLowerCase();

    var i = parseInt((text.length - shortcutLength) / 2);
    for (var j = i - 1; i <= text.length - shortcutLength || j >= 0; i++, j--) {
      var candidate;
      if (i <= text.length - shortcutLength) {
        candidate = text.substr(i, shortcutLength);
        if (!/[*|@]/.test(candidate) && !(candidate in this.shortcutHash))
          return candidate;
      }
      if (j >= 0) {
        candidate = text.substr(j, shortcutLength);
        if (!/[*|@]/.test(candidate) && !(candidate in this.shortcutHash))
          return candidate;
      }
    }
  },

  matchesAnyInternal: function(location, contentType, thirdParty) {
    if (this.shortcuts > 0) {
      // Optimized matching using shortcuts
      let text = location.toLowerCase();
      let endPos = text.length - shortcutLength + 1;
      for (var i = 0; i <= endPos; i++) {
        let substr = text.substr(i, shortcutLength);
        if (substr in this.shortcutHash)
        {
          let pattern = this.shortcutHash[substr];
          if (pattern.regexp.test(location) &&
              (!("contentType" in pattern) || typeMap[contentType] & pattern.contentType) &&
              (!("thirdParty" in pattern) || pattern.thirdParty == thirdParty))
            return pattern;
        }
      }
    }

    for each (let pattern in this.regexps)
    {
      if (pattern.regexp.test(location) &&
          (!("contentType" in pattern) || typeMap[contentType] & pattern.contentType) &&
          (!("thirdParty" in pattern) || pattern.thirdParty == thirdParty))
        return pattern;
    }

    return null;
  },

  // Tests whether URL matches any of the patterns in the list, returns the matching pattern
  matchesAny: function(location, contentType, thirdParty) {
    var key = location + " " + contentType + " " + thirdParty;
    var result = this.resultCache[key];
    if (typeof result == "undefined") {
      result = this.matchesAnyInternal(location, contentType, thirdParty);

      if (this.cacheEntries >= maxCacheEntries) {
        this.resultCache = {__proto__: null};
        this.cacheEntries = 0;
      }
  
      this.resultCache[key] = result;
      this.cacheEntries++;
    }

    return result;
  }
};

// Element hiding component
var elemhide = {
  patterns: [],
  keys: {},
  url: null,
  seed: Math.random().toFixed(15).substr(5),
  clear: function() {
    this.patterns = [];
    this.unapply();
  },
  add: function(pattern) {
    this.patterns.push(pattern);
    var key;
    do {
      key = Math.random().toFixed(15).substr(5);
    } while (key in this.keys);
    pattern.key = key;
    this.keys[key] = pattern;
  },
  apply: function() {
    this.unapply();

    // Grouping selectors by domains
    var domains = {__proto__: null};
    for each (var pattern in this.patterns) {
      var domain = pattern.domain;
      if (!domain)
        domain = "";

      var list;
      if (domain in domains)
        list = domains[domain];
      else {
        list = {__proto__: null};
        domains[domain] = list;
      }
      list[pattern.selector] = pattern.key;
    }

    // Joining domains list
    var cssData = "";
    var selectorAddition = ":root:not([abpWhitelist" + this.seed + "]) ";   // Addition to prevent selectors match in whitelisted documents
    for (var domain in domains) {
      var rules = [];
      var list = domains[domain];
      for (var selector in list)
      {
        var safeSelector = selectorAddition + selector.match(/(?:[^,"']|"[^"]*"|'[^']*')+/g).join("," + selectorAddition);
        rules.push(safeSelector + "{display:none !important;cursor:url(abp:registerhit?" + list[selector] + "),auto !important;}\n");
      }

      if (domain)
        cssData += '@-moz-document domain("' + domain.split(",").join('"),domain("') + '"){\n' + rules.join('') + '}\n';
      else {
        // Only allow unqualified rules on a few protocols to prevent them from blocking chrome
        cssData += '@-moz-document url-prefix("http://"),url-prefix("https://"),'
                  + 'url-prefix("mailbox://"),url-prefix("imap://"),'
                  + 'url-prefix("news://"),url-prefix("snews://"){\n'
                    + rules.join('')
                  + '}\n';
      }
    }

    // Creating new stylesheet
    if (cssData) {
      try {
        this.url = Components.classes["@mozilla.org/network/simple-uri;1"]
                             .createInstance(Components.interfaces.nsIURI);
        this.url.spec = "data:text/css;charset=utf8,/*** Adblock Plus ***/" + encodeURIComponent("\n" + cssData);
        styleService.loadAndRegisterSheet(this.url, styleService.USER_SHEET);
      } catch(e) {};
    }
  },
  unapply: function() {
    if (this.url) {
      try {
        styleService.unregisterSheet(this.url, styleService.USER_SHEET);
      } catch (e) {}
      this.url = null;
    }
  }
};
abp.elemhideRegExp = /^([^\/\*\|\@"]*?)#(?:([\w\-]+|\*)((?:\([\w\-]+(?:[$^*]?=[^\(\)"]*)?\))*)|#([^{}]+))$/;
abp.regexpRegExp = /^(@@)?\/.*\/(?:\$~?[\w\-]+(?:,~?[\w\-]+)*)?$/;
abp.optionsRegExp = /\$(~?[\w\-]+(?:,~?[\w\-]+)*)$/;

var prefs = {
  initialized: false,
  disableObserver: false,
  branch: prefService.getBranch(prefRoot),
  prefList: [],
  patternsFile: null,
  knownPatterns: {__proto__: null},
  userPatterns: [],
  knownSubscriptions: {__proto__: null},
  listedSubscriptions: {__proto__: null},
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
          styleService.loadAndRegisterSheet(objtabsCSS, styleService.USER_SHEET);
          channel = null;
        },
        QueryInterface: function(iid) {
          if (iid.equals(Components.interfaces.nsISupport) ||
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

    // Load lists from runtime prefs
    var runtimePrefs = this.branch.getChildList("", {});
    for each (var name in runtimePrefs) {
      if (/^(\w+)\./.test(name)) {
        var listName = RegExp.$1;
        var type = this.branch.getPrefType(name);
        var typeName = (type in types ? types[type] : "Char");

        try {
          var value = this.branch["get" + typeName + "Pref"](name);
          if (!(listName in this && this[listName] instanceof Array))
            this[listName] = [];
          this[listName].push(value);
        } catch(e) {}
      }
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
    for each (var pref in this.prefList)
      this.loadPref(pref);

    if (this.enabled)
      this.elemhidePatterns.apply();
    else
      this.elemhidePatterns.unapply();

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

  // Reloads pattern data from the patterns file
  reloadPatterns: function() {
//    var start = new Date().getTime();

    this.knownPatterns = {__proto__: null};
    this.listedSubscriptions = {__proto__: null};
    this.userPatterns = [];
    this.subscriptions = [];

    this.patternsFile = this.getFileByPath(this.patternsfile);
    if (!this.patternsFile && " patternsfile" in this.prefList)
      this.patternsFile = this.getFileByPath(this.prefList[" patternsfile"][2]);  // Try default

    var stream = null;
    if (this.patternsFile) {
      try {
        var fileStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                           .createInstance(Components.interfaces.nsIFileInputStream);
        fileStream.init(this.patternsFile, 0x01, 0444, 0);

        stream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
                           .createInstance(Components.interfaces.nsIConverterInputStream);
        stream.init(fileStream, "UTF-8", 16384, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
        stream = stream.QueryInterface(Components.interfaces.nsIUnicharLineInputStream);
      }
      catch (e) {
        dump("Adblock Plus: Failed to read patterns from file " + this.patternsFile.path + ": " + e + "\n");
        stream = null;
      }
    }

    if (stream) {
      var makeList = {"user patterns": true, "subscription patterns": true};
      var wantList = false;
      var makeObj = {"pattern": true, "subscription": true};
      var wantObj = false;
      var curObj = null;
      var curSection = null;
      var wantProp = false;
      var line = {};
      while (stream.readLine(line) || (line.value = "[end]")) {
        var val = line.value;
        if (wantObj && /^(\w+)=(.*)$/.test(val))
          curObj[RegExp.$1] = RegExp.$2;
        else if (/^\s*\[(.+)\]\s*$/.test(val)) {
          var newSection = RegExp.$1.toLowerCase();
          if (curObj) {
            // Process current object before going to next section
            if (curSection == "pattern")
            {
              prefs.patternFromObject(curObj);
            }
            else if (curSection == "subscription") {
              var subscription = prefs.subscriptionFromObject(curObj);
              if (subscription) {
                prefs.subscriptions.push(subscription);
                prefs.listedSubscriptions[subscription.url] = subscription;
              }
            }
            else if (curSection == "user patterns") {
              for each (var pattern in curObj) {
                pattern = prefs.patternFromText(pattern);
                if (pattern)
                  prefs.userPatterns.push(pattern);
              }
            }
            else if (curSection == "subscription patterns" && prefs.subscriptions.length) {
              subscription = prefs.subscriptions[prefs.subscriptions.length - 1];
              for each (var pattern in curObj) {
                pattern = prefs.patternFromText(pattern);
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
      try {
        var list = this.branch.getCharPref("patterns").split(" ");
        for (var i = 0; i < list.length; i++) {
          if (!(list[i] in this.knownPatterns)) {
            var pattern = this.patternFromText(list[i]);
            if (pattern)
              this.userPatterns.push(pattern);
          }
        }

        this.branch.clearUserPref("patterns");
        prefService.savePrefFile(null);
      } catch(e) {}
      this.disableObserver = false;
    }

    if (this.branch.prefHasUserValue("grouporder")) {
      // Import old subscriptions
      this.disableObserver = true;
      try {
        var list = this.branch.getCharPref("grouporder").split(" ");
        for (var i = 0; i < list.length; i++) {
          if (!(list[i] in this.listedSubscriptions)) {
            var subscription = this.subscriptionFromURL(list[i]);
            if (subscription) {
              this.subscriptions.push(subscription);
              this.listedSubscriptions[subscription.url] = subscription;
            }
          }
        }

        this.branch.clearUserPref("grouporder");
        prefService.savePrefFile(null);
      } catch(e) {}
      this.disableObserver = false;
    }

    // Import settings and patterns from old versions
    if (!stream)
      this.importOldPrefs();

    for each (var specialGroup in ["~il~", "~wl~", "~fl~", "~eh~"]) {
      if (!(specialGroup in this.listedSubscriptions)) {
        var subscription = this.subscriptionFromURL(specialGroup);
        if (subscription) {
          this.subscriptions.push(subscription);
          this.listedSubscriptions[subscription.url] = subscription;
        }
      }
    }

    this.initMatching();

//    dump("Time to load patterns: " + (new Date().getTime() - start) + "\n");
  },

  initMatching: function() {
    this.filterPatterns.clear();
    this.whitePatterns.clear();
    this.whitePatternsPage.clear();
    this.elemhidePatterns.clear();

    for each (var pattern in this.userPatterns)
    {
      pattern.subscription = null;
      this.addPattern(pattern);
    }

    for each (var subscription in this.subscriptions) {
      if (!subscription.disabled)
      {
        for each (var pattern in subscription.patterns)
        {
          pattern.subscription = subscription;
          this.addPattern(pattern);
        }
      }
    }

    if (this.enabled)
      this.elemhidePatterns.apply();
  },

  getFileByPath: function(path) {
    try {
      // Assume an absolute path first
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
//    var start = new Date().getTime();

    if (!this.patternsFile)
      return;

    try {
      this.patternsFile.normalize();
    }
    catch (e) {}

    // Make sure the file's parent directory exists
    try {
      this.patternsFile.parent.create(this.patternsFile.DIRECTORY_TYPE, 0755);
    } catch (e) {}

    var tempFile = this.patternsFile.clone();
    tempFile.leafName += "-temp";
    var stream;
    try {
      var fileStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                             .createInstance(Components.interfaces.nsIFileOutputStream);
      fileStream.init(tempFile, 0x02 | 0x08 | 0x20, 0644, 0);

      stream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
                         .createInstance(Components.interfaces.nsIConverterOutputStream);
      stream.init(fileStream, "UTF-8", 16384, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
    }
    catch (e) {
      dump("Adblock Plus: failed create file " + tempFile.path + ": " + e + "\n");
      return;
    }

    const maxBufLength = 1024;
    var buf = ["# Adblock Plus preferences", ""];
    var lineBreak = abp.getLineBreak();
    function writeBuffer() {
      try {
        stream.writeString(buf.join(lineBreak) + lineBreak);
        buf = [];
        return true;
      }
      catch (e) {
        stream.close();
        dump("Adblock Plus: failed to write to file " + tempFile.path + ": " + e + "\n");
        try {
          tempFile.remove(false);
        }
        catch (e2) {}
        return false;
      }
    }

    var saved = {__proto__: null};

    // Save pattern data
    for each (var pattern in this.userPatterns) {
      if (!(pattern.text in saved)) {
        this.serializePattern(buf, pattern);
        saved[pattern.text] = pattern;

        if (buf.length > maxBufLength && !writeBuffer())
          return;
      }
    }

    for each (var subscription in this.subscriptions) {
      for each (var pattern in subscription.patterns) {
        if (!(pattern.text in saved)) {
          this.serializePattern(buf, pattern);
          saved[pattern.text] = pattern;

          if (buf.length > maxBufLength && !writeBuffer())
            return;
        }
      }
    }

    // Save user patterns list
    buf.push("[User patterns]");
    for each (var pattern in this.userPatterns)
      buf.push(pattern.text);
    buf.push("");
    if (buf.length > maxBufLength && !writeBuffer())
      return;

    // Save subscriptions list
    for each (var subscription in this.subscriptions)
    {
      this.serializeSubscription(buf, subscription);

      if (buf.length > maxBufLength && !writeBuffer())
        return;
    }

    try {
      stream.writeString(buf.join(lineBreak) + lineBreak);
      stream.close();
    }
    catch (e) {
      dump("Adblock Plus: failed to close file " + tempFile.path + ": " + e + "\n");
      try {
        tempFile.remove(false);
      }
      catch (e2) {}
      return false;
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
        for (var i = this.patternsbackups - 1; i >= 0; i--) {
          backupFile.leafName = part1 + (i > 0 ? "-backup" + i : "") + part2;
          try {
            backupFile.moveTo(backupFile.parent, part1 + "-backup" + (i+1) + part2);
          } catch (e) {}
        }
      }
    }

    tempFile.moveTo(this.patternsFile.parent, this.patternsFile.leafName);

//    dump("Time to save patterns: " + (new Date().getTime() - start) + "\n");
  },

  // Creates a pattern from a data object
  patternFromObject: function(obj) {
    var text = ("text" in obj ? obj.text : null);
    if (!text)
      return null;

    if (text in this.knownPatterns)
      return this.knownPatterns[text];

    var ret = {text: text};

    ret.type = ("type" in obj ? obj.type : null);
    ret.regexpText = ("regexp" in obj ? obj.regexp : null);
    ret.pageWhitelist = ("pageWhitelist" in obj ? obj.pageWhitelist == "true" : null);
    if (ret.type == "elemhide") {
      ret.domain = ("domain" in obj ? obj.domain : null);
      ret.selector = ("selector" in obj ? obj.selector : null);
    }
    if ("contentType" in obj)
      ret.contentType = parseInt(obj.contentType) || 0;
    if ("matchCase" in obj && obj.matchCase == "true")
      ret.matchCase = true;
    if ("thirdParty" in obj)
      ret.thirdParty = (obj.thirdParty == "true");
    if (ret.type == null || ret.type == "invalid" ||
        ((ret.type == "whitelist" || ret.type == "filterlist") && ret.regexpText == null) ||
        (ret.type == "whitelist" && ret.pageWhitelist == null) ||
        (ret.type == "elemhide" && (ret.domain == null || ret.selector == null))
       )
      this.initPattern(ret);
    else if (ret.type == "whitelist" || ret.type == "filterlist")
      this.initRegexp(ret);

    if ("shortcut" in obj)
      ret.shortcut = obj.shortcut;
    ret.disabled = ("disabled" in obj && obj.disabled == "true");
    ret.hitCount = ("hitCount" in obj ? parseInt(obj.hitCount) : 0) || 0;
    ret.lastHit = ("lastHit" in obj ? parseInt(obj.lastHit) : 0) || 0;

    this.knownPatterns[text] = ret;
    return ret;
  },

  // Creates a pattern from pattern text
  patternFromText: function(text) {
    if (!/\S/.test(text))
      return null;

    if (text in this.knownPatterns)
      return this.knownPatterns[text];

    var ret = {text: text};
    this.initPattern(ret);

    ret.disabled = false;
    ret.hitCount = 0;
    ret.lastHit = 0;

    this.knownPatterns[text] = ret;
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
    }
    else if (text.indexOf("!") == 0)
      pattern.type = "comment";
    else {
      pattern.type = "filterlist"
      if (text.indexOf("@@") == 0) {
        pattern.type = "whitelist";
        text = text.substr(2);
        pattern.pageWhitelist = /^\|?[\w\-]+:/.test(text);
      }

      if (abp.optionsRegExp.test(text)) {
        // Pattern has options
        var options = RegExp.$1.replace(/-/g, "_").toUpperCase().split(",");
        text = text.replace(abp.optionsRegExp, '');

        for each (var option in options) {
          if (option in typeMap) {
            if (!("contentType" in pattern))
              pattern.contentType = 0;
            pattern.contentType |= typeMap[option];
          }
          else if (/^~(.*)/.test(option) && RegExp.$1 in typeMap) {
            if (!("contentType" in pattern))
              pattern.contentType = 0xFFFFFFFF;
            pattern.contentType &= ~typeMap[RegExp.$1];
          }
          else if (option == "MATCH_CASE")
            pattern.matchCase = true;
          else if (option == "THIRD_PARTY")
            pattern.thirdParty = true;
          else if (option == "~THIRD_PARTY")
            pattern.thirdParty = false;
          else if (option == "COLLAPSE")
            pattern.collapse = true;
          else if (option == "~COLLAPSE")
            pattern.collapse = false;
        }
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
        pattern.regexp = new RegExp(pattern.regexpText, "matchCase" in pattern ? "" : "i");
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
    if ("contentType" in pattern)
      buf.push('contentType=' + pattern.contentType);
    if ("matchCase" in pattern)
      buf.push('matchCase=true');
    if ("thirdParty" in pattern)
      buf.push('thirdParty=' + pattern.thirdParty);
    buf.push('disabled=' + pattern.disabled);
    if (pattern.hitCount)
      buf.push('hitCount=' + pattern.hitCount);
    if (pattern.lastHit)
      buf.push('lastHit=' + pattern.lastHit);

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
    if (!this.savestats)
      return;

    pattern.hitCount++;
    pattern.lastHit = new Date().getTime();

    // Fire hit count listeners
    for each (var listener in this.hitListeners)
      listener(pattern);
  },

  resetHitCounts: function(patterns) {
    if (typeof patterns == "undefined" || !patterns) {
      for each (var pattern in this.knownPatterns) {
        pattern.hitCount = 0;
        pattern.lastHit = 0;
      }
    }
    else {
      for each (var pattern in patterns) {
        pattern.hitCount = 0;
        pattern.lastHit = 0;
      }
    }

    // Fire hit count listeners
    for each (var listener in this.hitListeners)
      listener(null);
  },

  specialSubscriptions: {
    ' ~il~': ["invalid_description", "invalid"],
    ' ~wl~': ["whitelist_description", "whitelist"],
    ' ~fl~': ["filterlist_description", "filterlist", "comment"],
    ' ~eh~': ["elemhide_description", "elemhide"]
  },

  // Creates a subscription from a data object
  subscriptionFromObject: function(obj) {
    var url = ("url" in obj ? obj.url : null);
    if (!url)
      return null;

    if (url in this.listedSubscriptions)
      return null;

    if (" " + url in this.specialSubscriptions)
      return this.subscriptionFromURL(url);
    else {
      var ret = {url: url};
      ret.special = false;
      ret.nextURL = ("nextURL" in obj && obj.nextURL ? obj.nextURL : null);
      ret.title = ("title" in obj && obj.title ? obj.title : url);
      ret.autoDownload = !("autoDownload" in obj && obj.autoDownload == "false");
      ret.disabled = ("disabled" in obj && obj.disabled == "true");
      ret.external = ("external" in obj && obj.external == "true");
      ret.lastDownload = parseInt("lastDownload" in obj ? obj.lastDownload : 0) || 0;
      ret.downloadStatus = ("downloadStatus" in obj ? obj.downloadStatus : "");
      ret.lastModified = ("lastModified" in obj ? obj.lastModified : "");
      ret.expires = parseInt("expires" in obj ? obj.expires : 0) || 0;
      ret.errors = parseInt("errors" in obj ? obj.errors : 0) || 0;
      if ("requiredVersion" in obj) {
        ret.requiredVersion = obj.requiredVersion;
        if (abp.versionComparator.compare(ret.requiredVersion, abp.getInstalledVersion()) > 0)
          ret.upgradeRequired = true;
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

      ret.patterns = [];
    }

    ret.getPatterns = this.getSubscriptionPatterns;
    this.knownSubscriptions[url] = ret;
    return ret;
  },

  subscriptionFromURL: function(url) {
    if (url in this.listedSubscriptions)
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
        nextURL: null,
        title: url,
        autoDownload: true,
        disabled: false,
        external: false,
        lastDownload: 0,
        downloadStatus: "",
        lastModified: "",
        expires: 0,
        errors: 0,
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
    this.knownSubscriptions[url] = ret;
    return ret;
  },

  createExternalSubscription: function(id, title) {
    var ret = {
      url: id,
      special: false,
      nextURL: null,
      title: title,
      autoDownload: true,
      disabled: false,
      external: true,
      lastDownload: 0,
      downloadStatus: "",
      lastModified: "",
      expires: 0,
      errors: 0,
      patterns: []
    };

    ret.getPatterns = this.getSubscriptionPatterns;
    this.knownSubscriptions[id] = ret;
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
      if (subscription.nextURL)
        buf.push('nextURL=' + subscription.nextURL);
      buf.push('title=' + subscription.title);
      buf.push('autoDownload=' + subscription.autoDownload);
      buf.push('disabled=' + subscription.disabled);
      buf.push('external=' + subscription.external);
      if (subscription.lastDownload)
        buf.push('lastDownload=' + subscription.lastDownload);
      if (subscription.downloadStatus)
        buf.push('downloadStatus=' + subscription.downloadStatus);
      if (subscription.lastModified)
        buf.push('lastModified=' + subscription.lastModified);
      if (subscription.expires)
        buf.push('expires=' + subscription.expires);
      if (subscription.errors)
        buf.push('errors=' + subscription.errors)
      if (subscription.requiredVersion)
        buf.push('requiredVersion=' + subscription.requiredVersion);
  
      if (subscription.patterns.length) {
        buf.push("", "[Subscription patterns]");
        for each (var pattern in subscription.patterns)
          buf.push(pattern.text);
      }
    }

    buf.push('');
  },

  importOldPrefs: function() {
    var importBranch = prefService.getBranch("adblock.");
    var i, j, list;

    for (i = 0; i < this.prefList.length; i++) {
      if (this.prefList[i][1] == "Bool") {
        var prefName = this.prefList[i][0];
        try {
          if (importBranch.prefHasUserValue(prefName) && !this.branch.prefHasUserValue(prefName))
            this[prefName] = importBranch.getBoolPref(prefName);
        } catch (e) {}
      }
    }
    this.save();

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

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
 * @fileOverview FilterStorage class responsible to managing user's subscriptions and filters.
 */

var EXPORTED_SYMBOLS = ["FilterStorage"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
Cu.import(baseURL.spec + "TimeLine.jsm");

/**
 * Version number of the filter storage file format.
 * @type Integer
 */
const formatVersion = 3;

/**
 * File that the filter list has been loaded from and should be saved to
 * @type nsIFile
 */
let sourceFile = null;

/**
 * List of observers for subscription changes (addition, deletion)
 * @type Array of function(String, Array of Subscription)
 */
let subscriptionObservers = [];

/**
 * List of observers for filter changes (addition, deletion)
 * @type Array of function(String, Array of Filter)
 */
let filterObservers = [];

/**
 * This class reads user's filters from disk, manages them in memory and writes them back.
 * @class
 */
var FilterStorage =
{
  /**
   * Map of properties listed in the filter storage file before the sections
   * start. Right now this should be only the format version.
   */
  fileProperties: {__proto__: null},

  /**
   * List of filter subscriptions containing all filters
   * @type Array of Subscription
   */
  subscriptions: [],

  /**
   * Map of subscriptions already on the list, by their URL/identifier
   * @type Object
   */
  knownSubscriptions: {__proto__: null},

  /**
   * Called on module startup.
   */
  startup: function()
  {
    TimeLine.enter("Entered FilterStorage.startup()");
    FilterStorage.loadFromDisk();
    Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService)
                                         .addObserver(FilterStoragePrivate, "browser:purge-session-history", true);
    TimeLine.leave("FilterStorage.startup() done");
  },

  /**
   * Called on module shutdown.
   */
  shutdown: function()
  {
    TimeLine.enter("Entered FilterStorage.shutdown()");
    FilterStorage.saveToDisk();
    TimeLine.leave("FilterStorage.shutdown() done");
  },

  /**
   * Adds an observer for subscription changes (addition, deletion)
   * @param {function(String, Array of Subscription)} observer
   */
  addSubscriptionObserver: function(observer)
  {
    if (subscriptionObservers.indexOf(observer) >= 0)
      return;

    subscriptionObservers.push(observer);
  },

  /**
   * Removes a subscription observer previosly added with addSubscriptionObserver
   * @param {function(String, Array of Subscription)} observer
   */
  removeSubscriptionObserver: function(observer)
  {
    let index = subscriptionObservers.indexOf(observer);
    if (index >= 0)
      subscriptionObservers.splice(index, 1);
  },

  /**
   * Calls subscription observers after a change
   * @param {String} action change code ("add", "remove", "enable", "disable", "update", "updateinfo", "reload")
   * @param {Array of Subscription} subscriptions subscriptions the change applies to
   */
  triggerSubscriptionObservers: function(action, subscriptions)
  {
    for each (let observer in subscriptionObservers)
      observer(action, subscriptions);
  },

  /**
   * Calls filter observers after a change
   * @param {String} action change code ("add", "remove", "enable", "disable", "hit")
   * @param {Array of Filter} filters the change applies to
   * @param additionalData optional additional data, depends on change code
   */
  triggerFilterObservers: function(action, filters, additionalData)
  {
    for each (let observer in filterObservers)
      observer(action, filters, additionalData);
  },

  /**
   * Adds an observer for filter changes (addition, deletion)
   * @param {function(String, Array of Filter)} observer
   */
  addFilterObserver: function(observer)
  {
    if (filterObservers.indexOf(observer) >= 0)
      return;

    filterObservers.push(observer);
  },

  /**
   * Removes a filter observer previosly added with addFilterObserver
   * @param {function(String, Array of Filter)} observer
   */
  removeFilterObserver: function(observer)
  {
    let index = filterObservers.indexOf(observer);
    if (index >= 0)
      filterObservers.splice(index, 1);
  },

  /**
   * Adds a filter subscription to the list
   * @param {Subscription} subscription filter subscription to be added
   * @param {Boolean} silent  if true, no observers will be triggered (to be used when filter list is reloaded)
   */
  addSubscription: function(subscription, silent)
  {
    if (subscription.url in FilterStorage.knownSubscriptions)
      return;

    FilterStorage.subscriptions.push(subscription);
    FilterStorage.knownSubscriptions[subscription.url] = subscription;
    addSubscriptionFilters(subscription);

    if (!silent)
      FilterStorage.triggerSubscriptionObservers("add", [subscription]);
  },

  /**
   * Removes a filter subscription from the list
   * @param {Subscription} subscription filter subscription to be removed
   * @param {Boolean} silent  if true, no observers will be triggered (to be used when filter list is reloaded)
   */
  removeSubscription: function(subscription, silent)
  {
    for (let i = 0; i < FilterStorage.subscriptions.length; i++)
    {
      if (FilterStorage.subscriptions[i].url == subscription.url)
      {
        removeSubscriptionFilters(subscription);

        FilterStorage.subscriptions.splice(i--, 1);
        delete FilterStorage.knownSubscriptions[subscription.url];
        if (!silent)
          FilterStorage.triggerSubscriptionObservers("remove", [subscription]);
        return;
      }
    }
  },

  /**
   * Replaces the list of filters in a subscription by a new list
   * @param {Subscription} subscription filter subscription to be updated
   * @param {Array of Filter} filters new filter lsit
   */
  updateSubscriptionFilters: function(subscription, filters)
  {
    removeSubscriptionFilters(subscription);
    subscription.oldFilters = subscription.filters;
    subscription.filters = filters;
    addSubscriptionFilters(subscription);
    FilterStorage.triggerSubscriptionObservers("update", [subscription]);
    delete subscription.oldFilters;

    // Do not keep empty subscriptions disabled
    if (subscription instanceof SpecialSubscription && !subscription.filters.length && subscription.disabled)
    {
      subscription.disabled = false;
      FilterStorage.triggerSubscriptionObservers("enable", [subscription]);
    }
  },

  /**
   * Adds a user-defined filter to the list
   * @param {Filter} filter
   * @param {Filter} insertBefore   filter to insert before (if possible)
   * @param {Boolean} silent  if true, no observers will be triggered (to be used when filter list is reloaded)
   */
  addFilter: function(filter, insertBefore, silent)
  {
    let subscription = null;
    if (!subscription)
    {
      for each (let s in FilterStorage.subscriptions)
      {
        if (s instanceof SpecialSubscription && s.isFilterAllowed(filter))
        {
          if (s.filters.indexOf(filter) >= 0)
            return;

          if (!subscription || s.priority > subscription.priority)
            subscription = s;
        }
      }
    }

    if (!subscription)
      return;

    let insertIndex = -1;
    if (insertBefore)
      insertIndex = subscription.filters.indexOf(insertBefore);

    filter.subscriptions.push(subscription);
    if (insertIndex >= 0)
      subscription.filters.splice(insertIndex, 0, filter);
    else
      subscription.filters.push(filter);
    if (!silent)
      FilterStorage.triggerFilterObservers("add", [filter], insertBefore);
  },

  /**
   * Removes a user-defined filter from the list
   * @param {Filter} filter
   * @param {Boolean} silent  if true, no observers will be triggered (to be used when filter list is reloaded)
   */
  removeFilter: function(filter, silent)
  {
    for (let i = 0; i < filter.subscriptions.length; i++)
    {
      let subscription = filter.subscriptions[i];
      if (subscription instanceof SpecialSubscription)
      {
        for (let j = 0; j < subscription.filters.length; j++)
        {
          if (subscription.filters[j].text == filter.text)
          {
            filter.subscriptions.splice(i, 1);
            subscription.filters.splice(j, 1);
            if (!silent)
              FilterStorage.triggerFilterObservers("remove", [filter]);

            // Do not keep empty subscriptions disabled
            if (!subscription.filters.length && subscription.disabled)
            {
              subscription.disabled = false;
              if (!silent)
                FilterStorage.triggerSubscriptionObservers("enable", [subscription]);
            }
            return;
          }
        }
      }
    }
  },

  /**
   * Increases the hit count for a filter by one
   * @param {Filter} filter
   */
  increaseHitCount: function(filter)
  {
    if (!Prefs.savestats || Prefs.privateBrowsing || !(filter instanceof ActiveFilter))
      return;

    filter.hitCount++;
    filter.lastHit = Date.now();
    FilterStorage.triggerFilterObservers("hit", [filter]);
  },

  /**
   * Resets hit count for some filters
   * @param {Array of Filter} filters  filters to be reset, if null all filters will be reset
   */
  resetHitCounts: function(filters)
  {
    if (!filters)
    {
      filters = [];
      for each (let filter in Filter.knownFilters)
        filters.push(filter);
    }
    for each (let filter in filters)
    {
      filter.hitCount = 0;
      filter.lastHit = 0;
    }
    FilterStorage.triggerFilterObservers("hit", filters);
  },

  /**
   * Loads all subscriptions from the disk
   */
  loadFromDisk: function()
  {
    TimeLine.enter("Entered FilterStorage.loadFromDisk()");

    FilterStorage.subscriptions = [];
    FilterStorage.knownSubscriptions = {__proto__: null};

    function getFileByPath(path)
    {
      if (!path)
        return null;

      try {
        // Assume an absolute path first
        let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
        file.initWithPath(path);
        return file;
      } catch (e) {}

      try {
        // Try relative path now
        let profileDir = Utils.dirService.get("ProfD", Ci.nsIFile);
        let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
        file.setRelativeDescriptor(profileDir, path);
        return file;
      } catch (e) {}

      return null;
    }

    sourceFile = getFileByPath(Prefs.patternsfile);
    if (!sourceFile)
    {
      try
      {
        sourceFile = getFileByPath(Prefs.getDefaultBranch.getCharPref("patternsfile"));
      } catch(e) {}
    }

    if (!sourceFile)
      dump("Adblock Plus: Failed to resolve filter file location from extensions.adblockplus.patternsfile preference\n");

    TimeLine.log("done locating patterns.ini file");

    let realSourceFile = sourceFile;
    if (!realSourceFile || !realSourceFile.exists())
    {
      // patterns.ini doesn't exist - but maybe we have a default one?
      let patternsURL = Utils.ioService.newURI("chrome://adblockplus-defaults/content/patterns.ini", null, null);
      patternsURL = Utils.chromeRegistry.convertChromeURL(patternsURL);
      if (patternsURL instanceof Ci.nsIFileURL)
        realSourceFile = patternsURL.file;
    }

    let stream = null;
    try
    {
      if (realSourceFile && realSourceFile.exists())
      {
        let fileStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
        fileStream.init(realSourceFile, 0x01, 0444, 0);

        stream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
        stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
        stream = stream.QueryInterface(Ci.nsIUnicharLineInputStream);
      }
    }
    catch (e)
    {
      dump("Adblock Plus: Failed to read filters from file " + realSourceFile.path + ": " + e + "\n");
      stream = null;
    }

    let userFilters = null;
    if (stream)
    {
      userFilters = parseIniFile(stream);

      stream.close();
    }

    TimeLine.log("done parsing file");

    // Add missing special subscriptions if necessary
    for each (let specialSubscription in ["~il~", "~wl~", "~fl~", "~eh~"])
    {
      if (!(specialSubscription in FilterStorage.knownSubscriptions))
      {
        let subscription = Subscription.fromURL(specialSubscription);
        if (subscription)
          FilterStorage.addSubscription(subscription, true);
      }
    }

    if (userFilters)
    {
      for each (let filter in userFilters)
      {
        filter = Filter.fromText(filter);
        if (filter)
          FilterStorage.addFilter(filter, null, true);
      }
    }

    TimeLine.log("load complete, calling observers");
    FilterStorage.triggerSubscriptionObservers("reload", FilterStorage.subscriptions);
    TimeLine.leave("FilterStorage.loadFromDisk() done");
  },

  /**
   * Saves all subscriptions back to disk
   */
  saveToDisk: function()
  {
    if (!sourceFile)
      return;

    TimeLine.enter("Entered FilterStorage.saveToDisk()");

    try {
      sourceFile.normalize();
    } catch (e) {}

    // Make sure the file's parent directory exists
    try {
      sourceFile.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0755);
    } catch (e) {}

    let tempFile = sourceFile.clone();
    tempFile.leafName += "-temp";
    let stream;
    try {
      let fileStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      fileStream.init(tempFile, 0x02 | 0x08 | 0x20, 0644, 0);

      stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
      stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
    }
    catch (e) {
      dump("Adblock Plus: failed to create file " + tempFile.path + ": " + e + "\n");
      return;
    }

    TimeLine.log("created temp file");

    const maxBufLength = 1024;
    let buf = ["# Adblock Plus preferences", "version=" + formatVersion];
    let lineBreak = Utils.getLineBreak();
    function writeBuffer()
    {
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

    let saved = {__proto__: null};

    // Save filter data
    for each (let subscription in FilterStorage.subscriptions)
    {
      // Do not persist external subscriptions
      if (subscription instanceof ExternalSubscription)
        continue;

      for each (let filter in subscription.filters)
      {
        if (!(filter.text in saved))
        {
          filter.serialize(buf);
          saved[filter.text] = filter;

          if (buf.length > maxBufLength && !writeBuffer())
            return;
        }
      }
    }
    TimeLine.log("saved filter data");

    // Save subscriptions
    for each (let subscription in FilterStorage.subscriptions)
    {
      // Do not persist external subscriptions
      if (subscription instanceof ExternalSubscription)
        continue;

      buf.push("");
      subscription.serialize(buf);
      if (subscription.filters.length)
      {
        buf.push("", "[Subscription filters]")
        subscription.serializeFilters(buf);
      }

      if (buf.length > maxBufLength && !writeBuffer())
        return;
    }
    TimeLine.log("saved subscription data");

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
      return;
    }
    TimeLine.log("finalized file write");

    if (sourceFile.exists()) {
      // Check whether we need to backup the file
      let part1 = sourceFile.leafName;
      let part2 = "";
      if (/^(.*)(\.\w+)$/.test(part1))
      {
        part1 = RegExp.$1;
        part2 = RegExp.$2;
      }

      let doBackup = (Prefs.patternsbackups > 0);
      if (doBackup)
      {
        let lastBackup = sourceFile.clone();
        lastBackup.leafName = part1 + "-backup1" + part2;
        if (lastBackup.exists() && (Date.now() - lastBackup.lastModifiedTime) / 3600000 < Prefs.patternsbackupinterval)
          doBackup = false;
      }

      if (doBackup)
      {
        let backupFile = sourceFile.clone();
        backupFile.leafName = part1 + "-backup" + Prefs.patternsbackups + part2;

        // Remove oldest backup
        try {
          backupFile.remove(false);
        } catch (e) {}

        // Rename backup files
        for (let i = Prefs.patternsbackups - 1; i >= 0; i--) {
          backupFile.leafName = part1 + (i > 0 ? "-backup" + i : "") + part2;
          try {
            backupFile.moveTo(backupFile.parent, part1 + "-backup" + (i+1) + part2);
          } catch (e) {}
        }
      }
    }

    tempFile.moveTo(sourceFile.parent, sourceFile.leafName);
    TimeLine.log("created backups and renamed temp file");
    TimeLine.leave("FilterStorage.saveToDisk() done");
  }
};

/**
 * Private nsIObserver implementation.
 * @class
 */
var FilterStoragePrivate =
{
  observe: function(subject, topic, data)
  {
    if (topic == "browser:purge-session-history" && Prefs.clearStatsOnHistoryPurge)
    {
      FilterStorage.resetHitCounts();
      FilterStorage.saveToDisk();
    }
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
};

/**
 * Joins subscription's filters to the subscription without any notifications.
 * @param {Subscription} subscription filter subscription that should be connected to its filters
 */
function addSubscriptionFilters(subscription)
{
  if (!(subscription.url in FilterStorage.knownSubscriptions))
    return;

  for each (let filter in subscription.filters)
    filter.subscriptions.push(subscription);
}

/**
 * Removes subscription's filters from the subscription without any notifications.
 * @param {Subscription} subscription filter subscription to be removed
 */
function removeSubscriptionFilters(subscription)
{
  if (!(subscription.url in FilterStorage.knownSubscriptions))
    return;

  for each (let filter in subscription.filters)
  {
    let i = filter.subscriptions.indexOf(subscription);
    if (i >= 0)
      filter.subscriptions.splice(i, 1);
  }
}

/**
 * Parses filter data from a stream. If the data contains user filters outside of filter
 * groups (Adblock Plus 0.7.x data) these filters are returned - they need to be added
 * separately.
 */
function parseIniFile(/**nsIUnicharLineInputStream*/ stream) /**Array of String*/
{
  let wantObj = true;
  FilterStorage.fileProperties = {};
  let curObj = FilterStorage.fileProperties;
  let curSection = null;
  let line = {};
  let haveMore = true;
  let userFilters = null;
  while (true)
  {
    if (haveMore)
      haveMore = stream.readLine(line);
    else
      line.value = "[end]";

    let val = line.value;
    if (wantObj === true && /^(\w+)=(.*)$/.test(val))
      curObj[RegExp.$1] = RegExp.$2;
    else if (/^\s*\[(.+)\]\s*$/.test(val))
    {
      let newSection = RegExp.$1.toLowerCase();
      if (curObj)
      {
        // Process current object before going to next section
        switch (curSection)
        {
          case "filter":
          case "pattern":
            if ("text" in curObj)
              Filter.fromObject(curObj);
            break;
          case "subscription":
            let subscription = Subscription.fromObject(curObj);
            if (subscription)
              FilterStorage.addSubscription(subscription, true);
            break;
          case "subscription filters":
          case "subscription patterns":
            if (FilterStorage.subscriptions.length)
            {
              let subscription = FilterStorage.subscriptions[FilterStorage.subscriptions.length - 1];
              for each (let text in curObj)
              {
                let filter = Filter.fromText(text);
                if (filter)
                {
                  subscription.filters.push(filter);
                  filter.subscriptions.push(subscription);
                }
              }
            }
            break;
          case "user patterns":
            userFilters = curObj;
            break;
        }
      }

      if (newSection == 'end')
        break;

      curSection = newSection;
      switch (curSection)
      {
        case "filter":
        case "pattern":
        case "subscription":
          wantObj = true;
          curObj = {};
          break;
        case "subscription filters":
        case "subscription patterns":
        case "user patterns":
          wantObj = false;
          curObj = [];
          break;
        default:
          wantObj = undefined;
          curObj = null;
      }
    }
    else if (wantObj === false && val)
      curObj.push(val.replace(/\\\[/g, "["));
  }
  return userFilters;
}

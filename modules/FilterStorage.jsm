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
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
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

Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
Cu.import(baseURL.spec + "FilterNotifier.jsm");
Cu.import(baseURL.spec + "TimeLine.jsm");

/**
 * Version number of the filter storage file format.
 * @type Integer
 */
const formatVersion = 4;

/**
 * This class reads user's filters from disk, manages them in memory and writes them back.
 * @class
 */
var FilterStorage =
{
  /**
   * File that the filter list has been loaded from and should be saved to
   * @type nsIFile
   */
  get sourceFile()
  {
    let file = null;
    if (Prefs.patternsfile)
    {
      // Override in place, use it instead of placing the file in the regular data dir
      file = Utils.resolveFilePath(Prefs.patternsfile);
    }
    if (!file)
    {
      // Place the file in the data dir
      file = Utils.resolveFilePath(Prefs.data_directory);
      if (file)
        file.append("patterns.ini");
    }
    if (!file)
    {
      // Data directory pref misconfigured? Try the default value
      try
      {
        file = Utils.resolveFilePath(Prefs.defaultBranch.getCharPref("data_directory"));
        if (file)
          FilterStorage.sourceFile.append("patterns.ini");
      } catch(e) {}
    }

    if (!file)
      Cu.reportError("Adblock Plus: Failed to resolve filter file location from extensions.adblockplus.patternsfile preference");

    this.__defineGetter__("sourceFile", function() file);
    return this.sourceFile;
  },

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
   * Finds the filter group that a filter should be added to by default. Will
   * return null if this group doesn't exist yet.
   */
  getGroupForFilter: function(/**Filter*/ filter) /**SpecialSubscription*/
  {
    for each (let subscription in FilterStorage.subscriptions)
      if (subscription instanceof SpecialSubscription && subscription.isDefaultFor(filter))
        return subscription;
    return null;
  },

  /**
   * Adds a filter subscription to the list
   * @param {Subscription} subscription filter subscription to be added
   * @param {Boolean} silent  if true, no listeners will be triggered (to be used when filter list is reloaded)
   */
  addSubscription: function(subscription, silent)
  {
    if (subscription.url in FilterStorage.knownSubscriptions)
      return;

    FilterStorage.subscriptions.push(subscription);
    FilterStorage.knownSubscriptions[subscription.url] = subscription;
    addSubscriptionFilters(subscription);

    if (!silent)
      FilterNotifier.triggerListeners("subscription.add", subscription);
  },

  /**
   * Removes a filter subscription from the list
   * @param {Subscription} subscription filter subscription to be removed
   * @param {Boolean} silent  if true, no listeners will be triggered (to be used when filter list is reloaded)
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
          FilterNotifier.triggerListeners("subscription.remove", subscription);
        return;
      }
    }
  },

  /**
   * Moves a subscription in the list to a new position.
   * @param {Subscription} subscription filter subscription to be moved
   * @param {Subscription} [insertBefore] filter subscription to insert before
   *        (if omitted the subscription will be put at the end of the list)
   */
  moveSubscription: function(subscription, insertBefore)
  {
    let currentPos = FilterStorage.subscriptions.indexOf(subscription);
    if (currentPos < 0)
      return;

    let newPos = insertBefore ? FilterStorage.subscriptions.indexOf(insertBefore) : -1;
    if (newPos < 0)
      newPos = FilterStorage.subscriptions.length;

    if (currentPos < newPos)
      newPos--;
    if (currentPos == newPos)
      return;

    FilterStorage.subscriptions.splice(currentPos, 1);
    FilterStorage.subscriptions.splice(newPos, 0, subscription);
    FilterNotifier.triggerListeners("subscription.move", subscription);
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
    FilterNotifier.triggerListeners("subscription.update", subscription);
    delete subscription.oldFilters;

    // Do not keep empty subscriptions disabled
    if (subscription instanceof SpecialSubscription && !subscription.filters.length && subscription.disabled)
      subscription.disabled = false;
  },

  /**
   * Adds a user-defined filter to the list
   * @param {Filter} filter
   * @param {Filter} insertBefore   filter to insert before (if possible)
   * @param {Boolean} silent  if true, no listeners will be triggered (to be used when filter list is reloaded)
   */
  addFilter: function(filter, insertBefore, silent)
  {
    let subscription = FilterStorage.getGroupForFilter(filter);
    if (!subscription)
    {
      // No group for this filter exists, create one
      subscription = SpecialSubscription.createForFilter(filter);
      this.addSubscription(subscription);
      return;
    }

    let insertIndex = -1;
    if (insertBefore)
      insertIndex = subscription.filters.indexOf(insertBefore);

    filter.subscriptions.push(subscription);
    if (insertIndex >= 0)
      subscription.filters.splice(insertIndex, 0, filter);
    else
      subscription.filters.push(filter);
    if (!silent)
      FilterNotifier.triggerListeners("filter.add", filter, insertBefore);
  },

  /**
   * Removes a user-defined filter from the list
   * @param {Filter} filter
   */
  removeFilter: function(filter)
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
            FilterNotifier.triggerListeners("filter.remove", filter);

            // Do not keep empty subscriptions disabled
            if (!subscription.filters.length && subscription.disabled)
              subscription.disabled = false;
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
  },

  /**
   * Loads all subscriptions from the disk
   * @param {Boolean} silent  if true, no listeners will be triggered (to be used when data is already initialized)
   */
  loadFromDisk: function(silent)
  {
    TimeLine.enter("Entered FilterStorage.loadFromDisk()");

    let realSourceFile = FilterStorage.sourceFile;
    if (!realSourceFile || !realSourceFile.exists())
    {
      // patterns.ini doesn't exist - but maybe we have a default one?
      let patternsURL = Utils.ioService.newURI("chrome://adblockplus-defaults/content/patterns.ini", null, null);
      patternsURL = Utils.chromeRegistry.convertChromeURL(patternsURL);
      if (patternsURL instanceof Ci.nsIFileURL)
        realSourceFile = patternsURL.file;
    }

    let userFilters = null;
    let backup = 0;
    while (true)
    {
      FilterStorage.subscriptions = [];
      FilterStorage.knownSubscriptions = {__proto__: null};

      try
      {
        if (realSourceFile && realSourceFile.exists())
        {
          let fileStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
          fileStream.init(realSourceFile, 0x01, 0444, 0);

          let stream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
          stream.init(fileStream, "UTF-8", 16384, 0);
          stream = stream.QueryInterface(Ci.nsIUnicharLineInputStream);

          userFilters = parseIniFile(stream);
          stream.close();

          if (!FilterStorage.subscriptions.length)
          {
            // No filter subscriptions in the file, this isn't right.
            throw "No data in the file";
          }
        }

        // We either successfully loaded filters or the source file doesn't exist
        // (already past last backup?). Either way, we should exit the loop now.
        break;
      }
      catch (e)
      {
        Cu.reportError("Adblock Plus: Failed to read filters from file " + realSourceFile.path);
        Cu.reportError(e);
      }

      // We failed loading filters, let's try next backup file
      realSourceFile = FilterStorage.sourceFile;
      if (realSourceFile)
      {
        let part1 = realSourceFile.leafName;
        let part2 = "";
        if (/^(.*)(\.\w+)$/.test(part1))
        {
          part1 = RegExp.$1;
          part2 = RegExp.$2;
        }

        realSourceFile = realSourceFile.clone();
        realSourceFile.leafName = part1 + "-backup" + (++backup) + part2;
      }
    }

    TimeLine.log("done parsing file");

    // Old special groups might have been converted, remove them if they are empty
    for each (let specialSubscription in ["~il~", "~wl~", "~fl~", "~eh~"])
    {
      if (specialSubscription in FilterStorage.knownSubscriptions)
      {
        let subscription = Subscription.fromURL(specialSubscription);
        if (subscription.filters.length == 0)
          FilterStorage.removeSubscription(subscription, true);
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
    if (!silent)
      FilterNotifier.triggerListeners("load");
    TimeLine.leave("FilterStorage.loadFromDisk() done");
  },

  /**
   * Saves all subscriptions back to disk
   */
  saveToDisk: function()
  {
    if (!FilterStorage.sourceFile)
      return;

    TimeLine.enter("Entered FilterStorage.saveToDisk()");

    try {
      FilterStorage.sourceFile.normalize();
    } catch (e) {}

    // Make sure the file's parent directory exists
    try {
      FilterStorage.sourceFile.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0755);
    } catch (e) {}

    let tempFile = FilterStorage.sourceFile.clone();
    tempFile.leafName += "-temp";
    let fileStream, stream;
    try {
      fileStream = Cc["@mozilla.org/network/safe-file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      fileStream.init(tempFile, 0x02 | 0x08 | 0x20, 0644, 0);

      stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
      stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
    }
    catch (e)
    {
      Cu.reportError(e);
      TimeLine.leave("FilterStorage.saveToDisk() done (error opening file)");
      return;
    }

    TimeLine.log("created temp file");

    const maxBufLength = 1024;
    let buf = ["# Adblock Plus preferences", "version=" + formatVersion];
    let lineBreak = Utils.getLineBreak();
    function writeBuffer()
    {
      stream.writeString(buf.join(lineBreak) + lineBreak);
      buf.splice(0, buf.length);
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
          if (buf.length > maxBufLength)
            writeBuffer();
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
      if (buf.length > maxBufLength)
        writeBuffer();
    }
    TimeLine.log("saved subscription data");

    try
    {
      stream.writeString(buf.join(lineBreak) + lineBreak);
      stream.flush();
      fileStream.QueryInterface(Ci.nsISafeOutputStream).finish();
    }
    catch (e)
    {
      Cu.reportError(e);
      TimeLine.leave("FilterStorage.saveToDisk() done (error closing file)");
      return;
    }
    TimeLine.log("finalized file write");

    if (FilterStorage.sourceFile.exists()) {
      // Check whether we need to backup the file
      let part1 = FilterStorage.sourceFile.leafName;
      let part2 = "";
      if (/^(.*)(\.\w+)$/.test(part1))
      {
        part1 = RegExp.$1;
        part2 = RegExp.$2;
      }

      let doBackup = (Prefs.patternsbackups > 0);
      if (doBackup)
      {
        let lastBackup = FilterStorage.sourceFile.clone();
        lastBackup.leafName = part1 + "-backup1" + part2;
        if (lastBackup.exists() && (Date.now() - lastBackup.lastModifiedTime) / 3600000 < Prefs.patternsbackupinterval)
          doBackup = false;
      }

      if (doBackup)
      {
        let backupFile = FilterStorage.sourceFile.clone();
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

    tempFile.moveTo(FilterStorage.sourceFile.parent, FilterStorage.sourceFile.leafName);
    TimeLine.log("created backups and renamed temp file");
    FilterNotifier.triggerListeners("save");
    TimeLine.leave("FilterStorage.saveToDisk() done");
  }
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

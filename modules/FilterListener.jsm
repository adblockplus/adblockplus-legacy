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
 * @fileOverview Component synchronizing filter storage with Matcher instances and ElemHide.
 */

var EXPORTED_SYMBOLS = ["FilterListener"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import(baseURL.spec + "TimeLine.jsm");
Cu.import(baseURL.spec + "FilterStorage.jsm");
Cu.import(baseURL.spec + "ElemHide.jsm");
Cu.import(baseURL.spec + "Matcher.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "Utils.jsm");

let subscriptionFilter = null;

/**
 * Version of the data cache file, files with different version will be ignored.
 */
const cacheVersion = 1;

/**
 * Value of the FilterListener.batchMode property.
 * @type Boolean
 */
let batchMode = false;

/**
 * Will be true if filters changed after saving data last time.
 * @type Boolean
 */
let isDirty = false;

/**
 * This object can be used to change properties of the filter change listeners.
 * @class
 */
var FilterListener =
{
  /**
   * Called on module initialization, registers listeners for FilterStorage changes
   */
  startup: function()
  {
    TimeLine.enter("Entered FilterListener.startup()");

    FilterStorage.addObserver(function(action, items)
    {
      if (/^filters (.*)/.test(action))
        onFilterChange(RegExp.$1, items);
      else if (/^subscriptions (.*)/.test(action))
        onSubscriptionChange(RegExp.$1, items);
      else
        onGenericChange(action, items);
    });

    ElemHide.init();

    let initialized = false;
    let cacheFile = Utils.resolveFilePath(Prefs.data_directory);
    cacheFile.append("cache.js");
    if (cacheFile.exists())
    {
      // Yay, fast startup!
      try
      {
        TimeLine.log("Loading cache file");
        let stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
        stream.init(cacheFile, 0x01, 0444, 0);

        let json = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);
        let cache = json.decodeFromStream(stream, "UTF-8");

        stream.close();

        if (cache.version == cacheVersion && cache.patternsTimestamp == FilterStorage.sourceFile.clone().lastModifiedTime)
        {
          defaultMatcher.fromCache(cache);
          ElemHide.fromCache(cache);

          // We still need to load patterns.ini if certain properties are accessed
          var loadDone = false;
          function trapProperty(obj, prop)
          {
            var origValue = obj[prop];
            delete obj[prop];
            obj.__defineGetter__(prop, function()
            {
              delete obj[prop];
              obj[prop] = origValue;
              if (!loadDone)
              {
                TimeLine.enter("Entered delayed FilterStorage init");
                loadDone = true;
                FilterStorage.loadFromDisk(true);
                TimeLine.leave("Delayed FilterStorage init done");
              }
              return obj[prop];
            });
            obj.__defineSetter__(prop, function(value)
            {
              delete obj[prop];
              return obj[prop] = value;
            });
          }

          for each (let prop in ["fileProperties", "subscriptions", "knownSubscriptions",
                                 "addSubscription", "removeSubscription", "updateSubscriptionFilters",
                                 "addFilter", "removeFilter", "increaseHitCount", "resetHitCounts"])
          {
            trapProperty(FilterStorage, prop);
          }
          trapProperty(Filter, "fromText");
          trapProperty(Filter, "knownFilters");
          trapProperty(Subscription, "fromURL");
          trapProperty(Subscription, "knownSubscriptions");

          initialized = true;
          TimeLine.log("Done loading cache file");

          ElemHide.apply();
        }
      }
      catch (e)
      {
        Cu.reportError(e);
      }
    }

    // If we failed to restore from cache - load patterns.ini
    if (!initialized)
      FilterStorage.loadFromDisk();

    TimeLine.log("done initializing data structures");

    Utils.observerService.addObserver(FilterListenerPrivate, "browser:purge-session-history", true);
    TimeLine.log("done adding observers");

    TimeLine.leave("FilterListener.startup() done");
  },

  /**
   * Called on module shutdown.
   */
  shutdown: function()
  {
    TimeLine.enter("Entered FilterListener.shutdown()");
    if (isDirty)
      FilterStorage.saveToDisk();
    TimeLine.leave("FilterListener.shutdown() done");
  },

  /**
   * Set to true when executing many changes, changes will only be fully applied after this variable is set to false again.
   * @type Boolean
   */
  get batchMode()
  {
    return batchMode;
  },
  set batchMode(value)
  {
    batchMode = value;
    flushElemHide();
  }
};

/**
 * Private nsIObserver implementation.
 * @class
 */
var FilterListenerPrivate =
{
  observe: function(subject, topic, data)
  {
    if (topic == "browser:purge-session-history" && Prefs.clearStatsOnHistoryPurge)
    {
      FilterStorage.resetHitCounts();
      FilterStorage.saveToDisk();

      Prefs.recentReports = "[]";
    }
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
};

/**
 * Calls ElemHide.apply() if necessary
 */
function flushElemHide()
{
  if (!batchMode && ElemHide.isDirty)
    ElemHide.apply();
}

/**
 * Notifies Matcher instances or ElemHide object about a new filter
 * if necessary.
 * @param {Filter} filter filter that has been added
 */
function addFilter(filter)
{
  if (!(filter instanceof ActiveFilter) || filter.disabled || (subscriptionFilter && filter.subscriptions.some(subscriptionFilter)))
    return;

  if (filter instanceof RegExpFilter)
    defaultMatcher.add(filter);
  else if (filter instanceof ElemHideFilter)
    ElemHide.add(filter);
}

/**
 * Notifies Matcher instances or ElemHide object about removal of a filter
 * if necessary.
 * @param {Filter} filter filter that has been removed
 */
function removeFilter(filter)
{
  if (!(filter instanceof ActiveFilter) || (subscriptionFilter && filter.subscriptions.some(subscriptionFilter)))
    return;

  if (filter instanceof RegExpFilter)
    defaultMatcher.remove(filter);
  else if (filter instanceof ElemHideFilter)
    ElemHide.remove(filter);
}

/**
 * Subscription change listener
 */
function onSubscriptionChange(action, subscriptions)
{
  isDirty = true;

  if (action != "remove")
  {
    subscriptions = subscriptions.filter(function(subscription)
    {
      // Ignore updates for subscriptions not in the list
      return subscription.url in FilterStorage.knownSubscriptions;
    });
  }
  if (!subscriptions.length)
    return;

  if (action == "add" || action == "enable" ||
      action == "remove" || action == "disable" ||
      action == "update")
  {
    let subscriptionMap = {__proto__: null};
    for each (let subscription in subscriptions)
      subscriptionMap[subscription.url] = true;
    subscriptionFilter = function(subscription)
    {
      return !(subscription.url in subscriptionMap) && !subscription.disabled;
    }
  }
  else
    subscriptionFilter = null;

  if (action == "add" || action == "enable" ||
      action == "remove" || action == "disable")
  {
    let method = (action == "add" || action == "enable" ? addFilter : removeFilter);
    for each (let subscription in subscriptions)
      if (subscription.filters && (action == "disable" || !subscription.disabled))
        subscription.filters.forEach(method);
  }
  else if (action == "update")
  {
    for each (let subscription in subscriptions)
    {
      if (!subscription.disabled)
      {
        subscription.oldFilters.forEach(removeFilter);
        subscription.filters.forEach(addFilter);
      }
    }
  }

  flushElemHide();
}

/**
 * Filter change listener
 */
function onFilterChange(action, filters)
{
  isDirty = true;

  if (action == "add" || action == "enable" ||
      action == "remove" || action == "disable")
  {
    subscriptionFilter = null;

    let method = (action == "add" || action == "enable" ? addFilter : removeFilter);
    if (action != "enable" && action != "disable")
    {
      filters = filters.filter(function(filter)
      {
        // For "add" only consider filters that have enabled subscriptions, for
        // "remove" those that don't have any.
        return ((action == "add") == filter.subscriptions.some(function(subscription) !subscription.disabled));
      });
    }
    filters.forEach(method);
    flushElemHide();
  }
}

/**
 * Generic notification listener
 */
function onGenericChange(action)
{
  if (action == "load")
  {
    isDirty = false;

    defaultMatcher.clear();
    ElemHide.clear();
    for each (let subscription in FilterStorage.subscriptions)
      if (!subscription.disabled)
        subscription.filters.forEach(addFilter);
    flushElemHide();
  }
  else if (action == "save")
  {
    isDirty = false;

    let cache = {version: cacheVersion, patternsTimestamp: FilterStorage.sourceFile.clone().lastModifiedTime};
    defaultMatcher.toCache(cache);
    ElemHide.toCache(cache);

    let cacheFile = Utils.resolveFilePath(Prefs.data_directory);
    cacheFile.append("cache.js");

    try {
      // Make sure the file's parent directory exists
      cacheFile.parent.create(Ci.nsIFile.DIRECTORY_TYPE, 0755);
    } catch (e) {}

    try
    {
      let fileStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      fileStream.init(cacheFile, 0x02 | 0x08 | 0x20, 0644, 0);

      let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
      stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

      // nsIJSON.encodeToStream would have been better but it is broken, see bug 633934
      let json = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);
      stream.writeString(json.encode(cache));
      stream.close();
    }
    catch(e)
    {
      delete FilterStorage.fileProperties.cacheTimestamp;
      Cu.reportError(e);
    }
  }
}

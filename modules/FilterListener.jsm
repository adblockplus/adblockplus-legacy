/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

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
Cu.import(baseURL.spec + "FilterNotifier.jsm");
Cu.import(baseURL.spec + "ElemHide.jsm");
Cu.import(baseURL.spec + "Matcher.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");
Cu.import(baseURL.spec + "Utils.jsm");

/**
 * Value of the FilterListener.batchMode property.
 * @type Boolean
 */
let batchMode = false;

/**
 * Increases on filter changes, filters will be saved if it exceeds 1.
 * @type Integer
 */
let isDirty = 0;

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

    FilterNotifier.addListener(function(action, item, newValue, oldValue)
    {
      if (/^filter\.(.*)/.test(action))
        onFilterChange(RegExp.$1, item, newValue, oldValue);
      else if (/^subscription\.(.*)/.test(action))
        onSubscriptionChange(RegExp.$1, item, newValue, oldValue);
      else
        onGenericChange(action, item);
    });

    ElemHide.init();
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
    if (isDirty > 0)
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
  },

  /**
   * Increases "dirty factor" of the filters and calls FilterStorage.saveToDisk()
   * if it becomes 1 or more. Save is executed delayed to prevent multiple
   * subsequent calls. If the parameter is 0 it forces saving filters if any
   * changes were recorded after the previous save.
   */
  setDirty: function(/**Integer*/ factor)
  {
    if (factor == 0 && isDirty > 0)
      isDirty = 1;
    else
      isDirty += factor;
    if (isDirty >= 1 && !filtersFlushScheduled)
    {
      Utils.runAsync(flushFiltersInternal);
      filtersFlushScheduled = true;
    }
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
      FilterListener.setDirty(0); // Force saving to disk

      Prefs.recentReports = "[]";
    }
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver])
};

let elemhideFlushScheduled = false;

/**
 * Calls ElemHide.apply() if necessary. Executes delayed to prevent multiple
 * subsequent calls.
 */
function flushElemHide()
{
  if (elemhideFlushScheduled)
    return;

  Utils.runAsync(flushElemHideInternal);
  elemhideFlushScheduled = true;
}

function flushElemHideInternal()
{
  elemhideFlushScheduled = false;
  if (!batchMode && ElemHide.isDirty)
    ElemHide.apply();
}

let filtersFlushScheduled = false;

function flushFiltersInternal()
{
  filtersFlushScheduled = false;
  FilterStorage.saveToDisk();
}

/**
 * Notifies Matcher instances or ElemHide object about a new filter
 * if necessary.
 * @param {Filter} filter filter that has been added
 */
function addFilter(filter)
{
  if (!(filter instanceof ActiveFilter) || filter.disabled)
    return;

  let hasEnabled = false;
  for (let i = 0; i < filter.subscriptions.length; i++)
    if (!filter.subscriptions[i].disabled)
      hasEnabled = true;
  if (!hasEnabled)
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
  if (!(filter instanceof ActiveFilter))
    return;

  if (!filter.disabled)
  {
    let hasEnabled = false;
    for (let i = 0; i < filter.subscriptions.length; i++)
      if (!filter.subscriptions[i].disabled)
        hasEnabled = true;
    if (hasEnabled)
      return;
  }

  if (filter instanceof RegExpFilter)
    defaultMatcher.remove(filter);
  else if (filter instanceof ElemHideFilter)
    ElemHide.remove(filter);
}

/**
 * Subscription change listener
 */
function onSubscriptionChange(action, subscription, newValue, oldValue)
{
  if (action == "homepage" || action == "downloadStatus" || action == "lastDownload")
    FilterListener.setDirty(0.2);
  else
    FilterListener.setDirty(1);

  if (action != "added" && action != "removed" && action != "disabled" && action != "updated")
    return;

  if (action != "removed" && !(subscription.url in FilterStorage.knownSubscriptions))
  {
    // Ignore updates for subscriptions not in the list
    return;
  }

  if ((action == "added" || action == "removed" || action == "updated") && subscription.disabled)
  {
    // Ignore adding/removing/updating of disabled subscriptions
    return;
  }

  if (action == "added" || action == "removed" || action == "disabled")
  {
    let method = (action == "added" || (action == "disabled" && newValue == false) ? addFilter : removeFilter);
    if (subscription.filters)
      subscription.filters.forEach(method);
  }
  else if (action == "updated")
  {
    subscription.oldFilters.forEach(removeFilter);
    subscription.filters.forEach(addFilter);
  }

  flushElemHide();
}

/**
 * Filter change listener
 */
function onFilterChange(action, filter, newValue, oldValue)
{
  if (action == "hitCount" || action == "lastHit")
    FilterListener.setDirty(0.0001);
  else if (action == "disabled" || action == "moved")
    FilterListener.setDirty(0.2);
  else
    FilterListener.setDirty(1);

  if (action != "added" && action != "removed" && action != "disabled")
    return;

  if ((action == "added" || action == "removed") && filter.disabled)
  {
    // Ignore adding/removing of disabled filters
    return;
  }

  if (action == "added" || (action == "disabled" && newValue == false))
    addFilter(filter);
  else
    removeFilter(filter);
  flushElemHide();
}

/**
 * Generic notification listener
 */
function onGenericChange(action)
{
  if (action == "load")
  {
    isDirty = 0;

    defaultMatcher.clear();
    ElemHide.clear();
    for each (let subscription in FilterStorage.subscriptions)
      if (!subscription.disabled)
        subscription.filters.forEach(addFilter);
    flushElemHide();
  }
  else if (action == "save")
    isDirty = 0;
}

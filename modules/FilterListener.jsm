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
 * @fileOverview Component synchronizing filter storage with Matcher instances and ElemHide.
 */

var EXPORTED_SYMBOLS = ["FilterListener"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);
Cu.import(baseURL.spec + "TimeLine.jsm");
Cu.import(baseURL.spec + "FilterStorage.jsm");
Cu.import(baseURL.spec + "ElemHide.jsm");
Cu.import(baseURL.spec + "Matcher.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");

let subscriptionFilter = null;

/**
 * Value of the FilterListener.batchMode property.
 * @type Boolean
 */
let batchMode = false;

/**
 * This object can be used to change properties of the filter change listeners.
 * @class
 */
var FilterListener =
{
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
    if (!batchMode && ElemHide.isDirty)
      ElemHide.apply();
  }
};

/**
 * Called on module initialization, registers listeners for FilterStorage changes
 */
function init()
{
  TimeLine.enter("Entered FilterListener.jsm init()");

  onSubscriptionChange("reload", FilterStorage.subscriptions);
  TimeLine.log("done initializing data structures");

  TimeLine.log("adding observers");
  FilterStorage.addSubscriptionObserver(onSubscriptionChange);
  FilterStorage.addFilterObserver(onFilterChange);

  TimeLine.leave("FilterListener.jsm init() done");
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

  if (filter instanceof BlockingFilter)
    blacklistMatcher.add(filter);
  else if (filter instanceof WhitelistFilter)
    whitelistMatcher.add(filter);
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

  if (filter instanceof BlockingFilter)
    blacklistMatcher.remove(filter);
  else if (filter instanceof WhitelistFilter)
    whitelistMatcher.remove(filter);
  else if (filter instanceof ElemHideFilter)
    ElemHide.remove(filter);
}

/**
 * Subscription change listener
 */
function onSubscriptionChange(action, subscriptions)
{
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
  else if (action == "reload")
  {
    blacklistMatcher.clear();
    whitelistMatcher.clear();
    ElemHide.clear();
    for each (let subscription in subscriptions)
      if (!subscription.disabled)
        subscription.filters.forEach(addFilter);
  }

  if (!batchMode && ElemHide.isDirty)
    ElemHide.apply();
}

/**
 * Filter change listener
 */
function onFilterChange(action, filters)
{
  if (action == "add" || action == "enable" ||
      action == "remove" || action == "disable")
  {
    subscriptionFilter = null;

    let method = (action == "add" || action == "enable" ? addFilter : removeFilter);
    if (action != "enable" && action != "disable")
    {
      filters = filters.filter(function(filter)
      {
        for each (let subscription in filter.subscriptions)
        {
          if (!(subscription instanceof SpecialSubscription) || subscription.disabled)
            return false;
        }
        return true;
      });
    }
    filters.forEach(method);
    if (!batchMode && ElemHide.isDirty)
      ElemHide.apply();
  }
}

init();

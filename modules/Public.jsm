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
 * @fileOverview Public Adblock Plus API.
 */

var EXPORTED_SYMBOLS = ["AdblockPlus"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "FilterStorage.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");

/**
 * Class implementing public Adblock Plus API
 * @class
 */
var AdblockPlus =
{
  /**
   * Returns current subscription count
   * @type Integer
   */
  get subscriptionCount()
  {
    return FilterStorage.subscriptions.length;
  },

  /**
   * Gets a subscription by its URL
   */
  getSubscription: function(/**String*/ id) /**IAdblockPlusSubscription*/
  {
    if (id in FilterStorage.knownSubscriptions)
      return createSubscriptionWrapper(FilterStorage.knownSubscriptions[id]);

    return null;
  },

  /**
   * Gets a subscription by its position in the list
   */
  getSubscriptionAt: function(/**Integer*/ index) /**IAdblockPlusSubscription*/
  {
    if (index < 0 || index >= FilterStorage.subscriptions.length)
      return null;

    return createSubscriptionWrapper(FilterStorage.subscriptions[index]);
  },

  /**
   * Updates an external subscription and creates it if necessary
   */
  updateExternalSubscription: function(/**String*/ id, /**String*/ title, /**Array of Filter*/ filters) /**Boolean*/
  {
    // Don't allow valid URLs as IDs for external subscriptions
    if (Utils.makeURI(id))
      return false;

    let subscription = Subscription.fromURL(id);
    if (!subscription)
      subscription = new ExternalSubscription(id, title);

    if (!(subscription instanceof ExternalSubscription))
      return false;

    subscription.lastDownload = parseInt(new Date().getTime() / 1000);

    let newFilters = [];
    for each (let filter in filters)
    {
      filter = Filter.fromText(Filter.normalize(filter));
      if (filter)
        newFilters.push(filter);
    }

    if (id in FilterStorage.knownSubscriptions)
      FilterStorage.updateSubscriptionFilters(subscription, newFilters);
    else
    {
      subscription.filters = newFilters;
      FilterStorage.addSubscription(subscription);
    }
    FilterStorage.saveToDisk();

    return true;
  },

  /**
   * Removes an external subscription by its identifier
   */
  removeExternalSubscription: function(/**String*/ id) /**Boolean*/
  {
    if (!(id in FilterStorage.knownSubscriptions && FilterStorage.knownSubscriptions[id] instanceof ExternalSubscription))
      return false;

    FilterStorage.removeSubscription(FilterStorage.knownSubscriptions[id]);
    return true;
  },

  /**
   * Adds user-defined filters to the list
   */
  addPatterns: function(/**Array of String*/ filters)
  {
    for each (let filter in filters)
    {
      filter = Filter.fromText(Filter.normalize(filter));
      if (filter)
      {
        if (filter.disabled)
        {
          filter.disabled = false;
          FilterStorage.triggerFilterObservers("enable", [filter]);
        }
        FilterStorage.addFilter(filter);
      }
    }
    FilterStorage.saveToDisk();
  },

  /**
   * Removes user-defined filters from the list
   */
  removePatterns: function(/**Array of String*/ filters)
  {
    for each (let filter in filters)
    {
      filter = Filter.fromText(Filter.normalize(filter));
      if (filter)
        FilterStorage.removeFilter(filter);
    }
    FilterStorage.saveToDisk();
  },

  /**
   * Returns installed Adblock Plus version
   */
  getInstalledVersion: function() /**String*/
  {
    return Utils.addonVersion;
  },

  /**
   * Returns source code revision this Adblock Plus build was created from (if available)
   */
  getInstalledBuild: function() /**String*/
  {
    return Utils.addonBuild;
  },
};

/**
 * Wraps a subscription into IAdblockPlusSubscription structure.
 */
function createSubscriptionWrapper(/**Subscription*/ subscription) /**IAdblockPlusSubscription*/
{
  if (!subscription)
    return null;

  return {
    url: subscription.url,
    special: subscription instanceof SpecialSubscription,
    title: subscription.title,
    autoDownload: subscription instanceof DownloadableSubscription && subscription.autoDownload,
    disabled: subscription.disabled,
    external: subscription instanceof ExternalSubscription,
    lastDownload: subscription instanceof RegularSubscription ? subscription.lastDownload : 0,
    downloadStatus: subscription instanceof DownloadableSubscription ? subscription.downloadStatus : "synchronize_ok",
    lastModified: subscription instanceof DownloadableSubscription ? subscription.lastModified : null,
    expires: subscription instanceof DownloadableSubscription ? subscription.expires : 0,
    getPatterns: function()
    {
      let result = subscription.filters.map(function(filter)
      {
        return filter.text;
      });
      return result;
    }
  };
}

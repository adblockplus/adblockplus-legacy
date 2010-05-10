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
 * @fileOverview Manages synchronization of filter subscriptions.
 */

var EXPORTED_SYMBOLS = ["Synchronizer"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let baseURL = Cc["@adblockplus.org/abp/private;1"].getService(Ci.nsIURI);

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import(baseURL.spec + "TimeLine.jsm");
Cu.import(baseURL.spec + "Utils.jsm");
Cu.import(baseURL.spec + "FilterStorage.jsm");
Cu.import(baseURL.spec + "FilterClasses.jsm");
Cu.import(baseURL.spec + "SubscriptionClasses.jsm");
Cu.import(baseURL.spec + "Prefs.jsm");

var XMLHttpRequest = Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1", "nsIJSXMLHttpRequest");

let timer = null;

/**
 * Map of subscriptions currently being downloaded, all currently downloaded
 * URLs are keys of that map.
 */
let executing = {__proto__: null};

/**
 * This object is responsible for downloading filter subscriptions whenever
 * necessary.
 * @class
 */
var Synchronizer =
{
  /**
   * Called on module startup.
   */
  startup: function()
  {
    TimeLine.enter("Entered Synchronizer.startup()");
  
    let callback = function()
    {
      timer.delay = 3600000;
      checkSubscriptions();
    };
  
    timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(callback, 300000, Ci.nsITimer.TYPE_REPEATING_SLACK);
  
    TimeLine.leave("Synchronizer.startup() done");
  },

  /**
   * Called on module shutdown.
   */
  shutdown: function(/**Boolean*/ cleanup)
  {
    if (cleanup)
    {
      TimeLine.enter("Entered Synchronizer.shutdown()");

      timer.cancel();
      timer = null;

      executing = {__proto__: null};

      TimeLine.leave("Synchronizer.shutdown() done");
    }
  },

  /**
   * Checks whether a subscription is currently being downloaded.
   * @param {String} url  URL of the subscription
   * @return {Boolean}
   */
  isExecuting: function(url)
  {
    return url in executing;
  },

  /**
   * Starts the download of a subscription.
   * @param {DownloadableSubscription} subscription  Subscription to be downloaded
   * @param {Boolean} manual  true for a manually started download (should not trigger fallback requests)
   * @param {Boolean}  forceDownload  if true, the subscription will even be redownloaded if it didn't change on the server
   */
  execute: function(subscription, manual, forceDownload)
  {
    let url = subscription.url;
    if (url in executing)
      return;

    let newURL = subscription.nextURL;
    let hadTemporaryRedirect = false;
    subscription.nextURL = null;

    let curVersion = Utils.addonVersion;
    let loadFrom = newURL;
    let isBaseLocation = true;
    if (!loadFrom)
    {
      loadFrom = url;
      if (subscription.alternativeLocations)
      {
        // We have alternative download locations, choose one. "Regular"
        // subscription URL always goes in with weight 1.
        let options = [[1, url]];
        let totalWeight = 1;
        for each (let alternative in subscription.alternativeLocations.split(','))
        {
          if (!/^https?:\/\//.test(alternative))
            continue;

          let weight = 1;
          let weightingRegExp = /;q=([\d\.]+)$/;
          if (weightingRegExp.test(alternative))
          {
            weight = parseFloat(RegExp.$1);
            if (isNaN(weight) || !isFinite(weight) || weight < 0)
              weight = 1;
            if (weight > 10)
              weight = 10;

            alternative = alternative.replace(weightingRegExp, "");
          }
          options.push([weight, alternative]);
          totalWeight += weight;
        }

        let choice = Math.random() * totalWeight;
        for each (let [weight, alternative] in options)
        {
          choice -= weight;
          if (choice < 0)
          {
            loadFrom = alternative;
            break;
          }
        }

        isBaseLocation = (loadFrom == url);
      }
    }
    loadFrom = loadFrom.replace(/%VERSION%/, "ABP" + curVersion);

    let request = null;
    function errorCallback(error)
    {
      let channelStatus = -1;
      try
      {
        channelStatus = request.channel.status;
      } catch (e) {}
      let responseStatus = "";
      try
      {
        responseStatus = request.channel.QueryInterface(Ci.nsIHttpChannel).responseStatus;
      } catch (e) {}
      setError(subscription, error, channelStatus, responseStatus, loadFrom, isBaseLocation, manual);
    }

    try
    {
      request = new XMLHttpRequest();
      request.mozBackgroundRequest = true;
      request.open("GET", loadFrom);
    }
    catch (e)
    {
      errorCallback("synchronize_invalid_url");
      return;
    }

    try {
      request.overrideMimeType("text/plain");
      request.channel.loadFlags = request.channel.loadFlags |
                                  request.channel.INHIBIT_CACHING |
                                  request.channel.VALIDATE_ALWAYS;

      // Override redirect limit from preferences, user might have set it to 1
      if (request.channel instanceof Ci.nsIHttpChannel)
        request.channel.redirectionLimit = 5;

      var oldNotifications = request.channel.notificationCallbacks;
      var oldEventSink = null;
      request.channel.notificationCallbacks =
      {
        QueryInterface: XPCOMUtils.generateQI([Ci.nsIInterfaceRequestor, Ci.nsIChannelEventSink]),

        getInterface: function(iid)
        {
          if (iid.equals(Ci.nsIChannelEventSink))
          {
            try {
              oldEventSink = oldNotifications.QueryInterface(iid);
            } catch(e) {}
            return this;
          }
    
          return (oldNotifications ? oldNotifications.QueryInterface(iid) : null);
        },

        onChannelRedirect: function(oldChannel, newChannel, flags)
        {
          if (isBaseLocation && !hadTemporaryRedirect && oldChannel instanceof Ci.nsIHttpChannel)
          {
            try
            {
              subscription.alternativeLocations = oldChannel.getResponseHeader("X-Alternative-Locations");
            }
            catch (e)
            {
              subscription.alternativeLocations = null;
            }
          }

          if (flags & Ci.nsIChannelEventSink.REDIRECT_TEMPORARY)
            hadTemporaryRedirect = true;
          else if (!hadTemporaryRedirect)
            newURL = newChannel.URI.spec;

          if (oldEventSink)
            oldEventSink.onChannelRedirect(oldChannel, newChannel, flags);
        }
      }
    }
    catch (e)
    {
      Cu.reportError(e)
    }

    if (subscription.lastModified && !forceDownload)
      request.setRequestHeader("If-Modified-Since", subscription.lastModified);

    request.onerror = function(ev)
    {
      delete executing[url];
      try {
        request.channel.notificationCallbacks = null;
      } catch (e) {}

      errorCallback("synchronize_connection_error");
    };

    request.onload = function(ev)
    {
      delete executing[url];
      try {
        request.channel.notificationCallbacks = null;
      } catch (e) {}

      // Status will be 0 for non-HTTP requests
      if (request.status && request.status != 200 && request.status != 304)
      {
        errorCallback("synchronize_connection_error");
        return;
      }

      let newFilters = null;
      if (request.status != 304)
      {
        newFilters = readFilters(subscription, request.responseText, errorCallback);
        if (!newFilters)
          return;

        subscription.lastModified = request.getResponseHeader("Last-Modified");
      }

      if (isBaseLocation && !hadTemporaryRedirect)
        subscription.alternativeLocations = request.getResponseHeader("X-Alternative-Locations");
      subscription.lastDownload = Math.round(Date.now() / 1000);
      subscription.downloadStatus = "synchronize_ok";
      subscription.errors = 0;

      let expires = Math.round(new Date(request.getResponseHeader("Expires")).getTime() / 1000) || 0;
      for each (let filter in newFilters)
      {
        if (filter instanceof CommentFilter && /\bExpires\s*(?::|after)\s*(\d+)\s*(h)?/i.test(filter.text))
        {
          var hours = parseInt(RegExp.$1);
          if (!RegExp.$2)
            hours *= 24;
          if (hours > 0)
          {
            let time = subscription.lastDownload + hours * 3600;
            if (time > expires)
              expires = time;
          }
        }
        if (isBaseLocation && filter instanceof CommentFilter && /\bRedirect(?:\s*:\s*|\s+to\s+|\s+)(\S+)/i.test(filter.text))
          subscription.nextURL = RegExp.$1;
      }
      subscription.expires = (expires > subscription.lastDownload ? expires : 0);

      // Expiration date shouldn't be more than two weeks in the future
      if (subscription.expires - subscription.lastDownload > 14*24*3600)
        subscription.expires = subscription.lastDownload + 14*24*3600;

      if (isBaseLocation && newURL && newURL != url)
      {
        let listed = (subscription.url in FilterStorage.knownSubscriptions);
        if (listed)
          FilterStorage.removeSubscription(subscription);

        url = newURL;

        let newSubscription = Subscription.fromURL(url);
        for (let key in newSubscription)
          delete newSubscription[key];
        for (let key in subscription)
          newSubscription[key] = subscription[key];

        delete Subscription.knownSubscriptions[subscription.url];
        newSubscription.oldSubscription = subscription;
        subscription = newSubscription;
        subscription.url = url;

        if (!(subscription.url in FilterStorage.knownSubscriptions) && listed)
          FilterStorage.addSubscription(subscription);
      }

      if (newFilters)
        FilterStorage.updateSubscriptionFilters(subscription, newFilters);
      else
        FilterStorage.triggerSubscriptionObservers("updateinfo", [subscription]);
      delete subscription.oldSubscription;

      FilterStorage.saveToDisk();
    };

    executing[url] = true;
    FilterStorage.triggerSubscriptionObservers("updateinfo", [subscription]);

    try
    {
      request.send(null);
    }
    catch (e)
    {
      delete executing[url];
      errorCallback("synchronize_connection_error");
      return;
    }
  }
};

/**
 * Checks whether any subscriptions need to be downloaded and starts the download
 * if necessary.
 */
function checkSubscriptions()
{
  let time = Date.now() / 1000;
  for each (let subscription in FilterStorage.subscriptions)
  {
    if (!(subscription instanceof DownloadableSubscription) || !subscription.autoDownload)
      continue;

    if (subscription.expires > time)
      continue;

    // Get the number of hours since last download
    let interval = (time - subscription.lastDownload) / 3600;
    if (interval >= Prefs.synchronizationinterval)
      Synchronizer.execute(subscription, false);
  }
}

/**
 * Extracts a list of filters from text returned by a server.
 * @param {DownloadableSubscription} subscription  subscription the info should be placed into
 * @param {String} text server response
 * @param {Function} errorCallback function to be called on error
 * @return {Array of Filter}
 */
function readFilters(subscription, text, errorCallback)
{
  let lines = text.split(/[\r\n]+/);
  if (!/\[Adblock(?:\s*Plus\s*([\d\.]+)?)?\]/i.test(lines[0]))
  {
    errorCallback("synchronize_invalid_data");
    return null;
  }
  let minVersion = RegExp.$1;

  for (let i = 0; i < lines.length; i++)
  {
    if (/!\s*checksum[\s\-:]+([\w\+\/]+)/i.test(lines[i]))
    {
      lines.splice(i, 1);
      let checksumExpected = RegExp.$1;
      let checksum = Utils.generateChecksum(lines);

      if (checksum && checksum != checksumExpected)
      {
        errorCallback("synchronize_checksum_mismatch");
        return null;
      }

      break;
    }
  }

  delete subscription.requiredVersion;
  delete subscription.upgradeRequired;
  if (minVersion)
  {
    subscription.requiredVersion = minVersion;
    if (Utils.versionComparator.compare(minVersion, Utils.addonVersion) > 0)
      subscription.upgradeRequired = true;
  }

  lines.shift();
  let result = [];
  for each (let line in lines)
  {
    let filter = Filter.fromText(Filter.normalize(line));
    if (filter)
      result.push(filter);
  }

  return result;
}

/**
 * Handles an error during a subscription download.
 * @param {DownloadableSubscription} subscription  subscription that failed to download
 * @param {Integer} channelStatus result code of the download channel
 * @param {String} responseStatus result code as received from server
 * @param {String} downloadURL the URL used for download
 * @param {String} error error ID in global.properties
 * @param {Boolean} isBaseLocation false if the subscription was downloaded from a location specified in X-Alternative-Locations header
 * @param {Boolean} manual  true for a manually started download (should not trigger fallback requests)
 */
function setError(subscription, error, channelStatus, responseStatus, downloadURL, isBaseLocation, manual)
{
  // If download from an alternative location failed, reset the list of
  // alternative locations - have to get an updated list from base location.
  if (!isBaseLocation)
    subscription.alternativeLocations = null;

  try {
    Cu.reportError("Adblock Plus: Downloading filter subscription " + subscription.title + " failed (" + Utils.getString(error) + ")\n" +
                   "Download address: " + downloadURL + "\n" +
                   "Channel status: " + channelStatus + "\n" +
                   "Server response: " + responseStatus);
  } catch(e) {}

  subscription.lastDownload = Math.round(Date.now() / 1000);
  subscription.downloadStatus = error;

  // Request fallback URL if necessary - for automatic updates only
  if (!manual)
  {
    if (error == "synchronize_checksum_mismatch")
    {
      // No fallback for successful download with checksum mismatch, reset error counter
      subscription.errors = 0;
    }
    else
      subscription.errors++;

    if (subscription.errors >= Prefs.subscriptions_fallbackerrors && /^https?:\/\//i.test(subscription.url))
    {
      subscription.errors = 0;

      let fallbackURL = Prefs.subscriptions_fallbackurl;
      fallbackURL = fallbackURL.replace(/%VERSION%/g, encodeURIComponent(Utils.addonVersion));
      fallbackURL = fallbackURL.replace(/%SUBSCRIPTION%/g, encodeURIComponent(subscription.url));
      fallbackURL = fallbackURL.replace(/%URL%/g, encodeURIComponent(downloadURL));
      fallbackURL = fallbackURL.replace(/%ERROR%/g, encodeURIComponent(error));
      fallbackURL = fallbackURL.replace(/%CHANNELSTATUS%/g, encodeURIComponent(channelStatus));
      fallbackURL = fallbackURL.replace(/%RESPONSESTATUS%/g, encodeURIComponent(responseStatus));

      let request = new XMLHttpRequest();
      request.mozBackgroundRequest = true;
      request.open("GET", fallbackURL);
      request.overrideMimeType("text/plain");
      request.channel.loadFlags = request.channel.loadFlags |
                                  request.channel.INHIBIT_CACHING |
                                  request.channel.VALIDATE_ALWAYS;
      request.onload = function(ev)
      {
        if (/^301\s+(\S+)/.test(request.responseText))  // Moved permanently    
          subscription.nextURL = RegExp.$1;
        else if (/^410\b/.test(request.responseText))   // Gone
        {
          subscription.autoDownload = false;
          FilterStorage.triggerSubscriptionObservers("updateinfo", [subscription]);
        }
        FilterStorage.saveToDisk();
      }
      request.send(null);
    }
  }

  FilterStorage.triggerSubscriptionObservers("updateinfo", [subscription]);
  FilterStorage.saveToDisk();
}

/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * @fileOverview Module containing a bunch of utility functions.
 */

var EXPORTED_SYMBOLS = ["Sync"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

let baseURL = "chrome://adblockplus-modules/content/";
Cu.import(baseURL + "Utils.jsm");
Cu.import(baseURL + "FilterStorage.jsm");
Cu.import(baseURL + "SubscriptionClasses.jsm");
Cu.import(baseURL + "FilterClasses.jsm");
Cu.import(baseURL + "FilterNotifier.jsm");
Cu.import(baseURL + "Synchronizer.jsm");

/**
 * ID of the only record stored
 * @type String
 */
const filtersRecordID = "6fad6286-8207-46b6-aa39-8e0ce0bd7c49";

/**
 * Weave tracker class (is set when Weave is initialized).
 */
var Tracker = null;

var Sync =
{
  /**
   * Will be set to true if/when Weave starts up.
   * @type Boolean
   */
  initialized: false,

  /**
   * Whether Weave requested us to track changes.
   * @type Boolean
   */
  trackingEnabled: false,

  /**
   * Called on module startup.
   */
  startup: function()
  {
    Services.obs.addObserver(SyncPrivate, "weave:service:ready", true);
    Services.obs.addObserver(SyncPrivate, "weave:engine:start-tracking", true);
    Services.obs.addObserver(SyncPrivate, "weave:engine:stop-tracking", true);
  },

  /**
   * Returns Adblock Plus sync engine.
   * @result Engine
   */
  getEngine: function()
  {
    if (this.initialized)
      return Weave.Engines.get("adblockplus");
    else
      return null;
  }
};

var SyncPrivate =
{
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),

  observe: function(subject, topic, data)
  {
    switch (topic)
    {
      case "weave:service:ready":
        Cu.import("resource://services-sync/main.js");

        Tracker = Weave.SyncEngine.prototype._trackerObj;
        ABPEngine.prototype.__proto__ = Weave.SyncEngine.prototype;
        ABPStore.prototype.__proto__ = Weave.Store.prototype;
        ABPTracker.prototype.__proto__ = Tracker.prototype;

        Weave.Engines.register(ABPEngine);
        Sync.initialized = true;
        break;
      case "weave:engine:start-tracking":
        Sync.trackingEnabled = true;
        if (trackerInstance)
          trackerInstance.startTracking();
        break;
      case "weave:engine:stop-tracking":
        Sync.trackingEnabled = false;
        if (trackerInstance)
          trackerInstance.stopTracking();
        break;
    }
  }
};

function ABPEngine()
{
  Weave.SyncEngine.call(this, "AdblockPlus");
}
ABPEngine.prototype =
{
  _storeObj: ABPStore,
  _trackerObj: ABPTracker,
  version: 1,

  _reconcile: function(item)
  {
    // Always process server data, we will do the merging ourselves
    return true;
  }
};

function ABPStore(name)
{
  Weave.Store.call(this, name);
}
ABPStore.prototype =
{
  getAllIDs: function()
  {
    let result = {}
    result[filtersRecordID] = true;
    return result;
  },

  changeItemID: function(oldId, newId)
  {
    // This should not be called, our engine doesn't implement _findDupe
    throw Cr.NS_ERROR_UNEXPECTED;
  },

  itemExists: function(id)
  {
    // Only one id exists so far
    return (id == filtersRecordID);
  },

  createRecord: function(id, collection)
  {
    let record = new ABPEngine.prototype._recordObj(collection, id);
    if (id == filtersRecordID)
    {
      record.cleartext = {
        id: id,
        subscriptions: [],
      };
      for each (let subscription in FilterStorage.subscriptions)
      {
        if (subscription instanceof ExternalSubscription)
          continue;

        let subscriptionEntry =
        {
          url: subscription.url,
          disabled: subscription.disabled
        };
        if (subscription instanceof SpecialSubscription)
        {
          subscriptionEntry.filters = [];
          for each (let filter in subscription.filters)
          {
            let filterEntry = {text: filter.text};
            if (filter instanceof ActiveFilter)
              filterEntry.disabled = filter.disabled;
            subscriptionEntry.filters.push(filterEntry);
          }
        }
        else
          subscriptionEntry.title = subscription.title;
        record.cleartext.subscriptions.push(subscriptionEntry);
      }

      // Data sent, forget about local changes now
      trackerInstance.clearPrivateChanges()
    }
    else
      record.deleted = true;

    return record;
  },

  create: function(record)
  {
    // This should not be called because our record list doesn't change but
    // call update just in case.
    this.update(record);
  },

  update: function(record)
  {
    if (record.id != filtersRecordID)
      return;

    this._log.trace("Merging in remote data");

    let data = record.cleartext.subscriptions;

    // First make sure we have the same subscriptions on both sides
    let seenSubscription = {__proto__: null};
    for each (let remoteSubscription in data)
    {
      seenSubscription[remoteSubscription.url] = true;
      if (remoteSubscription.url in FilterStorage.knownSubscriptions)
      {
        let subscription = FilterStorage.knownSubscriptions[remoteSubscription.url];
        if (!trackerInstance.didSubscriptionChange(remoteSubscription))
        {
          // Only change local subscription if there were no changes, otherwise dismiss remote changes
          subscription.disabled = remoteSubscription.disabled;
          if (subscription instanceof DownloadableSubscription)
            subscription.title = remoteSubscription.title;
        }
      }
      else if (!trackerInstance.didSubscriptionChange(remoteSubscription))
      {
        // Subscription was added remotely, add it locally as well
        let subscription = Subscription.fromURL(remoteSubscription.url);
        if (!subscription)
          continue;

        subscription.disabled = remoteSubscription.disabled;
        if (subscription instanceof DownloadableSubscription)
        {
          subscription.title = remoteSubscription.title;
          FilterStorage.addSubscription(subscription);
          Synchronizer.execute(subscription);
        }
      }
    }

    for each (let subscription in FilterStorage.subscriptions.slice())
    {
      if (!(subscription.url in seenSubscription) && subscription instanceof DownloadableSubscription && !trackerInstance.didSubscriptionChange(subscription))
      {
        // Subscription was removed remotely, remove it locally as well
        FilterStorage.removeSubscription(subscription);
      }
    }

    // Now sync the custom filters
    let seenFilter = {__proto__: null};
    for each (let remoteSubscription in data)
    {
      if (!("filters" in remoteSubscription))
        continue;

      for each (let remoteFilter in remoteSubscription.filters)
      {
        seenFilter[remoteFilter.text] = true;

        let filter = Filter.fromText(remoteFilter.text);
        if (!filter || trackerInstance.didFilterChange(filter))
          continue;

        if (filter.subscriptions.some(function(subscription) subscription instanceof SpecialSubscription))
        {
          // Filter might have been changed remotely
          if (filter instanceof ActiveFilter)
            filter.disabled = remoteFilter.disabled;
        }
        else
        {
          // Filter was added remotely, add it locally as well
          FilterStorage.addFilter(filter);
        }
      }
    }

    for each (let subscription in FilterStorage.subscriptions)
    {
      if (!(subscription instanceof SpecialSubscription))
        continue;

      for each (let filter in subscription.filters.slice())
      {
        if (!(filter.text in seenFilter) && !trackerInstance.didFilterChange(filter))
        {
          // Filter was removed remotely, remove it locally as well
          FilterStorage.removeFilter(filter);
        }
      }
    }

    // Merge done, forget about local changes now
    trackerInstance.clearPrivateChanges()
  },

  remove: function(record)
  {
    // Shouldn't be called but if it is - ignore
  },

  wipe: function()
  {
    this._log.trace("Got wipe command, removing all data");

    for each (let subscription in FilterStorage.subscriptions.slice())
    {
      if (subscription instanceof DownloadableSubscription)
        FilterStorage.removeSubscription(subscription);
      else if (subscription instanceof SpecialSubscription)
      {
        for each (let filter in subscription.filters.slice())
          FilterStorage.removeFilter(filter);
      }
    }

    // Data wiped, forget about local changes now
    trackerInstance.clearPrivateChanges()
  }
};

/**
 * Hack to allow store to use the tracker - store tracker pointer globally.
 */
let trackerInstance = null;

function ABPTracker(name)
{
  Tracker.call(this, name);

  this.privateTracker = new Tracker(name + ".private");
  trackerInstance = this;

  this.onChange = this._bindMethod(this.onChange);

  if (Sync.trackingEnabled)
    this.startTracking();
}
ABPTracker.prototype =
{
  privateTracker: null,

  _bindMethod: function(method)
  {
    let me = this;
    return function() method.apply(me, arguments);
  },

  startTracking: function()
  {
    FilterNotifier.addListener(this.onChange);
  },

  stopTracking: function()
  {
    FilterNotifier.removeListener(this.onChange);
  },

  clearPrivateChanges: function()
  {
    this.privateTracker.clearChangedIDs();
  },

  addPrivateChange: function(id)
  {
    // Ignore changes during syncing
    if (this.ignoreAll)
      return;

    this.addChangedID(filtersRecordID);
    this.privateTracker.addChangedID(id);
    this.score += 10;
  },

  didSubscriptionChange: function(subscription)
  {
    return ("subscription " + subscription.url) in this.privateTracker.changedIDs;
  },

  didFilterChange: function(filter)
  {
    return ("filter " + filter.text) in this.privateTracker.changedIDs;
  },

  onChange: function(action, item)
  {
    switch (action)
    {
      case "subscription.updated":
        if ("oldSubscription" in item)
        {
          // Subscription moved to a new address
          this.addPrivateChange("subscription " + item.url);
          this.addPrivateChange("subscription " + item.oldSubscription.url);
        }
        else if (item instanceof SpecialSubscription)
        {
          // User's filters changed via Preferences window
          for each (let filter in item.filters)
            this.addPrivateChange("filter " + filter.text);
          for each (let filter in item.oldFilters)
            this.addPrivateChange("filter " + filter.text);
        }
        break;
      case "subscription.added":
      case "subscription.removed":
      case "subscription.disabled":
      case "subscription.title":
        this.addPrivateChange("subscription " + item.url);
        break;
      case "filter.added":
      case "filter.removed":
      case "filter.disabled":
        this.addPrivateChange("filter " + item.text);
        break;
    }
  }
};

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
 * Portions created by the Initial Developer are Copyright (C) 2006-2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * Weave integration, only loaded if Weave is actually present.
 * This file is included from AdblockPlus.js.
 */
var Weave = {};

Components.utils.import("resource://weave/engines.js", Weave);
Components.utils.import("resource://weave/stores.js", Weave);
Components.utils.import("resource://weave/trackers.js", Weave);
Components.utils.import("resource://weave/base_records/crypto.js", Weave);
Components.utils.import("resource://weave/async.js", Weave);
Components.utils.import("resource://weave/util.js", Weave);

Function.prototype.async = Weave.Async.sugar;

// This class is a hack, SyncEngine has to use the same class for all remote
// items. When the id property is set on an instance of this class the prototype
// is changed to the correct class for this id.
function WeaveRecord(uri)
{
  Weave.CryptoWrapper.call(this, uri);
  this.cleartext = {};
}
WeaveRecord.prototype =
{
  __proto__: Weave.CryptoWrapper.prototype,
  _logname: "Record.AdblockPlus",

  _source: null,
  get source() this._source,
  set source(source)
  {
    this._source = source;

    if (source instanceof Filter)
    {
      this.cleartext.type = "filter";
      this.cleartext.text = source.text;
      if (source instanceof ActiveFilter)
        this.cleartext.disabled = source.disabled;
    }
    else if (source instanceof Subscription)
    {
      this.cleartext.type = "subscription";
      this.cleartext.url = source.url;
      this.cleartext.disabled = source.disabled;
      if (source instanceof RegularSubscription)
        this.cleartext.title = source.title;
      if (source instanceof DownloadableSubscription)
        this.cleartext.autoDownload = source.autoDownload;
    }
    else if (typeof source == "string")
    {
      this.cleartext.type = "pref";
      this.cleartext.name = source;
      this.cleartext.value = prefs[source];
    }
    else
      this.deleted = true;
  },

  _saveBack: function()
  {
    switch (this.cleartext.type)
    {
      case "filter":
        let filter = Filter.fromText(this.cleartext.text);
        if (!filter)
          break;

        if (filter instanceof ActiveFilter && this.cleartext.disabled != filter.disabled)
        {
          filter.disabled = this.cleartext.disabled;
          filterStorage.triggerFilterObservers(filter.disabled ? "disable" : "enable", [filter]);
        }

        this._source = filter;
        break;
      case "subscription":
        let subscription = Subscription.fromURL(this.cleartext.url);
        if (!subscription)
          break;

        if (this.cleartext.disabled != subscription.disabled)
        {
          subscription.disabled = this.cleartext.disabled;
          filterStorage.triggerSubscriptionObservers(subscription.disabled ? "disable" : "enable", [subscription]);
        }

        let changed = false;
        if (subscription instanceof RegularSubscription && this.cleartext.title != subscription.title)
        {
          subscription.title = this.cleartext.title;
          changed = true;
        }
        if (subscription instanceof DownloadableSubscription && this.cleartext.autoDownload != subscription.autoDownload)
        {
          subscription.autoDownload = this.cleartext.autoDownload;
          changed = true;
        }
        if (changed)
          filterStorage.triggerSubscriptionObservers("updateinfo", [subscription]);

        this._source = subscription;
        break;
      case "pref":
        let prefName = this.cleartext.name;
        if (this.cleartext.value != prefs[prefName])
        {
          prefs[prefName] = this.cleartext.value;
          prefs.save();
        }

        this._source = prefName;
        break;
    }
  }
};

function WeaveStore()
{
  Weave.Store.call(this);
}
WeaveStore.prototype =
{
  __proto__: Weave.Store.prototype,
  _logName: "AdblockPlus",
  _abpItems: null,

  createRecord: function(id, cryptoMetaURL)
  {
    let record = this.cache.get(id);
    if (record)
      return record;

    record = new WeaveRecord();
    record.id = id;
    record.encryption = cryptoMetaURL;
    if (id in this._abpItems)
      record.source = this._abpItems[id];
    else
      record.deleted = true;

    this.cache.put(id, record);
    return record;
  },

  itemExists: function(id)
  {
    return (id in this._abpItems);
  },

  // This method shouldn't be called because Engine._recordLike() always returns false
  changeItemID: function(oldId, newId) {},

  getAllIDs: function()
  {
    let result = {};
    for each (let subscription in filterStorage.subscriptions)
    {
      if (!(subscription instanceof ExternalSubscription))
        result[Weave.Utils.sha1("subscription " + subscription.url)] = subscription;

      if (subscription instanceof SpecialSubscription)
      {
        for each (let filter in subscription.filters)
          result[Weave.Utils.sha1("filter " + filter.text)] = filter;
      }
    }
    for each (let [prefName, prefType, defaultValue] in prefs.prefList)
      if (prefName != "currentVersion")
        result[Weave.Utils.sha1("pref " + prefName)] = prefName;

    return result;
  },

  wipe: function()
  {
    this._log.debug("Wiping all client data");

    let subscriptions = filterStorage.subscriptions.slice();
    for each (let subscription in subscriptions)
    {
      if (subscription instanceof SpecialSubscription)
        filterStorage.updateSubscriptionFilters(subscription, []);
      else if (!(subscription instanceof ExternalSubscription))
        filterStorage.removeSubscription(subscription);
    }

    for each (let [prefName, prefType, defaultValue] in prefs.prefList)
    {
      if (prefName != "currentVersion")
        prefs[prefName] = defaultValue;
    }
    prefs.save();
  },

  create: function(record)
  {
    this._log.debug("Got create command for " + record.id);

    record._saveBack();
    if (record.source instanceof Filter)
      filterStorage.addFilter(record.source);
    else if (record.source instanceof DownloadableSubscription)
    {
      filterStorage.addSubscription(record.source);
      if (!record.source.lastDownload)
        synchronizer.execute(record.source);
    }
  },
  update: function(record)
  {
    this._log.debug("Got update command for " + record.id);

    record._saveBack();
  },
  remove: function(record)
  {
    this._log.debug("Got remove command for " + record.id);

    if (record.id in this._abpItems)
    {
      let item = this._abpItems[record.id];
      if (item instanceof Filter)
        filterStorage.removeFilter(item);
      else if (item instanceof DownloadableSubscription)
        filterStorage.removeSubscription(item);
    }
  },

  cacheABPItems: function()
  {
    this._log.debug("Caching all ABP items");
    this._abpItems = this.getAllIDs();
  },
  clearABPCache: function()
  {
    this._log.debug("Clearing ABP item cache");
    this._abpItems = null;
  }
};

function WeaveTracker()
{
  Weave.Tracker.call(this);

  let me = this;
  prefs.addListener(function() { me.onPrefChange.apply(me, arguments); });
  filterStorage.addSubscriptionObserver(function() { me.onSubscriptionChange.apply(me, arguments); });
  filterStorage.addFilterObserver(function() { me.onFilterChange.apply(me, arguments); });
}
WeaveTracker.prototype =
{
  __proto__: Weave.Tracker.prototype,
  _logName: "Tracker.AdblockPlus",
  file: "abpdata",

  onPrefChange: function()
  {
    for each (let [prefName, prefType, defaultValue] in prefs.prefList)
      if (prefName != "currentVersion")
        this.addChangedID(Weave.Utils.sha1("pref " + prefName));
    this._score += 20;
  },

  onSubscriptionChange: function(action, subscriptions)
  {
    for each (let subscription in subscriptions)
    {
      if (!(subscription instanceof ExternalSubscription))
        this.addChangedID(Weave.Utils.sha1("subscription " + subscription.url));

      if (subscription instanceof SpecialSubscription && action == "update")
      {
        let oldFilters = {__proto__: null};
        for each (let filter in subscription.oldFilters)
          oldFilters[filter.text] = true;
        let newFilters = {__proto__: null};
        for each (let filter in subscription.filters)
          newFilters[filter.text] = true;

        for (let text in oldFilters)
          if (!(text in newFilters))
            this.addChangedID(Weave.Utils.sha1("filter " + text));

        for (let text in newFilters)
          if (!(text in oldFilters))
            this.addChangedID(Weave.Utils.sha1("filter " + text));
      }
    }
    this._score += 5;
  },

  onFilterChange: function(action, filters)
  {
    if (action == "hit")
      return;

    for each (let filter in filters)
      this.addChangedID(Weave.Utils.sha1("filter " + filter.text));
    this._score += 10;
  }
};

function WeaveEngine()
{
  Weave.SyncEngine.call(this);
}
WeaveEngine.prototype =
{
  __proto__: Weave.SyncEngine.prototype,
  name: "abpdata",
  displayName: "Adblock Plus data",
  logName: "AdblockPlus",
  _storeObj: WeaveStore,
  _trackerObj: WeaveTracker,
  _recordObj: WeaveRecord,

  _recordLike: function() false,

  // Work-around for https://bugzilla.mozilla.org/show_bug.cgi?id=493256
  _isEqual: function(item)
  {
    if (item.deleted)
      return false;

    return this.__proto__.__proto__._isEqual.apply(this, arguments);
  },

  _syncStartup: function()
  {
    let self = yield;
    this._store.cacheABPItems();
    yield Weave.SyncEngine.prototype._syncStartup.async(this, self.cb);
  },
  _syncFinish: function()
  {
    let self = yield;
    this._store.clearABPCache();
    yield Weave.SyncEngine.prototype._syncFinish.async(this, self.cb);
  }
};

Weave.Engines.register(WeaveEngine);
